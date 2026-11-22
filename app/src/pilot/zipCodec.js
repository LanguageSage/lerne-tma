const ZIP_MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const ZIP_MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const ZIP_MAX_ENTRIES = 10002;
const ZIP_MAX_NAME_LENGTH = 1024;

const SIG_LOCAL_FILE_HEADER = 0x04034b50;
const SIG_CENTRAL_DIR_HEADER = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const FLAG_DESCRIPTOR = 0x0008;
const SUPPORTED_FLAGS = 0x0800 | FLAG_DESCRIPTOR | 0x0006;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function computeCrc32(input) {
  const bytes = toUint8Array(input);
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toUint8Array(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('Expected Uint8Array or ArrayBuffer');
}

export function validateZipEntryName(name) {
  if (typeof name !== 'string' || !name || name.length > ZIP_MAX_NAME_LENGTH) {
    throw new Error('Некорректный путь файла в архиве.');
  }
  if (
    name.startsWith('/')
    || name.endsWith('/')
    || name.includes('\\')
    || name.includes(':')
    || name.includes('\0')
  ) {
    throw new Error(`Недопустимый путь в архиве: ${name}`);
  }
  const parts = name.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Недопустимый или неоднозначный путь в архиве: ${name}`);
  }
  return name;
}

function findEocdOffset(bytes, view) {
  if (bytes.length < 22) {
    throw new Error('Файл не является корректным ZIP-архивом.');
  }
  const minOffset = Math.max(0, bytes.length - 65557);
  for (let offset = bytes.length - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === SIG_EOCD) {
      const commentLen = view.getUint16(offset + 20, true);
      if (offset + 22 + commentLen === bytes.length) {
        return offset;
      }
    }
  }
  throw new Error('Не найден заголовок ZIP-архива (EOCD).');
}

async function transformWithDeflateStream(bytes, mode, maxOutputBytes = ZIP_MAX_ENTRY_BYTES) {
  const StreamCtor = mode === 'compress' ? globalThis.CompressionStream : globalThis.DecompressionStream;
  if (typeof StreamCtor !== 'function') {
    throw new Error('В этой среде недоступно сжатие ZIP (CompressionStream/DecompressionStream).');
  }

  const stream = new StreamCtor('deflate-raw');
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();

  const writePromise = (async () => {
    try {
      const chunkSize = mode === 'decompress' ? 16 * 1024 : 256 * 1024;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        await writer.write(bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
      }
      await writer.close();
    } catch {
      // Reader side will observe the stream error.
    }
  })();

  const output = mode === 'decompress' ? new Uint8Array(maxOutputBytes) : null;
  const chunks = [];
  let totalLength = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        totalLength += value.byteLength;
        if (totalLength > maxOutputBytes) {
          await reader.cancel().catch(() => {});
          throw new Error('Размер распакованного файла в архиве превышает допустимый лимит.');
        }
        if (output) output.set(value, totalLength - value.byteLength);
        else chunks.push(value);
      }
    }
  } catch (error) {
    await writePromise.catch(() => {});
    if (error?.message?.includes('превышает допустимый лимит')) {
      throw error;
    }
    throw new Error('Повреждённые сжатые данные в ZIP-архиве.');
  }

  await writePromise;

  if (output) return output.subarray(0, totalLength);
  const result = new Uint8Array(totalLength);
  let pos = 0;
  for (const chunk of chunks) {
    result.set(chunk, pos);
    pos += chunk.byteLength;
  }
  return result;
}

/**
 * Read and strictly verify a ZIP archive without symlinks, traversal, encryption, or zip bombs.
 */
export async function readZipArchive(input, {
  maxArchiveBytes = ZIP_MAX_ARCHIVE_BYTES,
  maxEntries = ZIP_MAX_ENTRIES,
  entrySizeLimit = null,
} = {}) {
  const bytes = toUint8Array(input);
  if (bytes.length > maxArchiveBytes) {
    throw new Error('Архив превышает максимальный размер 512 МБ.');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEocdOffset(bytes, view);

  if (eocdOffset >= 20 && view.getUint32(eocdOffset - 20, true) === SIG_ZIP64_LOCATOR) {
    throw new Error('ZIP64-архивы не поддерживаются.');
  }

  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const cdDiskNumber = view.getUint16(eocdOffset + 6, true);
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  if (
    diskNumber !== 0
    || cdDiskNumber !== 0
    || entriesOnDisk !== totalEntries
    || totalEntries === 0xffff
    || cdSize === 0xffffffff
    || cdOffset === 0xffffffff
  ) {
    throw new Error('Многотомные или ZIP64-архивы не поддерживаются.');
  }

  if (totalEntries > maxEntries) {
    throw new Error('Слишком много файлов в архиве.');
  }

  if (cdOffset + cdSize !== eocdOffset) {
    throw new Error('Повреждён центральный каталог ZIP-архива.');
  }

  const textDecoder = new TextDecoder('utf-8', { fatal: true });
  const records = [];
  const seenNames = new Set();
  let declaredTotalUncompressed = 0;
  let cursor = cdOffset;

  for (let idx = 0; idx < totalEntries; idx += 1) {
    if (cursor + 46 > cdOffset + cdSize) {
      throw new Error('Усечённый заголовок файла в ZIP-архиве.');
    }
    if (view.getUint32(cursor, true) !== SIG_CENTRAL_DIR_HEADER) {
      throw new Error('Некорректная сигнатура заголовка в ZIP-архиве.');
    }

    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const crc32 = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const diskStart = view.getUint16(cursor + 34, true);
    const externalAttr = view.getUint32(cursor + 38, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);

    if (cursor + 46 + nameLen + extraLen + commentLen > cdOffset + cdSize) {
      throw new Error('Усечённая запись в центральном каталоге ZIP.');
    }

    if ((flags & ~SUPPORTED_FLAGS) !== 0) {
      throw new Error('Шифрование или другие флаги не поддерживаются в ZIP.');
    }
    if (diskStart !== 0 || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error('Многотомные или ZIP64-записи в архиве не поддерживаются.');
    }
    if (method !== 0 && method !== 8) {
      throw new Error('Неподдерживаемый метод сжатия в ZIP-архиве.');
    }

    const unixMode = (externalAttr >>> 16) & 0o170000;
    if ((unixMode !== 0 && unixMode !== 0o100000) || (externalAttr & 0x10) !== 0) {
      throw new Error('Каталоги и ссылки в архиве не поддерживаются.');
    }

    let name;
    try {
      name = textDecoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));
    } catch {
      throw new Error('Некорректная кодировка имени файла в архиве.');
    }
    validateZipEntryName(name);
    if (seenNames.has(name)) {
      throw new Error('Повторные файлы в архиве.');
    }
    seenNames.add(name);

    const limit = typeof entrySizeLimit === 'function' ? entrySizeLimit(name) : ZIP_MAX_ENTRY_BYTES;
    if (uncompressedSize > limit) {
      throw new Error('Вложение превышает допустимый размер.');
    }
    declaredTotalUncompressed += uncompressedSize;
    if (declaredTotalUncompressed > maxArchiveBytes) {
      throw new Error('Распакованный архив превышает допустимый размер 512 МБ.');
    }

    records.push({
      name,
      nameBytes: bytes.subarray(cursor + 46, cursor + 46 + nameLen),
      flags,
      method,
      crc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      maxAllowedBytes: limit,
    });

    cursor += 46 + nameLen + extraLen + commentLen;
  }

  if (cursor !== cdOffset + cdSize) {
    throw new Error('Размер центрального каталога ZIP не совпадает с заголовком.');
  }

  const files = new Map();
  let actualTotalUncompressed = 0;

  const byOffset = [...records].sort((a, b) => a.localHeaderOffset - b.localHeaderOffset);
  for (const [index, rec] of byOffset.entries()) {
    const lh = rec.localHeaderOffset;
    if (lh + 30 > cdOffset || view.getUint32(lh, true) !== SIG_LOCAL_FILE_HEADER) {
      throw new Error('Повреждён локальный заголовок файла в ZIP-архиве.');
    }
    const localFlags = view.getUint16(lh + 6, true);
    const localMethod = view.getUint16(lh + 8, true);
    const localNameLen = view.getUint16(lh + 26, true);
    const localExtraLen = view.getUint16(lh + 28, true);
    const localNameStart = lh + 30;
    if (localFlags !== rec.flags || localMethod !== rec.method || localNameLen !== rec.nameBytes.length
        || !rec.nameBytes.every((byte, i) => byte === bytes[localNameStart + i])) {
      throw new Error('Несогласованный заголовок файла в ZIP-архиве.');
    }

    const dataStart = lh + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + rec.compressedSize;
    const nextOffset = byOffset[index + 1]?.localHeaderOffset ?? cdOffset;
    if (dataEnd > nextOffset) {
      throw new Error('Сжатые данные файла выходят за пределы архива.');
    }
    const matchesDetails = offset => view.getUint32(offset, true) === rec.crc32
      && view.getUint32(offset + 4, true) === rec.compressedSize
      && view.getUint32(offset + 8, true) === rec.uncompressedSize;
    if (localFlags & FLAG_DESCRIPTOR) {
      const signedDescriptor = dataEnd + 16 <= nextOffset && view.getUint32(dataEnd, true) === 0x08074b50
        && matchesDetails(dataEnd + 4);
      if (!signedDescriptor && (dataEnd + 12 > nextOffset || !matchesDetails(dataEnd))) {
        throw new Error('Повреждён дескриптор записи в ZIP-архиве.');
      }
    } else if (!matchesDetails(lh + 14)) {
      throw new Error('Несогласованный заголовок файла в ZIP-архиве.');
    }
    rec.dataStart = dataStart;
    rec.dataEnd = dataEnd;
  }

  for (const rec of records) {
    const payload = bytes.subarray(rec.dataStart, rec.dataEnd);
    let data;
    if (rec.method === 0) {
      if (rec.compressedSize !== rec.uncompressedSize) {
        throw new Error('Некорректный размер несжатой записи в ZIP.');
      }
      data = new Uint8Array(payload);
    } else {
      const cap = Math.min(rec.maxAllowedBytes, rec.uncompressedSize);
      data = await transformWithDeflateStream(payload, 'decompress', cap);
    }

    if (data.length !== rec.uncompressedSize || data.length > rec.maxAllowedBytes) {
      throw new Error('Распакованный размер файла не совпадает с заголовком ZIP.');
    }
    actualTotalUncompressed += data.length;
    if (actualTotalUncompressed > maxArchiveBytes) {
      throw new Error('Распакованный архив превышает допустимый размер 512 МБ.');
    }
    if (computeCrc32(data) !== rec.crc32) {
      throw new Error(`Контрольная сумма CRC-32 не совпадает для файла ${rec.name}.`);
    }

    files.set(rec.name, data);
  }

  return files;
}

/**
 * Create a deterministic deflated ZIP archive compatible with Python zipfile.
 */
export async function buildZipArchive(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('Архив должен содержать хотя бы один файл.');
  }
  if (entries.length > ZIP_MAX_ENTRIES) throw new Error('Слишком много файлов в архиве.');
  const encoder = new TextEncoder();
  const seenNames = new Set();
  const prepared = [];
  let uncompressedTotal = 0;
  let totalSize = 22;

  for (const entry of entries) {
    const name = validateZipEntryName(entry?.name);
    if (seenNames.has(name)) {
      throw new Error(`Повторный файл при создании архива: ${name}`);
    }
    seenNames.add(name);
    const raw = toUint8Array(entry.data);
    uncompressedTotal += raw.length;
    if (raw.length > ZIP_MAX_ENTRY_BYTES || uncompressedTotal > ZIP_MAX_ARCHIVE_BYTES) {
      throw new Error('Вложения превышают допустимый размер ZIP.');
    }
    const nameBytes = encoder.encode(name);
    const crc32 = computeCrc32(raw);
    const compressed = await transformWithDeflateStream(raw, 'compress', Math.max(1024, raw.length + 1024 * 1024));
    totalSize += 76 + 2 * nameBytes.length + compressed.length;
    if (totalSize > ZIP_MAX_ARCHIVE_BYTES) throw new Error('Итоговый ZIP-архив превышает 512 МБ.');
    prepared.push({
      nameBytes,
      crc32,
      uncompressedSize: raw.length,
      compressed,
      method: 8,
    });
  }

  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);
  let offset = 0;
  const offsets = [];

  // Fixed reproducible DOS timestamp: 2026-01-01 00:00:00
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  const utf8Flag = 0x0800;

  for (const item of prepared) {
    offsets.push(offset);
    view.setUint32(offset, SIG_LOCAL_FILE_HEADER, true);
    view.setUint16(offset + 4, 20, true); // version needed: 2.0
    view.setUint16(offset + 6, utf8Flag, true);
    view.setUint16(offset + 8, item.method, true);
    view.setUint16(offset + 10, dosTime, true);
    view.setUint16(offset + 12, dosDate, true);
    view.setUint32(offset + 14, item.crc32, true);
    view.setUint32(offset + 18, item.compressed.length, true);
    view.setUint32(offset + 22, item.uncompressedSize, true);
    view.setUint16(offset + 26, item.nameBytes.length, true);
    view.setUint16(offset + 28, 0, true);
    out.set(item.nameBytes, offset + 30);
    out.set(item.compressed, offset + 30 + item.nameBytes.length);
    offset += 30 + item.nameBytes.length + item.compressed.length;
  }

  const cdOffset = offset;
  prepared.forEach((item, index) => {
    view.setUint32(offset, SIG_CENTRAL_DIR_HEADER, true);
    view.setUint16(offset + 4, (3 << 8) | 20, true); // Unix + 2.0
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, utf8Flag, true);
    view.setUint16(offset + 10, item.method, true);
    view.setUint16(offset + 12, dosTime, true);
    view.setUint16(offset + 14, dosDate, true);
    view.setUint32(offset + 16, item.crc32, true);
    view.setUint32(offset + 20, item.compressed.length, true);
    view.setUint32(offset + 24, item.uncompressedSize, true);
    view.setUint16(offset + 28, item.nameBytes.length, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0o100644 << 16, true);
    view.setUint32(offset + 42, offsets[index], true);
    out.set(item.nameBytes, offset + 46);
    offset += 46 + item.nameBytes.length;
  });

  const cdSize = offset - cdOffset;
  view.setUint32(offset, SIG_EOCD, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, prepared.length, true);
  view.setUint16(offset + 10, prepared.length, true);
  view.setUint32(offset + 12, cdSize, true);
  view.setUint32(offset + 16, cdOffset, true);
  view.setUint16(offset + 20, 0, true);

  return out;
}
