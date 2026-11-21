import { prepareLocalDb } from '../services/localDb.js';
import { sha256Hex } from './sha256.js';
import { buildZipArchive, readZipArchive } from './zipCodec.js';
import {
  MAX_ARCHIVE_BYTES,
  MAX_ASSET_BYTES,
  MAX_MANIFEST_BYTES,
  applyMaterialArchiveImport,
  buildMaterialArchiveExport,
  inspectMaterialArchiveForImport,
  inspectMediaBytes,
  parseJsonStrictNoDuplicates,
} from './materialArchive.js';
import {
  getOfflineMaterialArchivePlugin,
  initOfflineMediaStore,
  isNativeOfflineMediaAvailable,
  readWebMediaAssetBytes,
  registerNativeMediaFiles,
  storeWebMediaAssets,
} from './offlineMediaStore.js';

export function isNativeMaterialArchiveAvailable() {
  return isNativeOfflineMediaAvailable();
}

export async function inspectArchiveWebBytes(rawBytes, fileName = '', { db = null, userId = null } = {}) {
  try {
    const zipMap = await readZipArchive(rawBytes, {
      maxArchiveBytes: MAX_ARCHIVE_BYTES,
      entrySizeLimit: (name) => (
        name === 'manifest.json'
          ? MAX_MANIFEST_BYTES
          : name === 'manifest.sha256'
            ? 64
            : MAX_ASSET_BYTES
      ),
    });

    const manifestRaw = zipMap.get('manifest.json');
    const shaRaw = zipMap.get('manifest.sha256');
    if (!manifestRaw || !shaRaw) {
      return { ok: false, error: 'В архиве отсутствуют manifest.json или manifest.sha256.' };
    }

    const decoder = new TextDecoder('utf-8', { fatal: true });
    let manifestJson;
    let manifestSha256;
    try {
      manifestJson = decoder.decode(manifestRaw);
      manifestSha256 = decoder.decode(shaRaw);
    } catch {
      return { ok: false, error: 'Манифест архива содержит некорректную кодировку UTF-8.' };
    }

    if (sha256Hex(manifestJson) !== manifestSha256.trim()) {
      return { ok: false, error: 'Контрольная сумма манифеста не совпадает.' };
    }

    const parsedDoc = parseJsonStrictNoDuplicates(manifestJson);
    const declaredAssets = Array.isArray(parsedDoc?.assets) ? parsedDoc.assets : [];
    const folderByPath = new Map();
    for (const asset of declaredAssets) {
      if (asset && typeof asset.path === 'string' && typeof asset.folder === 'string') {
        folderByPath.set(asset.path, asset.folder);
      }
    }

    const verifiedZipEntries = new Map();
    const blobsBySha = new Map();

    for (const [entryPath, bytes] of zipMap.entries()) {
      if (entryPath === 'manifest.json' || entryPath === 'manifest.sha256') {
        verifiedZipEntries.set(entryPath, { size: bytes.length });
        continue;
      }
      const expectedFolder = folderByPath.get(entryPath);
      if (!expectedFolder) {
        return { ok: false, error: 'Состав ZIP не совпадает с манифестом.' };
      }
      const inspected = inspectMediaBytes(bytes, expectedFolder);
      verifiedZipEntries.set(entryPath, inspected);
      blobsBySha.set(inspected.sha256, bytes);
    }

    const inspection = await inspectMaterialArchiveForImport({
      manifestJson,
      manifestSha256,
      verifiedZipEntries,
      fileName,
      db,
      userId,
    });

    return {
      ok: true,
      channel: 'web',
      fileName,
      inspection,
      blobsBySha,
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || 'Повреждённый или неподдерживаемый архив учебных материалов.',
    };
  }
}

export async function inspectArchiveWebFile(file, options = {}) {
  if (!file) {
    return { ok: false, error: 'Файл архива не выбран.' };
  }
  if (typeof file.size === 'number' && file.size > MAX_ARCHIVE_BYTES) {
    return { ok: false, error: 'Архив больше 512 МБ.' };
  }
  try {
    const buffer = await file.arrayBuffer();
    return await inspectArchiveWebBytes(new Uint8Array(buffer), file.name || '', options);
  } catch (error) {
    return { ok: false, error: error?.message || 'Не удалось прочитать выбранный ZIP-файл.' };
  }
}

