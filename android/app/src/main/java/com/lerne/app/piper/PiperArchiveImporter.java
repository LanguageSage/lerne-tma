package com.lerne.app.piper;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Safe streaming importer for local Piper voice archives (.lerne-voice.zip or raw HuggingFace .zip).
 *
 * Security & reliability invariants:
 * - Bounded compressed & uncompressed byte budgets + raw entry cap (defends against zip bombs & __MACOSX closeEntry DoS).
 * - Strict zip-slip canonical path containment and duplicate-entry rejection.
 * - Free disk space headroom check (including 0-byte free space) before and during extraction.
 * - SHA-256 verification for all files listed in manifest.json (when present).
 * - Automatic tokens.txt + ONNX metadata_props preparation via PiperModelSupport.loadVoiceDescriptor().
 * - Atomic staging + rollback swap so corrupt/incomplete archives never damage installed models.
 */
public final class PiperArchiveImporter {

    public static final int MAX_ZIP_ENTRIES = 32;
    public static final int MAX_RAW_ZIP_ENTRIES = 128;
    public static final long MAX_ARCHIVE_COMPRESSED_BYTES = 350L * 1024L * 1024L;
    public static final long MAX_ARCHIVE_UNCOMPRESSED_BYTES = 350L * 1024L * 1024L;
    public static final long MIN_FREE_DISK_HEADROOM_BYTES = 64L * 1024L * 1024L;

    private static final Set<String> ALLOWED_EXACT_NAMES = new HashSet<>(
        Arrays.asList("tokens.txt", "manifest.json", "model_card", "license", "readme.md")
    );

    private PiperArchiveImporter() {}

