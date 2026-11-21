package com.lerne.app;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.zip.ZipEntry;

/** Checks ZIP metadata that is unavailable through ZipFile's public API. */
final class MaterialZipHeaders {
    private MaterialZipHeaders() {}

    static void validateEntryPath(String name) throws IOException {
        if (name == null || name.isEmpty() || name.length() > 1024) {
            throw new IOException("Некорректный путь файла в архиве.");
        }
        if (name.startsWith("/") || name.endsWith("/") || name.contains("\\") || name.contains(":") || name.contains("\0")) {
            throw new IOException("Недопустимый путь в архиве: " + name);
        }
        String[] parts = name.split("/", -1);
        for (String part : parts) {
            if (part.isEmpty() || ".".equals(part) || "..".equals(part)) {
                throw new IOException("Недопустимый путь в архиве: " + name);
            }
        }
    }

    // ZipFile owns decompression. Its public API does not expose Unix file types,
    // flags, or local header offsets, so check those before opening entry streams.
    static void verify(File archive, int maxEntries) throws IOException {
        try (RandomAccessFile file = new RandomAccessFile(archive, "r")) {
            int tailLength = (int) Math.min(file.length(), 65_557);
            long tailStart = file.length() - tailLength;
            ByteBuffer tail = readHeader(file, tailStart, tailLength);
            int end = tailLength - 22;
            while (end >= 0 && (tail.getInt(end) != 0x06054b50
                || end + 22 + (tail.getShort(end + 20) & 0xffff) != tailLength)) {
                end--;
            }
            if (end < 0) throw new IOException("Не найден центральный каталог ZIP.");

            long directoryStart = tail.getInt(end + 16) & 0xffffffffL;
            long directoryEnd = tailStart + end;
            int count = tail.getShort(end + 10) & 0xffff;
            if (tail.getInt(end + 4) != 0 || tail.getShort(end + 8) != count
                || count > maxEntries
                || directoryStart + (tail.getInt(end + 12) & 0xffffffffL) != directoryEnd) {
                throw new IOException("Повреждённый, многотомный или ZIP64-архив.");
            }

            List<long[]> ranges = new ArrayList<>(count);
            Set<String> names = new HashSet<>();
            long position = directoryStart;
            for (int i = 0; i < count; i++) {
                if (position + 46 > directoryEnd) throw new IOException("Неполный каталог ZIP.");
                ByteBuffer central = readHeader(file, position, 46);
                int flags = central.getShort(8) & 0xffff;
                int method = central.getShort(10);
                int nameLength = central.getShort(28) & 0xffff;
                int attributes = central.getInt(38);
                int kind = (attributes >>> 16) & 0170000;
                if (central.getInt(0) != 0x02014b50 || central.getShort(34) != 0
                    || (flags & ~0x080e) != 0 || (method != ZipEntry.STORED && method != ZipEntry.DEFLATED)
                    || (attributes & 0x10) != 0 || (kind != 0 && kind != 0100000)
                    || nameLength == 0 || nameLength > 4096) {
                    throw new IOException("Недопустимый тип, метод или имя записи ZIP.");
                }
                long next = position + 46 + nameLength + (central.getShort(30) & 0xffff)
                    + (central.getShort(32) & 0xffff);
                long start = central.getInt(42) & 0xffffffffL;
                if (next > directoryEnd || start + 30 + nameLength > directoryStart) {
                    throw new IOException("Заголовок ZIP выходит за пределы архива.");
                }
                ByteBuffer local = readHeader(file, start, 30);
                ByteBuffer centralName = readHeader(file, position + 46, nameLength);
                String name = StandardCharsets.UTF_8.newDecoder().decode(centralName.asReadOnlyBuffer()).toString();
                validateEntryPath(name);
                if (!names.add(name)) throw new IOException("Повторные файлы в архиве.");
                long dataStart = start + 30 + nameLength + (local.getShort(28) & 0xffff);
                long dataEnd = dataStart + (central.getInt(20) & 0xffffffffL);
                if (local.getInt(0) != 0x04034b50 || local.getShort(6) != flags
                    || local.getShort(8) != method || local.getShort(26) != nameLength
                    || !readHeader(file, start + 30, nameLength).equals(centralName)
                    || dataEnd > directoryStart || (method == ZipEntry.STORED && central.getInt(20) != central.getInt(24))) {
                    throw new IOException("Несогласованный локальный заголовок ZIP.");
                }
                if ((flags & 8) != 0) {
                    if (dataEnd + 12 > directoryStart) throw new IOException("Неполный дескриптор ZIP.");
                    ByteBuffer descriptor = readHeader(file, dataEnd, (int) Math.min(16, directoryStart - dataEnd));
                    if (descriptor.capacity() == 16 && descriptor.getInt(0) == 0x08074b50
                        && matchesZipDetails(central, descriptor, 4)) {
                        dataEnd += 16;
                    } else if (matchesZipDetails(central, descriptor, 0)) {
                        dataEnd += 12;
                    } else {
                        throw new IOException("Несогласованный дескриптор ZIP.");
                    }
                } else if (!matchesZipDetails(central, local, 14)) {
                    throw new IOException("Несогласованный размер или CRC-32 локальной записи ZIP.");
                }
                ranges.add(new long[] { start, dataEnd });
                position = next;
            }
            if (position != directoryEnd) throw new IOException("Размер каталога ZIP не совпадает.");
            ranges.sort(Comparator.comparingLong(range -> range[0]));
            long previousEnd = 0;
            for (long[] range : ranges) {
                if (range[0] < previousEnd) throw new IOException("Перекрывающиеся записи ZIP.");
                previousEnd = range[1];
            }
        }
    }

    private static ByteBuffer readHeader(RandomAccessFile file, long offset, int length) throws IOException {
        byte[] bytes = new byte[length];
        file.seek(offset);
        file.readFully(bytes);
        return ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
    }

    private static boolean matchesZipDetails(ByteBuffer directory, ByteBuffer header, int offset) {
        return directory.getInt(16) == header.getInt(offset)
            && directory.getInt(20) == header.getInt(offset + 4)
            && directory.getInt(24) == header.getInt(offset + 8);
    }

}