export async function pickArchiveForImportNative({ db = null, userId = null } = {}) {
  if (!isNativeMaterialArchiveAvailable()) {
    return null;
  }
  const plugin = getOfflineMaterialArchivePlugin();
  const picked = await plugin.pickArchiveForImport();
  if (!picked || picked.cancelled) {
    return { cancelled: true };
  }

  try {
    const verifiedZipEntries = new Map();
    for (const entry of Array.isArray(picked.zipEntries) ? picked.zipEntries : []) {
      if (entry?.path) {
        verifiedZipEntries.set(entry.path, entry);
      }
    }
    const inspection = await inspectMaterialArchiveForImport({
      manifestJson: picked.manifestJson,
      manifestSha256: picked.manifestSha256,
      verifiedZipEntries,
      fileName: picked.fileName || '',
      db,
      userId,
    });

    return {
      ok: true,
      channel: 'native',
      stagingId: picked.stagingId,
      fileName: picked.fileName || '',
      inspection,
    };
  } catch (error) {
    if (picked.stagingId) {
      await plugin.cancelImport({ stagingId: picked.stagingId }).catch(() => {});
    }
    return {
      ok: false,
      error: error?.message || 'Повреждённый или неподдерживаемый архив учебных материалов.',
    };
  }
}

export async function confirmArchiveImport(pendingImport, { db = null, userId = null } = {}) {
  if (!pendingImport?.inspection?.document) {
    throw new Error('Нет подготовленного архива для импорта.');
  }
  const database = db || await prepareLocalDb();

  const commitMedia = pendingImport.channel === 'native'
    ? async (assets) => {
      await getOfflineMaterialArchivePlugin().commitImportMedia({
        stagingId: pendingImport.stagingId,
        assets,
      });
      registerNativeMediaFiles(assets);
    }
    : async (assets) => storeWebMediaAssets(database, assets, pendingImport.blobsBySha);

  const result = await applyMaterialArchiveImport({
    inspection: pendingImport.inspection,
    commitMedia,
    db: database,
    userId,
    fileName: pendingImport.fileName || '',
  });

  await initOfflineMediaStore(database);
  return result;
}

export async function cancelPendingArchiveImport(pendingImport) {
  if (pendingImport?.channel === 'native' && pendingImport?.stagingId && isNativeMaterialArchiveAvailable()) {
    await getOfflineMaterialArchivePlugin().cancelImport({ stagingId: pendingImport.stagingId }).catch(() => {});
  }
}

export async function buildWebArchiveZipBytes({
  db = null,
  folderIds = [],
  deckIds = [],
  selectAll = false,
  now = new Date(),
} = {}) {
  const database = db || await prepareLocalDb();
  const exported = await buildMaterialArchiveExport({
    db: database,
    folderIds,
    deckIds,
    selectAll,
    readAssetBytes: (folder, filename) => readWebMediaAssetBytes(database, folder, filename),
    now,
  });

  const encoder = new TextEncoder();
  const entries = [
    { name: 'manifest.json', data: encoder.encode(exported.manifestJson) },
    { name: 'manifest.sha256', data: encoder.encode(exported.manifestSha256) },
    ...exported.assets.map(asset => ({
      name: asset.path,
      data: exported.blobsBySha.get(asset.sha256),
    })),
  ];
  const zipBytes = await buildZipArchive(entries);

  return {
    zipBytes,
    fileName: exported.fileName,
    summary: exported.summary,
    document: exported.document,
    manifestSha256: exported.manifestSha256,
  };
}

export async function exportSelectedMaterialsZip({
  db = null,
  folderIds = [],
  deckIds = [],
  selectAll = false,
  now = new Date(),
} = {}) {
  const database = db || await prepareLocalDb();

  if (isNativeMaterialArchiveAvailable()) {
    const plugin = getOfflineMaterialArchivePlugin();
    const exported = await buildMaterialArchiveExport({
      db: database,
      folderIds,
      deckIds,
      selectAll,
      inspectNativeAssets: (assets) => plugin.inspectExistingMedia({ assets }),
      now,
    });
    const res = await plugin.exportArchiveZip({
      fileName: exported.fileName,
      manifestJson: exported.manifestJson,
      manifestSha256: exported.manifestSha256,
      assets: exported.assets,
    });
    if (res?.cancelled) {
      return { cancelled: true };
    }
    return {
      cancelled: false,
      saved: true,
      fileName: res?.fileName || exported.fileName,
      uri: res?.uri || '',
      summary: exported.summary,
      channel: 'native-saf',
    };
  }

  const { zipBytes, fileName, summary } = await buildWebArchiveZipBytes({
    db: database,
    folderIds,
    deckIds,
    selectAll,
    now,
  });

  const blob = new Blob([zipBytes], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return {
    cancelled: false,
    saved: true,
    fileName,
    summary,
    zipBytes,
    channel: 'browser-download',
  };
}
