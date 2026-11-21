package com.lerne.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Storage Access Framework (SAF) + streaming ZIP/media storage plugin for offline lerne-materials archives.
 * Stores validated media files under getFilesDir()/lerne-offline-media/<folder>/archive_<sha256>.<ext>
 * and streams ZIPs directly to/from disk to avoid WebView memory limits.
 */
@CapacitorPlugin(name = "OfflineMaterialArchive")
public class OfflineMaterialArchivePlugin extends Plugin {

    private static final long MAX_ARCHIVE_BYTES = 512L * 1024L * 1024L;
    private static final long MAX_MANIFEST_BYTES = 64L * 1024L * 1024L;
    private static final long MAX_ASSET_BYTES = 20L * 1024L * 1024L;
    private static final int MAX_ASSETS = 10000;
    private static final int MAX_ENTRIES = MAX_ASSETS + 2;
    private static final long MAX_IMAGE_PIXELS = 25_000_000L;
    private static final String DEFAULT_EXPORT_NAME = "lerne-materials.zip";
    private static final String MEDIA_ROOT_DIR = "lerne-offline-media";
    private static final String STAGING_DIR = "lerne-archive-staging";

    private static final Set<String> MEDIA_FOLDERS = new HashSet<>(
        Arrays.asList("images", "audio", "videos", "backgrounds")
    );
    private static final Pattern ASSET_FILENAME_PATTERN = Pattern.compile(
        "^archive_[a-f0-9]{64}\\.[a-z0-9]{2,4}$"
    );
    private static final Pattern STAGING_ID_PATTERN = Pattern.compile("^[A-Za-z0-9-]{8,64}$");

    private final ExecutorService ioExecutor = Executors.newSingleThreadExecutor();
    private final Map<String, File> pendingExports = new ConcurrentHashMap<>();

    @Override
    protected void handleOnDestroy() {
        ioExecutor.shutdown();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void getMediaRoot(PluginCall call) {
        ioExecutor.execute(() -> {
            try {
                File root = ensureMediaRoot();
                JSObject res = new JSObject();
                res.put("mediaRoot", root.getAbsolutePath());
                call.resolve(res);
            } catch (IOException ex) {
                call.reject("Unable to initialize offline media directory: " + ex.getMessage(), ex);
            }
        });
    }

    @PluginMethod
    public void inspectExistingMedia(PluginCall call) {
        JSArray assets = call.getArray("assets");
        if (assets == null) {
            call.reject("Assets list is required");
            return;
        }
        ioExecutor.execute(() -> {
            try {
                File mediaRoot = ensureMediaRoot();
                JSONArray missing = new JSONArray();
                JSONArray corrupted = new JSONArray();
                int verifiedCount = 0;

                for (int i = 0; i < assets.length(); i++) {
                    JSONObject item = assets.getJSONObject(i);
                    String folder = item.optString("folder", "");
                    String filename = item.optString("filename", "");
                    String expectedSha = item.optString("sha256", "");
                    long expectedSize = item.optLong("size", -1L);
                    String rel = folder + "/" + filename;

                    File target;
                    try {
                        target = resolveSafeMediaTarget(mediaRoot, folder, filename);
                    } catch (IOException ex) {
                        corrupted.put(rel);
                        continue;
                    }

                    if (!target.isFile()) {
                        missing.put(rel);
                        continue;
                    }
                    if (expectedSize > 0 && target.length() != expectedSize) {
                        corrupted.put(rel);
                        continue;
                    }
                    String actualSha = sha256File(target);
                    if (!expectedSha.equals(actualSha)) {
                        corrupted.put(rel);
                        continue;
                    }
                    verifiedCount += 1;
                }

                JSObject res = new JSObject();
                res.put("missing", missing);
                res.put("corrupted", corrupted);
                res.put("verifiedCount", verifiedCount);
                call.resolve(res);
            } catch (Exception ex) {
                call.reject("Failed to verify offline media files: " + ex.getMessage(), ex);
            }
        });
    }

    @PluginMethod
    public void pickArchiveForImport(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {
            "application/zip",
            "application/x-zip-compressed",
            "application/octet-stream"
        });

        AppActivityRunner.runOnUi(this, () -> {
            try {
                startActivityForResult(call, intent, "handlePickArchiveResult");
            } catch (ActivityNotFoundException ex) {
                call.reject("System file picker is unavailable on this device", ex);
            }
        });
    }