    public static PiperVoiceDescriptor importFromZipStream(
        InputStream rawZipStream,
        File modelsRootDir,
        long availableDiskBytes,
        BooleanSupplier isCancelled,
        Consumer<String> beforeReplaceModelCallback
    ) throws IOException {
        if (rawZipStream == null) {
            throw new IOException("Поток архива голосовой модели пуст");
        }
        if (modelsRootDir == null || (!modelsRootDir.exists() && !modelsRootDir.mkdirs())) {
            throw new IOException("Не удалось подготовить каталог голосовых моделей Piper");
        }
        if (availableDiskBytes >= 0 && availableDiskBytes < MIN_FREE_DISK_HEADROOM_BYTES) {
            throw new IOException("Недостаточно свободного места на устройстве для импорта голосовой модели");
        }

        File stagingRawDir = new File(modelsRootDir, ".import-raw-" + UUID.randomUUID());
        File stagingReadyDir = new File(modelsRootDir, ".import-ready-" + UUID.randomUUID());
        File backupDir = null;

        try {
            if (!stagingRawDir.mkdirs() || !stagingReadyDir.mkdirs()) {
                throw new IOException("Не удалось создать временный каталог импорта модели");
            }
            String canonicalRawRoot = stagingRawDir.getCanonicalPath() + File.separator;

            int rawEntryCount = 0;
            int entryCount = 0;
            long totalExtractedBytes = 0L;
            byte[] buffer = new byte[65536];

            InputStream boundedCompressed = new BoundedCancelableInputStream(
                new BufferedInputStream(rawZipStream, 65536),
                MAX_ARCHIVE_COMPRESSED_BYTES,
                isCancelled
            );

            try (ZipInputStream zis = new ZipInputStream(boundedCompressed)) {
                ZipEntry entry;
                while ((entry = zis.getNextEntry()) != null) {
                    checkCancelled(isCancelled);
                    rawEntryCount += 1;
                    if (rawEntryCount > MAX_RAW_ZIP_ENTRIES) {
                        throw new IOException("Архив содержит слишком много служебных записей");
                    }

                    String rawName = entry.getName();
                    if (rawName == null || rawName.trim().isEmpty()) {
                        totalExtractedBytes = drainIgnoredEntry(zis, buffer, totalExtractedBytes, isCancelled);
                        zis.closeEntry();
                        continue;
                    }
                    String normalized = rawName.replace('\\', '/').trim();
                    if (normalized.startsWith("/")) {
                        throw new IOException("Недопустимый абсолютный путь в архиве модели: " + rawName);
                    }
                    if (normalized.contains("..")) {
                        throw new IOException("Обнаружен небезопасный путь (zip-slip) в архиве модели: " + rawName);
                    }
                    if (entry.isDirectory()) {
                        zis.closeEntry();
                        continue;
                    }

                    // Safely drain macOS metadata entries while enforcing uncompressed & cancel limits.
                    if (normalized.startsWith("__MACOSX/") || normalized.endsWith("/.DS_Store") || ".DS_Store".equals(normalized)) {
                        totalExtractedBytes = drainIgnoredEntry(zis, buffer, totalExtractedBytes, isCancelled);
                        zis.closeEntry();
                        continue;
                    }

                    entryCount += 1;
                    if (entryCount > MAX_ZIP_ENTRIES) {
                        throw new IOException("Архив голосовой модели содержит слишком много файлов (максимум " + MAX_ZIP_ENTRIES + ")");
                    }

                    String[] parts = normalized.split("/");
                    if (parts.length > 2) {
                        throw new IOException("Слишком глубокая вложенность папок в архиве модели: " + normalized);
                    }
                    String baseName = parts[parts.length - 1].trim();
                    if (!isAllowedModelArchiveFilename(baseName)) {
                        throw new IOException("Недопустимый файл в пакете голосовой модели: " + baseName);
                    }

                    File destFile = new File(stagingRawDir, normalized);
                    String canonicalDest = destFile.getCanonicalPath();
                    if (!canonicalDest.startsWith(canonicalRawRoot)) {
                        throw new IOException("Обнаружен выход за пределы каталога при распаковке модели");
                    }
                    if (destFile.exists()) {
                        throw new IOException("В архиве обнаружен дублирующийся файл: " + normalized);
                    }
                    File parent = destFile.getParentFile();
                    if (parent != null && !parent.exists() && !parent.mkdirs()) {
                        throw new IOException("Не удалось создать подкаталог при распаковке модели");
                    }

                    try (FileOutputStream fos = new FileOutputStream(destFile);
                         BufferedOutputStream out = new BufferedOutputStream(fos, 65536)) {
                        int read;
                        while ((read = zis.read(buffer)) != -1) {
                            checkCancelled(isCancelled);
                            totalExtractedBytes += read;
                            if (totalExtractedBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
                                throw new IOException("Превышен максимальный размер голосовой модели (350 МБ)");
                            }
                            if (availableDiskBytes >= 0
                                && (totalExtractedBytes + MIN_FREE_DISK_HEADROOM_BYTES) > availableDiskBytes) {
                                throw new IOException("Недостаточно свободного места на устройстве для распаковки модели");
                            }
                            out.write(buffer, 0, read);
                        }
                        out.flush();
                        fos.getFD().sync();
                    }
                    zis.closeEntry();
                }
            }

            if (entryCount == 0) {
                throw new IOException("Выбранный файл не является корректным ZIP-архивом голосовой модели Piper");
            }

            File sourceDir = resolveExtractedModelSourceDir(stagingRawDir);
            File[] extractedFiles = sourceDir.listFiles();
            if (extractedFiles == null || extractedFiles.length == 0) {
                throw new IOException("Архив голосовой модели пуст");
            }

            List<File> onnxFiles = new ArrayList<>();
            for (File f : extractedFiles) {
                if (f.isFile() && f.getName().endsWith(".onnx")) {
                    onnxFiles.add(f);
                }
            }
            if (onnxFiles.isEmpty()) {
                throw new IOException("В архиве отсутствует файл нейросетевой модели (.onnx)");
            }
            if (onnxFiles.size() > 1) {
                throw new IOException("В одном архиве должна находиться ровно одна модель (.onnx)");
            }

            File onnxFile = onnxFiles.get(0);
            String rawModelId = onnxFile.getName().substring(0, onnxFile.getName().length() - ".onnx".length());
            final String modelId;
            try {
                modelId = PiperModelSupport.validateModelId(rawModelId);
            } catch (IllegalArgumentException ex) {
                throw new IOException("Некорректное имя модели Piper: " + rawModelId, ex);
            }

            File onnxJsonFile = new File(sourceDir, onnxFile.getName() + ".json");
            if (!onnxJsonFile.isFile()) {
                File fallbackConfig = new File(sourceDir, "config.json");
                if (fallbackConfig.isFile()) {
                    if (!fallbackConfig.renameTo(onnxJsonFile)) {
                        throw new IOException("Не удалось подготовить конфигурацию .onnx.json для " + modelId);
                    }
                } else {
                    throw new IOException("В архиве отсутствует файл конфигурации " + onnxFile.getName() + ".json");
                }
            }

            File manifestFile = new File(sourceDir, "manifest.json");
            if (manifestFile.isFile()) {
                verifyManifestChecksums(sourceDir, manifestFile, onnxFile.getName(), isCancelled);
            }

            checkCancelled(isCancelled);

            for (File f : sourceDir.listFiles()) {
                if (!f.isFile()) continue;
                String name = f.getName();
                if (".bundled".equals(name) || ".imported".equals(name)) continue;
                File target = new File(stagingReadyDir, name);
                if (!f.renameTo(target)) {
                    throw new IOException("Не удалось подготовить файл модели: " + name);
                }
            }
            PiperModelSupport.writeUtf8Atomic(new File(stagingReadyDir, ".imported"), "imported");

            final PiperVoiceDescriptor validated;
            try {
                validated = PiperModelSupport.loadVoiceDescriptor(stagingReadyDir);
            } catch (JSONException ex) {
                throw new IOException("Повреждённый JSON конфигурации модели " + modelId + ": " + ex.getMessage(), ex);
            }
            if (validated.tokenCodepoints == null || validated.tokenCodepoints.size() < 5) {
                throw new IOException("Модель " + modelId + " не содержит фонетической таблицы (phoneme_id_map)");
            }
            if (validated.sampleRate < 8000 || validated.sampleRate > 96000) {
                throw new IOException("Неподдерживаемая частота дискретизации модели: " + validated.sampleRate);
            }
            if (validated.espeakVoice == null || validated.espeakVoice.trim().isEmpty()) {
                throw new IOException("В модели отсутствует фонетическая конфигурация espeak.voice");
            }

            checkCancelled(isCancelled);

            if (beforeReplaceModelCallback != null) {
                beforeReplaceModelCallback.accept(modelId);
            }

            File targetDir = new File(modelsRootDir, modelId);
            if (targetDir.exists()) {
                backupDir = new File(modelsRootDir, ".import-backup-" + modelId + "-" + UUID.randomUUID());
                if (!targetDir.renameTo(backupDir)) {
                    throw new IOException("Не удалось обновить уже установленную модель " + modelId);
                }
            }
            if (!stagingReadyDir.renameTo(targetDir)) {
                if (backupDir != null && backupDir.exists()) {
                    backupDir.renameTo(targetDir);
                }
                throw new IOException("Не удалось завершить установку голосовой модели " + modelId);
            }
            if (backupDir != null && backupDir.exists()) {
                PiperModelSupport.deleteRecursively(backupDir);
            }

            PiperBundledModelsInstaller.clearBundledDeletionTombstone(modelsRootDir, modelId);
            PiperModelSupport.invalidateDescriptorCache();

            try {
                return PiperModelSupport.loadVoiceDescriptor(targetDir);
            } catch (JSONException ex) {
                throw new IOException("Ошибка чтения установленной модели " + modelId, ex);
            }
        } finally {
            if (stagingRawDir.exists()) {
                PiperModelSupport.deleteRecursively(stagingRawDir);
            }
            if (stagingReadyDir.exists()) {
                PiperModelSupport.deleteRecursively(stagingReadyDir);
            }
        }
    }

    private static long drainIgnoredEntry(
        ZipInputStream zis,
        byte[] buffer,
        long currentTotal,
        BooleanSupplier isCancelled
    ) throws IOException {
        long total = currentTotal;
        int read;
        while ((read = zis.read(buffer)) != -1) {
            checkCancelled(isCancelled);
            total += read;
            if (total > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
                throw new IOException("Превышен максимальный размер распакованных данных архива (350 МБ)");
            }
        }
        return total;
    }

    private static final class BoundedCancelableInputStream extends FilterInputStream {
        private final long maxBytes;
        private final BooleanSupplier isCancelled;
        private long bytesRead = 0L;

        BoundedCancelableInputStream(InputStream in, long maxBytes, BooleanSupplier isCancelled) {
            super(in);
            this.maxBytes = maxBytes;
            this.isCancelled = isCancelled;
        }

        @Override
        public int read() throws IOException {
            checkCancelled(isCancelled);
            int b = super.read();
            if (b != -1) {
                bytesRead += 1L;
                if (bytesRead > maxBytes) {
                    throw new IOException("Размер архива голосовой модели превышает лимит 350 МБ");
                }
            }
            return b;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            checkCancelled(isCancelled);
            int r = super.read(b, off, len);
            if (r > 0) {
                bytesRead += r;
                if (bytesRead > maxBytes) {
                    throw new IOException("Размер архива голосовой модели превышает лимит 350 МБ");
                }
            }
            return r;
        }
    }