    @ActivityCallback
    private void handlePickArchiveResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }

        Uri uri = result.getData().getData();
        String displayName = resolveDisplayName(uri, "");

        ioExecutor.execute(() -> {
            String stagingId = UUID.randomUUID().toString();
            File stagedZip = null;
            try {
                File stagingDir = ensureStagingDir();
                stagedZip = new File(stagingDir, "import-" + stagingId + ".zip");
                copyUriToBoundedFile(uri, stagedZip, MAX_ARCHIVE_BYTES);

                JSObject inspected = inspectStagedZip(stagedZip, stagingDir);
                inspected.put("cancelled", false);
                inspected.put("stagingId", stagingId);
                inspected.put("fileName", displayName);
                call.resolve(inspected);
            } catch (Exception ex) {
                if (stagedZip != null) {
                    // Delete invalid staged ZIP on failure.
                    stagedZip.delete();
                }
                call.reject(ex.getMessage() != null ? ex.getMessage() : "Invalid lerne-materials ZIP archive", ex);
            }
        });
    }

    @PluginMethod
    public void commitImportMedia(PluginCall call) {
        String stagingId = call.getString("stagingId");
        JSArray assets = call.getArray("assets");
        if (stagingId == null || !STAGING_ID_PATTERN.matcher(stagingId).matches()) {
            call.reject("Invalid archive staging identifier");
            return;
        }
        if (assets == null) {
            call.reject("Assets list is required");
            return;
        }

        ioExecutor.execute(() -> {
            File stagedZip = null;
            try {
                File stagingDir = ensureStagingDir();
                stagedZip = new File(stagingDir, "import-" + stagingId + ".zip");
                if (!stagedZip.isFile()) {
                    call.reject("Staged archive is no longer available. Please pick the ZIP again.");
                    return;
                }
                File mediaRoot = ensureMediaRoot();
                JSObject outcome = extractAndVerifyAssets(stagedZip, mediaRoot, assets);
                outcome.put("mediaRoot", mediaRoot.getAbsolutePath());
                call.resolve(outcome);
            } catch (Exception ex) {
                call.reject(ex.getMessage() != null ? ex.getMessage() : "Failed to save archive media files", ex);
            } finally {
                if (stagedZip != null && stagedZip.exists()) {
                    stagedZip.delete();
                }
            }
        });
    }

    @PluginMethod
    public void cancelImport(PluginCall call) {
        String stagingId = call.getString("stagingId");
        ioExecutor.execute(() -> {
            if (stagingId != null && STAGING_ID_PATTERN.matcher(stagingId).matches()) {
                try {
                    File stagingDir = ensureStagingDir();
                    File stagedZip = new File(stagingDir, "import-" + stagingId + ".zip");
                    if (stagedZip.exists()) {
                        stagedZip.delete();
                    }
                } catch (IOException ignored) {
                    // Best-effort staging cleanup.
                }
            }
            JSObject res = new JSObject();
            res.put("cancelled", true);
            call.resolve(res);
        });
    }

    @PluginMethod
    public void exportArchiveZip(PluginCall call) {
        String fileName = call.getString("fileName", DEFAULT_EXPORT_NAME);
        if (fileName == null || fileName.trim().isEmpty()) {
            fileName = DEFAULT_EXPORT_NAME;
        }
        String manifestJson = call.getString("manifestJson");
        String manifestSha256 = call.getString("manifestSha256");
        JSArray assets = call.getArray("assets");
        if (manifestJson == null || manifestJson.isEmpty() || manifestSha256 == null || assets == null) {
            call.reject("Archive manifest and assets are required for export");
            return;
        }

        final String targetFileName = fileName;
        ioExecutor.execute(() -> {
            File stagedExport = null;
            try {
                byte[] manifestBytes = manifestJson.getBytes(StandardCharsets.UTF_8);
                String computedSha = sha256Bytes(manifestBytes);
                if (!computedSha.equals(manifestSha256.trim())) {
                    call.reject("Manifest checksum mismatch before creating ZIP");
                    return;
                }

                File mediaRoot = ensureMediaRoot();
                File stagingDir = ensureStagingDir();
                stagedExport = new File(stagingDir, "export-" + UUID.randomUUID().toString() + ".zip");

                writeExportZipFile(stagedExport, manifestBytes, manifestSha256.trim().getBytes(StandardCharsets.UTF_8), mediaRoot, assets);
                verifyZipReadable(stagedExport);

                pendingExports.put(call.getCallbackId(), stagedExport);

                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/zip");
                intent.putExtra(Intent.EXTRA_TITLE, targetFileName);

                AppActivityRunner.runOnUi(this, () -> {
                    try {
                        startActivityForResult(call, intent, "handleExportZipResult");
                    } catch (ActivityNotFoundException ex) {
                        File removed = pendingExports.remove(call.getCallbackId());
                        if (removed != null) {
                            removed.delete();
                        }
                        call.reject("System file picker is unavailable on this device", ex);
                    }
                });
            } catch (Exception ex) {
                if (stagedExport != null && stagedExport.exists()) {
                    stagedExport.delete();
                }
                call.reject(ex.getMessage() != null ? ex.getMessage() : "Failed to prepare export ZIP archive", ex);
            }
        });
    }

    @ActivityCallback
    private void handleExportZipResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        final File stagedExport = pendingExports.remove(call.getCallbackId());
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            ioExecutor.execute(() -> {
                if (stagedExport != null && stagedExport.exists()) {
                    stagedExport.delete();
                }
                JSObject cancelled = new JSObject();
                cancelled.put("cancelled", true);
                call.resolve(cancelled);
            });
            return;
        }

        if (stagedExport == null || !stagedExport.isFile()) {
            call.reject("Prepared export archive is no longer available");
            return;
        }

        Uri uri = result.getData().getData();
        String fallbackName = call.getString("fileName", DEFAULT_EXPORT_NAME);

        ioExecutor.execute(() -> {
            try (InputStream in = new BufferedInputStream(new FileInputStream(stagedExport));
                 OutputStream out = openWritableStream(uri)) {
                if (out == null) {
                    call.reject("Unable to open destination file for writing");
                    return;
                }
                byte[] buffer = new byte[65536];
                int read;
                long total = 0;
                while ((read = in.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                    total += read;
                }
                out.flush();

                JSObject response = new JSObject();
                response.put("cancelled", false);
                response.put("saved", true);
                response.put("uri", uri.toString());
                response.put("fileName", resolveDisplayName(uri, fallbackName));
                response.put("size", total);
                call.resolve(response);
            } catch (IOException | SecurityException ex) {
                call.reject("Failed to write ZIP archive: " + ex.getMessage(), ex);
            } finally {
                if (stagedExport.exists()) {
                    stagedExport.delete();
                }
            }
        });
    }

    private File ensureMediaRoot() throws IOException {
        File dir = new File(getContext().getFilesDir(), MEDIA_ROOT_DIR);
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("Cannot create offline media directory");
        }
        return dir;
    }

    private File ensureStagingDir() throws IOException {
        File dir = new File(getContext().getCacheDir(), STAGING_DIR);
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("Cannot create archive staging directory");
        }
        return dir;
    }

    private File resolveSafeMediaTarget(File mediaRoot, String folder, String filename) throws IOException {
        if (!MEDIA_FOLDERS.contains(folder)) {
            throw new IOException("Unknown media category: " + folder);
        }
        if (filename == null || !ASSET_FILENAME_PATTERN.matcher(filename).matches()) {
            throw new IOException("Unsafe media filename: " + filename);
        }
        File folderDir = new File(mediaRoot, folder);
        File target = new File(folderDir, filename);
        String rootCanonical = mediaRoot.getCanonicalPath();
        String targetCanonical = target.getCanonicalPath();
        if (!targetCanonical.startsWith(rootCanonical + File.separator)) {
            throw new IOException("Media path escapes storage root");
        }
        return target;
    }

    private void copyUriToBoundedFile(Uri uri, File destination, long maxBytes) throws IOException {
        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            if (in == null) {
                throw new IOException("Unable to open selected ZIP archive");
            }
            try (OutputStream out = new BufferedOutputStream(new FileOutputStream(destination))) {
                byte[] buffer = new byte[65536];
                long total = 0;
                int read;
                while ((read = in.read(buffer)) != -1) {
                    total += read;
                    if (total > maxBytes) {
                        throw new IOException("Архив превышает 512 МБ.");
                    }
                    out.write(buffer, 0, read);
                }
                out.flush();
            }
        }
    }

    private static void validateEntryPath(String name) throws IOException {
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

    private JSObject inspectStagedZip(File stagedZip, File stagingDir) throws IOException {
        try (ZipFile zip = new ZipFile(stagedZip)) {
            Set<String> seenNames = new HashSet<>();
            long totalDeclaredUnpacked = 0;
            int count = 0;
            ZipEntry manifestEntry = null;
            ZipEntry shaEntry = null;

            Enumeration<? extends ZipEntry> entries = zip.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                count += 1;
                if (count > MAX_ENTRIES) {
                    throw new IOException("Слишком много файлов в архиве.");
                }
                String name = entry.getName();
                if (entry.isDirectory()) {
                    throw new IOException("Каталоги в архиве не поддерживаются.");
                }
                validateEntryPath(name);
                if (!seenNames.add(name)) {
                    throw new IOException("Повторные файлы в архиве.");
                }
                long maxEntry = "manifest.json".equals(name)
                    ? MAX_MANIFEST_BYTES
                    : ("manifest.sha256".equals(name) ? 64L : MAX_ASSET_BYTES);
                long declared = entry.getSize();
                if (declared > maxEntry) {
                    throw new IOException("Вложение превышает допустимый размер.");
                }
                if (declared > 0) {
                    totalDeclaredUnpacked += declared;
                    if (totalDeclaredUnpacked > MAX_ARCHIVE_BYTES) {
                        throw new IOException("Распакованный архив больше 512 МБ.");
                    }
                }
                if ("manifest.json".equals(name)) {
                    manifestEntry = entry;
                } else if ("manifest.sha256".equals(name)) {
                    shaEntry = entry;
                }
            }

            if (manifestEntry == null || shaEntry == null) {
                throw new IOException("В архиве отсутствуют manifest.json или manifest.sha256.");
            }

            byte[] manifestBytes = readBoundedEntryBytes(zip, manifestEntry, MAX_MANIFEST_BYTES);
            byte[] shaBytes = readBoundedEntryBytes(zip, shaEntry, 64L);
            String manifestJson = new String(manifestBytes, StandardCharsets.UTF_8);
            String manifestSha256 = new String(shaBytes, StandardCharsets.UTF_8);
            if (!sha256Bytes(manifestBytes).equals(manifestSha256.trim())) {
                throw new IOException("Контрольная сумма манифеста не совпадает.");
            }

            long actualTotalUnpacked = (long) manifestBytes.length + shaBytes.length;
            JSONArray zipEntriesMeta = new JSONArray();
            Enumeration<? extends ZipEntry> mediaEnum = zip.entries();
            while (mediaEnum.hasMoreElements()) {
                ZipEntry entry = mediaEnum.nextElement();
                String name = entry.getName();
                if ("manifest.json".equals(name) || "manifest.sha256".equals(name)) {
                    continue;
                }
                File probeFile = new File(stagingDir, "probe-" + UUID.randomUUID().toString() + ".tmp");
                try {
                    MediaProbe probe = probeZipMediaEntry(zip, entry, probeFile, MAX_ASSET_BYTES);
                    actualTotalUnpacked += probe.size;
                    if (actualTotalUnpacked > MAX_ARCHIVE_BYTES) {
                        throw new IOException("Распакованный архив больше 512 МБ.");
                    }
                    JSObject item = new JSObject();
                    item.put("path", name);
                    item.put("sha256", probe.sha256);
                    item.put("size", probe.size);
                    item.put("detectedKind", probe.detectedKind);
                    item.put("ext", probe.ext);
                    item.put("mime", probe.mime);
                    zipEntriesMeta.put(item);
                } finally {
                    if (probeFile.exists()) {
                        probeFile.delete();
                    }
                }
            }

            JSObject res = new JSObject();
            res.put("manifestJson", manifestJson);
            res.put("manifestSha256", manifestSha256);
            res.put("zipEntries", zipEntriesMeta);
            return res;
        }
    }

    private byte[] readBoundedEntryBytes(ZipFile zip, ZipEntry entry, long maxBytes) throws IOException {
        try (InputStream in = zip.getInputStream(entry);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16384];
            long total = 0;
            int read;
            while ((read = in.read(buffer)) != -1) {
                total += read;
                if (total > maxBytes) {
                    throw new IOException("Вложение превышает допустимый размер.");
                }
                out.write(buffer, 0, read);
            }
            return out.toByteArray();
        }
    }

    private static final class MediaProbe {
        final String sha256;
        final long size;
        final String detectedKind;
        final String ext;
        final String mime;

        MediaProbe(String sha256, long size, String detectedKind, String ext, String mime) {
            this.sha256 = sha256;
            this.size = size;
            this.detectedKind = detectedKind;
            this.ext = ext;
            this.mime = mime;
        }
    }

    private MediaProbe probeZipMediaEntry(ZipFile zip, ZipEntry entry, File probeFile, long maxBytes) throws IOException {
        MessageDigest digest = newSha256();
        byte[] prefix = new byte[8192];
        int prefixLen = 0;
        long total = 0;

        try (InputStream in = zip.getInputStream(entry);
             OutputStream out = new BufferedOutputStream(new FileOutputStream(probeFile))) {
            byte[] buffer = new byte[65536];
            int read;
            while ((read = in.read(buffer)) != -1) {
                if (total + read > maxBytes) {
                    throw new IOException("Медиафайл превышает лимит 20 МБ.");
                }
                digest.update(buffer, 0, read);
                out.write(buffer, 0, read);
                if (prefixLen < prefix.length) {
                    int toCopy = Math.min(read, prefix.length - prefixLen);
                    System.arraycopy(buffer, 0, prefix, prefixLen, toCopy);
                    prefixLen += toCopy;
                }
                total += read;
            }
            out.flush();
        }

        if (total <= 0) {
            throw new IOException("Пустой медиафайл в архиве.");
        }

        String sha = toHex(digest.digest());
        byte[] head = Arrays.copyOf(prefix, prefixLen);

        if (isImageSignature(head)) {
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(probeFile.getAbsolutePath(), opts);
            if (opts.outWidth <= 0 || opts.outHeight <= 0 || ((long) opts.outWidth * (long) opts.outHeight) > MAX_IMAGE_PIXELS) {
                throw new IOException("Повреждённое или слишком большое изображение в архиве.");
            }
            String[] extMime = imageExtAndMime(head);
            return new MediaProbe(sha, total, "image", extMime[0], extMime[1]);
        }

        String[] audioExtMime = detectAudioExtAndMime(head, total, probeFile);
        if (audioExtMime != null) {
            return new MediaProbe(sha, total, "audio", audioExtMime[0], audioExtMime[1]);
        }

        String[] videoExtMime = detectVideoExtAndMime(head, total);
        if (videoExtMime != null) {
            return new MediaProbe(sha, total, "video", videoExtMime[0], videoExtMime[1]);
        }

        throw new IOException("Неподдерживаемый или повреждённый медиафайл в архиве: " + entry.getName());
    }

    private JSObject extractAndVerifyAssets(File stagedZip, File mediaRoot, JSArray assets) throws IOException, JSONException {
        try (ZipFile zip = new ZipFile(stagedZip)) {
            int count = assets.length();
            File[] targets = new File[count];
            ZipEntry[] entries = new ZipEntry[count];
            String[] shas = new String[count];
            long[] sizes = new long[count];
            boolean[] alreadyPresent = new boolean[count];

            for (int i = 0; i < count; i++) {
                JSONObject item = assets.getJSONObject(i);
                String path = item.getString("path");
                String folder = item.getString("folder");
                String filename = item.getString("filename");
                String sha = item.getString("sha256");
                long size = item.getLong("size");

                File target = resolveSafeMediaTarget(mediaRoot, folder, filename);
                ZipEntry entry = zip.getEntry(path);
                if (entry == null || entry.isDirectory()) {
                    throw new IOException("Отсутствует медиафайл в ZIP: " + path);
                }
                if (target.exists()) {
                    if (!target.isFile() || target.length() != size || !sha.equals(sha256File(target))) {
                        throw new IOException("Конфликт существующего медиа " + filename + ": файл не изменён.");
                    }
                    alreadyPresent[i] = true;
                }
                targets[i] = target;
                entries[i] = entry;
                shas[i] = sha;
                sizes[i] = size;
            }

            int storedCount = 0;
            int reusedCount = 0;
            for (int i = 0; i < count; i++) {
                if (alreadyPresent[i]) {
                    reusedCount += 1;
                    continue;
                }
                File target = targets[i];
                File parent = target.getParentFile();
                if (parent != null && !parent.exists() && !parent.mkdirs()) {
                    throw new IOException("Unable to create media subfolder: " + parent.getName());
                }
                File partial = new File(parent, target.getName() + "." + UUID.randomUUID().toString() + ".partial");
                try {
                    MessageDigest digest = newSha256();
                    long total = 0;
                    try (InputStream in = zip.getInputStream(entries[i]);
                         FileOutputStream fos = new FileOutputStream(partial);
                         BufferedOutputStream out = new BufferedOutputStream(fos)) {
                        byte[] buffer = new byte[65536];
                        int read;
                        while ((read = in.read(buffer)) != -1) {
                            total += read;
                            if (total > MAX_ASSET_BYTES) {
                                throw new IOException("Медиафайл превышает лимит 20 МБ.");
                            }
                            digest.update(buffer, 0, read);
                            out.write(buffer, 0, read);
                        }
                        out.flush();
                        fos.getFD().sync();
                    }
                    if (total != sizes[i] || !shas[i].equals(toHex(digest.digest()))) {
                        throw new IOException("Контрольная сумма медиа при записи не совпадает: " + target.getName());
                    }
                    if (!partial.renameTo(target)) {
                        if (!target.isFile() || target.length() != sizes[i] || !shas[i].equals(sha256File(target))) {
                            throw new IOException("Не удалось сохранить медиафайл: " + target.getName());
                        }
                        reusedCount += 1;
                    } else {
                        storedCount += 1;
                    }
                } finally {
                    if (partial.exists()) {
                        partial.delete();
                    }
                }
            }

            JSObject res = new JSObject();
            res.put("storedCount", storedCount);
            res.put("reusedCount", reusedCount);
            return res;
        }
    }

    private void writeExportZipFile(
        File outputZip,
        byte[] manifestBytes,
        byte[] manifestShaBytes,
        File mediaRoot,
        JSArray assets
    ) throws IOException, JSONException {
        try (FileOutputStream fos = new FileOutputStream(outputZip);
             ZipOutputStream zos = new ZipOutputStream(new BufferedOutputStream(fos))) {

            zos.putNextEntry(new ZipEntry("manifest.json"));
            zos.write(manifestBytes);
            zos.closeEntry();

            zos.putNextEntry(new ZipEntry("manifest.sha256"));
            zos.write(manifestShaBytes);
            zos.closeEntry();

            byte[] buffer = new byte[65536];
            for (int i = 0; i < assets.length(); i++) {
                JSONObject item = assets.getJSONObject(i);
                String folder = item.getString("folder");
                String filename = item.getString("filename");
                String entryPath = item.getString("path");
                String expectedSha = item.getString("sha256");
                long expectedSize = item.getLong("size");

                validateEntryPath(entryPath);
                File source = resolveSafeMediaTarget(mediaRoot, folder, filename);
                if (!source.isFile() || source.length() != expectedSize) {
                    throw new IOException("Медиафайл отсутствует или изменился: " + folder + "/" + filename);
                }

                zos.putNextEntry(new ZipEntry(entryPath));
                MessageDigest digest = newSha256();
                long total = 0;
                try (InputStream in = new BufferedInputStream(new FileInputStream(source))) {
                    int read;
                    while ((read = in.read(buffer)) != -1) {
                        digest.update(buffer, 0, read);
                        zos.write(buffer, 0, read);
                        total += read;
                    }
                }
                zos.closeEntry();

                if (total != expectedSize || !expectedSha.equals(toHex(digest.digest()))) {
                    throw new IOException("Контрольная сумма медиа изменилась при экспорте: " + filename);
                }
            }
            zos.finish();
            zos.flush();
            fos.getFD().sync();
        }
    }

    private void verifyZipReadable(File zipFile) throws IOException {
        try (ZipFile zip = new ZipFile(zipFile)) {
            if (zip.getEntry("manifest.json") == null || zip.getEntry("manifest.sha256") == null) {
                throw new IOException("Созданный архив не содержит обязательных манифестов.");
            }
        }
    }

    private OutputStream openWritableStream(Uri uri) throws FileNotFoundException {
        try {
            return getContext().getContentResolver().openOutputStream(uri, "wt");
        } catch (FileNotFoundException | UnsupportedOperationException | IllegalArgumentException fallbackTrigger) {
            return getContext().getContentResolver().openOutputStream(uri, "w");
        }
    }

    private String resolveDisplayName(Uri uri, String fallback) {
        try (Cursor cursor = getContext().getContentResolver().query(
            uri,
            new String[] { OpenableColumns.DISPLAY_NAME },
            null,
            null,
            null
        )) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    String name = cursor.getString(index);
                    if (name != null && !name.trim().isEmpty()) {
                        return name;
                    }
                }
            }
        } catch (Exception ignored) {
            // Fall back when provider does not expose DISPLAY_NAME.
        }
        return fallback != null ? fallback : "";
    }

    private static MessageDigest newSha256() throws IOException {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException ex) {
            throw new IOException("SHA-256 unavailable", ex);
        }
    }

    private static String sha256Bytes(byte[] data) throws IOException {
        MessageDigest digest = newSha256();
        return toHex(digest.digest(data));
    }

    private static String sha256File(File file) throws IOException {
        MessageDigest digest = newSha256();
        byte[] buffer = new byte[65536];
        try (InputStream in = new BufferedInputStream(new FileInputStream(file))) {
            int read;
            while ((read = in.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        return toHex(digest.digest());
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format(Locale.US, "%02x", b & 0xff));
        }
        return sb.toString();
    }

    private static boolean isImageSignature(byte[] b) {
        return imageExtAndMime(b) != null;
    }

    private static String[] imageExtAndMime(byte[] b) {
        if (b.length >= 8
            && (b[0] & 0xff) == 0x89 && b[1] == 0x50 && b[2] == 0x4e && b[3] == 0x47
            && b[4] == 0x0d && b[5] == 0x0a && b[6] == 0x1a && b[7] == 0x0a) {
            return new String[] { ".png", "image/png" };
        }
        if (b.length >= 3 && (b[0] & 0xff) == 0xff && (b[1] & 0xff) == 0xd8 && (b[2] & 0xff) == 0xff) {
            return new String[] { ".jpg", "image/jpeg" };
        }
        if (b.length >= 6 && b[0] == 'G' && b[1] == 'I' && b[2] == 'F' && b[3] == '8'
            && (b[4] == '7' || b[4] == '9') && b[5] == 'a') {
            return new String[] { ".gif", "image/gif" };
        }
        if (b.length >= 12
            && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F'
            && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') {
            return new String[] { ".webp", "image/webp" };
        }
        return null;
    }

    private static String[] detectAudioExtAndMime(byte[] b, long totalLength, File probeFile) throws IOException {
        if (totalLength < 128) {
            return null;
        }
        if (b.length >= 12
            && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F'
            && b[8] == 'W' && b[9] == 'A' && b[10] == 'V' && b[11] == 'E') {
            return new String[] { ".wav", "audio/wav" };
        }
        if (b.length >= 4 && b[0] == 'O' && b[1] == 'g' && b[2] == 'g' && b[3] == 'S') {
            return new String[] { ".ogg", "audio/ogg" };
        }
        if (b.length >= 4 && b[0] == 'f' && b[1] == 'L' && b[2] == 'a' && b[3] == 'C') {
            return new String[] { ".flac", "audio/flac" };
        }
        if (b.length >= 8 && b[4] == 'f' && b[5] == 't' && b[6] == 'y' && b[7] == 'p') {
            return new String[] { ".m4a", "audio/mp4" };
        }
        if (hasMp3Header(b, probeFile, totalLength)) {
            return new String[] { ".mp3", "audio/mpeg" };
        }
        return null;
    }

    private static boolean hasMp3Header(byte[] b, File probeFile, long totalLength) throws IOException {
        int offset = 0;
        if (b.length >= 10 && b[0] == 'I' && b[1] == 'D' && b[2] == '3') {
            if ((b[6] & 0x80) != 0 || (b[7] & 0x80) != 0 || (b[8] & 0x80) != 0 || (b[9] & 0x80) != 0) {
                return false;
            }
            offset = 10 + (((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f));
        }
        byte[] window = b;
        int start = offset;
        int end = Math.min(b.length, offset + 4096);
        if (offset + 4096 > b.length && offset < totalLength) {
            window = new byte[(int) Math.min(4096L, totalLength - offset)];
            try (InputStream in = new BufferedInputStream(new FileInputStream(probeFile))) {
                long remaining = offset;
                while (remaining > 0) {
                    long skipped = in.skip(remaining);
                    if (skipped <= 0) {
                        if (in.read() == -1) return false;
                        skipped = 1;
                    }
                    remaining -= skipped;
                }
                int pos = 0;
                while (pos < window.length) {
                    int read = in.read(window, pos, window.length - pos);
                    if (read == -1) break;
                    pos += read;
                }
                end = pos;
                start = 0;
            }
        }
        for (int i = start; i < end - 3; i++) {
            int b0 = window[i] & 0xff;
            int b1 = window[i + 1] & 0xff;
            int b2 = window[i + 2] & 0xff;
            if (b0 == 0xff
                && (b1 & 0xe0) == 0xe0
                && (b1 & 0x18) != 0x08
                && (b1 & 0x06) != 0
                && (b2 >> 4) != 0
                && (b2 >> 4) != 15
                && (b2 & 0x0c) != 0x0c) {
                return true;
            }
        }
        return false;
    }

    private static String[] detectVideoExtAndMime(byte[] b, long totalLength) {
        if (totalLength < 32) {
            return null;
        }
        if (b.length >= 8 && b[4] == 'f' && b[5] == 't' && b[6] == 'y' && b[7] == 'p') {
            return new String[] { ".mp4", "video/mp4" };
        }
        if (b.length >= 4 && (b[0] & 0xff) == 0x1a && b[1] == 0x45 && (b[2] & 0xff) == 0xdf && (b[3] & 0xff) == 0xa3) {
            return new String[] { ".webm", "video/webm" };
        }
        return null;
    }

    private static final class AppActivityRunner {
        static void runOnUi(Plugin plugin, Runnable action) {
            Activity activity = plugin.getActivity();
            if (activity != null) {
                activity.runOnUiThread(action);
            } else {
                action.run();
            }
        }
    }
}