    private static File resolveExtractedModelSourceDir(File stagingRawDir) throws IOException {
        File[] children = stagingRawDir.listFiles();
        if (children == null || children.length == 0) {
            throw new IOException("Архив голосовой модели пуст");
        }
        boolean hasRootFiles = false;
        List<File> subdirs = new ArrayList<>();
        for (File child : children) {
            if (child.isFile()) {
                hasRootFiles = true;
            } else if (child.isDirectory()) {
                subdirs.add(child);
            }
        }
        if (!hasRootFiles && subdirs.size() == 1) {
            return subdirs.get(0);
        }
        if (hasRootFiles && subdirs.isEmpty()) {
            return stagingRawDir;
        }
        throw new IOException("Некорректная структура архива: файлы модели должны быть в корне или в одной папке");
    }

    private static boolean isAllowedModelArchiveFilename(String name) {
        if (name == null || name.isEmpty() || name.startsWith(".")) {
            return false;
        }
        String lower = name.toLowerCase(Locale.ROOT);
        if (ALLOWED_EXACT_NAMES.contains(lower)) {
            return true;
        }
        return lower.endsWith(".onnx")
            || lower.endsWith(".onnx.json")
            || lower.endsWith(".json")
            || lower.endsWith(".txt")
            || lower.endsWith(".md");
    }

    private static void verifyManifestChecksums(
        File sourceDir,
        File manifestFile,
        String onnxFileName,
        BooleanSupplier isCancelled
    ) throws IOException {
        final JSONObject manifest;
        try {
            manifest = new JSONObject(PiperModelSupport.readUtf8File(manifestFile));
        } catch (JSONException ex) {
            throw new IOException("Повреждённый manifest.json в архиве модели: " + ex.getMessage(), ex);
        }
        JSONObject filesObj = manifest.optJSONObject("files");
        if (filesObj == null) {
            return;
        }
        Iterator<String> keys = filesObj.keys();
        while (keys.hasNext()) {
            checkCancelled(isCancelled);
            String key = keys.next();
            JSONObject spec = filesObj.optJSONObject(key);
            if (spec == null) continue;
            String targetName = "onnx".equals(key) ? onnxFileName : key;
            if (targetName.contains("/") || targetName.contains("\\") || targetName.contains("..")) {
                throw new IOException("Некорректное имя файла в manifest.json: " + targetName);
            }
            File file = new File(sourceDir, targetName);
            if (!file.isFile()) {
                throw new IOException("В архиве отсутствует заявленный в manifest.json файл: " + targetName);
            }
            long expectedSize = spec.optLong("size_bytes", -1L);
            if (expectedSize > 0 && file.length() != expectedSize) {
                throw new IOException(
                    "Несовпадение размера файла " + targetName
                        + " (ожидалось " + expectedSize + " байт, получено " + file.length() + ")"
                );
            }
            String expectedSha = spec.optString("sha256", "").trim().toLowerCase(Locale.ROOT);
            if (!expectedSha.isEmpty()) {
                String actualSha = sha256Hex(file, isCancelled);
                if (!expectedSha.equals(actualSha)) {
                    throw new IOException("Контрольная сумма SHA-256 не совпала для файла " + targetName);
                }
            }
        }
    }

    static String sha256Hex(File file, BooleanSupplier isCancelled) throws IOException {
        final MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException ex) {
            throw new IOException("SHA-256 недоступен", ex);
        }
        byte[] buf = new byte[65536];
        try (InputStream in = new BufferedInputStream(new FileInputStream(file), 65536)) {
            int read;
            while ((read = in.read(buf)) != -1) {
                checkCancelled(isCancelled);
                digest.update(buf, 0, read);
            }
        }
        byte[] bytes = digest.digest();
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        }
        return sb.toString();
    }

    private static void checkCancelled(BooleanSupplier isCancelled) throws IOException {
        if ((isCancelled != null && isCancelled.getAsBoolean()) || Thread.currentThread().isInterrupted()) {
            throw new IOException("Импорт голосовой модели отменён");
        }
    }
}
