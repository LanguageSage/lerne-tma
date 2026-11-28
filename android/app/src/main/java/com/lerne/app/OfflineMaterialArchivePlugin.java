package com.lerne.app;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.provider.DocumentsContract;
import android.util.Base64;
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
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.Enumeration;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.CRC32;
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
    private static final Pattern SHA256_PATTERN = Pattern.compile("^[a-f0-9]{64}$");
    private static final Pattern STAGING_ID_PATTERN = Pattern.compile("^[A-Za-z0-9-]{8,64}$");
    private static final String PROCESS_ID = UUID.randomUUID().toString().substring(0, 8);
    private static final Pattern STAGED_FILE = Pattern.compile("(?:import|export|probe)-[a-f0-9-]+\\.(?:zip|tmp)");
    private static final Pattern PARTIAL_MEDIA = Pattern.compile("archive_[a-f0-9]{64}\\.[a-z0-9]{2,4}\\.[a-f0-9-]+\\.partial");
    private static boolean cleanedStaging;

    private final ExecutorService ioExecutor = Executors.newSingleThreadExecutor();
    private final Map<String, File> pendingExports = new ConcurrentHashMap<>();
    // Confined to ioExecutor. Only files created by this staging operation may be removed.
    private final Map<String, Set<File>> pendingImports = new ConcurrentHashMap<>();

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
    public void listMediaAssets(PluginCall call) {
        String filterFolder = call.getString("folder", null);
        ioExecutor.execute(() -> {
            try {
                File mediaRoot = ensureMediaRoot();
                MediaScanResult scan = scanMediaRoot(mediaRoot, filterFolder);
                JSONArray assets = new JSONArray();
                for (ScannedMediaAsset asset : scan.assets) {
                    JSONObject item = new JSONObject();
                    item.put("folder", asset.folder);
                    item.put("filename", asset.filename);
                    item.put("relativePath", asset.relativePath);
                    item.put("sha256", asset.sha256);
                    item.put("size", asset.size);
                    item.put("mime", asset.mime);
                    item.put("path", asset.path);
                    assets.put(item);
                }
                JSONArray invalid = new JSONArray();
                for (InvalidMediaAsset bad : scan.invalid) {
                    JSONObject item = new JSONObject();
                    item.put("relativePath", bad.relativePath);
                    item.put("reason", bad.reason);
                    invalid.put(item);
                }
                JSObject res = new JSObject();
                res.put("mediaRoot", mediaRoot.getAbsolutePath());
                res.put("assets", assets);
                res.put("invalid", invalid);
                call.resolve(res);
            } catch (Exception ex) {
                call.reject("Failed to list offline media files: " + ex.getMessage(), ex);
            }
        });
    }

    @PluginMethod
    public void statMediaAsset(PluginCall call) {
        String folder = call.getString("folder", "");
        String filename = call.getString("filename", "");
        ioExecutor.execute(() -> {
            try {
                File mediaRoot = ensureMediaRoot();
                MediaStatResult stat = statSingleMediaAsset(mediaRoot, folder, filename);
                JSObject res = new JSObject();
                res.put("exists", stat.exists);
                res.put("valid", stat.valid);
                if (stat.valid) {
                    res.put("folder", stat.folder);
                    res.put("filename", stat.filename);
                    res.put("relativePath", stat.relativePath);
                    res.put("sha256", stat.sha256);
                    res.put("size", stat.size);
                    res.put("mime", stat.mime);
                    res.put("path", stat.path);
                } else if (stat.exists) {
                    res.put("relativePath", stat.relativePath);
                    res.put("reason", stat.reason);
                }
                call.resolve(res);
            } catch (Exception ex) {
                call.reject("Failed to inspect offline media file: " + ex.getMessage(), ex);
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
            } catch (RuntimeException ex) {
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
        ioExecutor.execute(() -> {
            String stagingId = PROCESS_ID + "-" + UUID.randomUUID().toString();
            File stagedZip = null;
            try {
                File stagingDir = ensureStagingDir();
                stagedZip = new File(stagingDir, "import-" + stagingId + ".zip");
                copyUriToBoundedFile(uri, stagedZip, MAX_ARCHIVE_BYTES);

                JSObject inspected = inspectStagedZip(stagedZip, stagingDir);
                inspected.put("cancelled", false);
                inspected.put("stagingId", stagingId);
                inspected.put("fileName", resolveDisplayName(uri, ""));
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
        if (assets == null || assets.length() > MAX_ASSETS) {
            call.reject("Assets list is required");
            return;
        }

        ioExecutor.execute(() -> {
            try {
                File stagingDir = ensureStagingDir();
                File stagedZip = new File(stagingDir, "import-" + stagingId + ".zip");
                if (!stagedZip.isFile()) {
                    call.reject("Staged archive is no longer available. Please pick the ZIP again.");
                    return;
                }
                File mediaRoot = ensureMediaRoot();
                Set<File> created = new HashSet<>();
                JSObject outcome;
                try {
                    outcome = extractAndVerifyAssets(stagedZip, mediaRoot, assets, created);
                } finally {
                    if (!created.isEmpty()) pendingImports.computeIfAbsent(stagingId, id -> new HashSet<>()).addAll(created);
                }
                outcome.put("mediaRoot", mediaRoot.getAbsolutePath());
                call.resolve(outcome);
            } catch (Exception ex) {
                call.reject(ex.getMessage() != null ? ex.getMessage() : "Failed to save archive media files", ex);
            }
        });
    }

    @PluginMethod
    public void rollbackImportMedia(PluginCall call) {
        String stagingId = call.getString("stagingId");
        JSArray protectedPaths = call.getArray("protectedPaths");
        if (stagingId == null || !STAGING_ID_PATTERN.matcher(stagingId).matches()
            || protectedPaths == null || protectedPaths.length() > MAX_ASSETS) {
            call.reject("Invalid archive rollback request");
            return;
        }
        ioExecutor.execute(() -> {
            try {
                Set<File> created = pendingImports.get(stagingId);
                if (created != null) {
                    Set<String> retained = new HashSet<>();
                    for (int i = 0; i < protectedPaths.length(); i++) retained.add(protectedPaths.getString(i));
                    for (File file : new ArrayList<>(created)) {
                        String path = file.getParentFile().getName() + "/" + file.getName();
                        if (!retained.contains(path) && file.exists() && !file.delete()) {
                            throw new IOException("Unable to roll back archive media: " + path);
                        }
                        created.remove(file);
                    }
                    pendingImports.remove(stagingId);
                }
                call.resolve();
            } catch (IOException | JSONException error) {
                call.reject(error.getMessage(), error);
            }
        });
    }

    @PluginMethod
    public void cancelImport(PluginCall call) {
        String stagingId = call.getString("stagingId");
        ioExecutor.execute(() -> {
            if (stagingId != null && STAGING_ID_PATTERN.matcher(stagingId).matches()) {
                pendingImports.remove(stagingId);
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
    public void storeMediaAsset(PluginCall call) {
        String folder = call.getString("folder", "");
        String filename = call.getString("filename", "");
        String expectedSha = call.getString("sha256", "");
        long expectedSize = call.getData() != null ? call.getData().optLong("size", -1L) : -1L;
        String dataBase64 = call.getString("dataBase64", "");
        boolean repairCorruptAudio = "audio".equals(folder) && Boolean.TRUE.equals(call.getBoolean("repairCorruptAudio"));

        if (!"images".equals(folder) && !"audio".equals(folder) && !"videos".equals(folder)) {
            call.reject("Unsupported local media folder");
            return;
        }
        if (expectedSha == null || !SHA256_PATTERN.matcher(expectedSha).matches()) {
            call.reject("Invalid media checksum");
            return;
        }
        if (filename == null || !ASSET_FILENAME_PATTERN.matcher(filename).matches()
            || !filename.startsWith("archive_" + expectedSha + ".")) {
            call.reject("Invalid canonical media filename");
            return;
        }
        if (expectedSize <= 0 || expectedSize > MAX_ASSET_BYTES) {
            call.reject("Медиафайл превышает лимит 20 МБ.");
            return;
        }
        if (dataBase64 == null || dataBase64.isEmpty()) {
            call.reject("Empty media payload");
            return;
        }

        ioExecutor.execute(() -> {
            File partial = null;
            try {
                byte[] bytes;
                try {
                    bytes = Base64.decode(dataBase64, Base64.DEFAULT);
                } catch (IllegalArgumentException ex) {
                    call.reject("Некорректные байты медиафайла.");
                    return;
                }
                if (bytes.length != expectedSize || bytes.length > MAX_ASSET_BYTES) {
                    call.reject("Размер медиафайла не совпадает.");
                    return;
                }
                if (!expectedSha.equals(sha256Bytes(bytes))) {
                    call.reject("Контрольная сумма медиа не совпадает.");
                    return;
                }

                if ("images".equals(folder)) {
                    String[] extMime = imageExtAndMime(bytes);
                    if (extMime == null || !filename.endsWith(extMime[0])) {
                        call.reject("Повреждённое или неподдерживаемое изображение.");
                        return;
                    }
                    BitmapFactory.Options opts = new BitmapFactory.Options();
                    opts.inJustDecodeBounds = true;
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
                    if (opts.outWidth <= 0 || opts.outHeight <= 0
                        || ((long) opts.outWidth * (long) opts.outHeight) > MAX_IMAGE_PIXELS) {
                        call.reject("Повреждённое или слишком большое изображение.");
                        return;
                    }
                }

                File mediaRoot = ensureMediaRoot();
                File target = resolveSafeMediaTarget(mediaRoot, folder, filename);
                byte[] head = Arrays.copyOf(bytes, Math.min(bytes.length, 8192));

                if ("videos".equals(folder)) {
                    String[] extMime = detectVideoExtAndMime(head, bytes.length);
                    if (extMime == null || !filename.endsWith(extMime[0])) {
                        call.reject("Неподдерживаемое видео: ожидается MP4 или WebM.");
                        return;
                    }
                }

                if (target.isFile() && target.length() == expectedSize && expectedSha.equals(sha256File(target))) {
                    if ("audio".equals(folder)) {
                        String[] extMime = detectAudioExtAndMime(head, bytes.length, target);
                        if (extMime == null || !filename.endsWith(extMime[0])) {
                            call.reject("Неподдерживаемый или повреждённый аудиофайл.");
                            return;
                        }
                    }
                    // A separate authoring operation has reused the file.
                    for (Set<File> created : pendingImports.values()) created.remove(target);
                    JSObject res = new JSObject();
                    res.put("stored", false);
                    res.put("reused", true);
                    res.put("folder", folder);
                    res.put("filename", filename);
                    res.put("relativePath", folder + "/" + filename);
                    call.resolve(res);
                    return;
                }
                if (target.exists() && (!repairCorruptAudio || !target.isFile())) {
                    call.reject("Конфликт существующего медиа " + filename + ": файл не изменён.");
                    return;
                }

                File parent = target.getParentFile();
                if (parent != null && !parent.exists() && !parent.mkdirs()) {
                    throw new IOException("Unable to create media subfolder: " + parent.getName());
                }
                partial = new File(parent, target.getName() + "." + UUID.randomUUID().toString() + ".partial");
                try (FileOutputStream fos = new FileOutputStream(partial);
                     BufferedOutputStream out = new BufferedOutputStream(fos)) {
                    out.write(bytes);
                    out.flush();
                    fos.getFD().sync();
                }

                if ("audio".equals(folder)) {
                    String[] extMime = detectAudioExtAndMime(head, bytes.length, partial);
                    if (extMime == null || !filename.endsWith(extMime[0])) {
                        call.reject("Неподдерживаемый или повреждённый аудиофайл.");
                        return;
                    }
                }

                boolean renamed = partial.renameTo(target);
                if (!renamed) {
                    if (!target.isFile() || target.length() != expectedSize || !expectedSha.equals(sha256File(target))) {
                        throw new IOException("Не удалось сохранить медиафайл: " + target.getName());
                    }
                }
                // Repair publishes only bytes verified against the digest encoded in the filename.
                for (Set<File> created : pendingImports.values()) created.remove(target);

                JSObject res = new JSObject();
                res.put("stored", renamed);
                res.put("reused", !renamed);
                res.put("folder", folder);
                res.put("filename", filename);
                res.put("relativePath", folder + "/" + filename);
                call.resolve(res);
            } catch (Exception ex) {
                call.reject(ex.getMessage() != null ? ex.getMessage() : "Не удалось сохранить медиафайл.", ex);
            } finally {
                if (partial != null && partial.exists()) {
                    partial.delete();
                }
            }
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
                if (manifestBytes.length > MAX_MANIFEST_BYTES || assets.length() > MAX_ASSETS) {
                    throw new IOException("Архив превышает допустимые лимиты.");
                }
                String computedSha = sha256Bytes(manifestBytes);
                if (!computedSha.equals(manifestSha256.trim())) {
                    call.reject("Manifest checksum mismatch before creating ZIP");
                    return;
                }

                File mediaRoot = ensureMediaRoot();
                File stagingDir = ensureStagingDir();
                stagedExport = new File(stagingDir, "export-" + PROCESS_ID + "-" + UUID.randomUUID() + ".zip");

                writeExportZipFile(stagedExport, manifestBytes, manifestSha256.trim().getBytes(StandardCharsets.UTF_8), mediaRoot, assets);
                if (stagedExport.length() > MAX_ARCHIVE_BYTES) throw new IOException("Архив превышает 512 МБ.");
                verifyZipReadable(stagedExport);

                pendingExports.put(call.getCallbackId(), stagedExport);

                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/zip");
                intent.putExtra(Intent.EXTRA_TITLE, targetFileName);

                AppActivityRunner.runOnUi(this, () -> {
                    try {
                        startActivityForResult(call, intent, "handleExportZipResult");
                    } catch (RuntimeException ex) {
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
            try {
                long total = 0;
                try (InputStream in = new BufferedInputStream(new FileInputStream(stagedExport));
                     OutputStream out = openWritableStream(uri)) {
                    if (out == null) throw new IOException("Unable to open destination file for writing");
                    byte[] buffer = new byte[65536];
                    int read;
                    while ((read = in.read(buffer)) != -1) {
                        out.write(buffer, 0, read);
                        total += read;
                    }
                    if (total != stagedExport.length()) {
                        throw new IOException("Неполное чтение подготовленного ZIP-архива.");
                    }
                }

                JSObject response = new JSObject();
                response.put("cancelled", false);
                response.put("saved", true);
                response.put("uri", uri.toString());
                response.put("fileName", resolveDisplayName(uri, fallbackName));
                response.put("size", total);
                call.resolve(response);
            } catch (IOException | RuntimeException ex) {
                try {
                    DocumentsContract.deleteDocument(getContext().getContentResolver(), uri);
                } catch (IOException | RuntimeException ignored) {
                    // Some providers cannot delete a failed export.
                }
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
        synchronized (OfflineMaterialArchivePlugin.class) {
            if (!cleanedStaging) {
                File[] stale = dir.listFiles((parent, name) -> STAGED_FILE.matcher(name).matches()
                    && !name.contains("-" + PROCESS_ID + "-"));
                if (stale != null) for (File file : stale) file.delete();
                File mediaRoot = ensureMediaRoot();
                for (String folder : MEDIA_FOLDERS) {
                    File[] partials = new File(mediaRoot, folder)
                        .listFiles((parent, name) -> PARTIAL_MEDIA.matcher(name).matches());
                    if (partials != null) for (File file : partials) file.delete();
                }
                cleanedStaging = true;
            }
        }
        return dir;
    }

    static File resolveSafeMediaTarget(File mediaRoot, String folder, String filename) throws IOException {
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
        if (!targetCanonical.equals(rootCanonical + File.separator + folder + File.separator + filename)) {
            throw new IOException("Media path escapes storage root");
        }
        return target;
    }

    static final class ScannedMediaAsset {
        final String folder;
        final String filename;
        final String relativePath;
        final String sha256;
        final long size;
        final String mime;
        final String path;

        ScannedMediaAsset(String folder, String filename, String relativePath, String sha256, long size, String mime, String path) {
            this.folder = folder;
            this.filename = filename;
            this.relativePath = relativePath;
            this.sha256 = sha256;
            this.size = size;
            this.mime = mime;
            this.path = path;
        }
    }

    static final class InvalidMediaAsset {
        final String relativePath;
        final String reason;

        InvalidMediaAsset(String relativePath, String reason) {
            this.relativePath = relativePath;
            this.reason = reason;
        }
    }

    static final class MediaScanResult {
        final List<ScannedMediaAsset> assets;
        final List<InvalidMediaAsset> invalid;

        MediaScanResult(List<ScannedMediaAsset> assets, List<InvalidMediaAsset> invalid) {
            this.assets = assets;
            this.invalid = invalid;
        }
    }

    static final class MediaStatResult {
        final boolean exists;
        final boolean valid;
        final String folder;
        final String filename;
        final String relativePath;
        final String sha256;
        final long size;
        final String mime;
        final String path;
        final String reason;

        private MediaStatResult(
            boolean exists,
            boolean valid,
            String folder,
            String filename,
            String relativePath,
            String sha256,
            long size,
            String mime,
            String path,
            String reason
        ) {
            this.exists = exists;
            this.valid = valid;
            this.folder = folder;
            this.filename = filename;
            this.relativePath = relativePath;
            this.sha256 = sha256;
            this.size = size;
            this.mime = mime;
            this.path = path;
            this.reason = reason;
        }

        static MediaStatResult missing(String folder, String filename, String relativePath) {
            return new MediaStatResult(false, false, folder, filename, relativePath, null, 0L, null, null, null);
        }

        static MediaStatResult invalid(String folder, String filename, String relativePath, String reason) {
            return new MediaStatResult(true, false, folder, filename, relativePath, null, 0L, null, null, reason);
        }

        static MediaStatResult valid(
            String folder,
            String filename,
            String relativePath,
            String sha256,
            long size,
            String mime,
            String path
        ) {
            return new MediaStatResult(true, true, folder, filename, relativePath, sha256, size, mime, path, null);
        }
    }

    static MediaScanResult scanMediaRoot(File mediaRoot, String filterFolder) throws IOException {
        if (mediaRoot == null) {
            throw new IOException("Media root is required");
        }
        List<String> foldersToScan;
        if (filterFolder != null && !filterFolder.isEmpty()) {
            if (!MEDIA_FOLDERS.contains(filterFolder)) {
                throw new IOException("Unknown media category: " + filterFolder);
            }
            foldersToScan = Collections.singletonList(filterFolder);
        } else {
            foldersToScan = Arrays.asList("images", "audio", "videos", "backgrounds");
        }

        List<ScannedMediaAsset> validAssets = new ArrayList<>();
        List<InvalidMediaAsset> invalidAssets = new ArrayList<>();

        for (String folder : foldersToScan) {
            File folderDir = new File(mediaRoot, folder);
            if (!folderDir.isDirectory()) {
                continue;
            }
            File[] files = folderDir.listFiles();
            if (files == null) {
                continue;
            }
            Arrays.sort(files, Comparator.comparing(File::getName));
            for (File file : files) {
                if (!file.isFile()) {
                    continue;
                }
                String name = file.getName();
                if (PARTIAL_MEDIA.matcher(name).matches() || name.endsWith(".partial")) {
                    continue;
                }
                if (!ASSET_FILENAME_PATTERN.matcher(name).matches()) {
                    continue;
                }
                MediaStatResult stat = statSingleMediaAsset(mediaRoot, folder, name);
                if (stat.valid) {
                    validAssets.add(new ScannedMediaAsset(
                        stat.folder,
                        stat.filename,
                        stat.relativePath,
                        stat.sha256,
                        stat.size,
                        stat.mime,
                        stat.path
                    ));
                } else if (stat.exists) {
                    invalidAssets.add(new InvalidMediaAsset(stat.relativePath, stat.reason));
                }
            }
        }

        return new MediaScanResult(validAssets, invalidAssets);
    }

    static MediaStatResult statSingleMediaAsset(File mediaRoot, String folder, String filename) throws IOException {
        if (mediaRoot == null) {
            throw new IOException("Media root is required");
        }
        File target = resolveSafeMediaTarget(mediaRoot, folder, filename);
        String relativePath = folder + "/" + filename;
        if (!target.isFile()) {
            return MediaStatResult.missing(folder, filename, relativePath);
        }
        long size = target.length();
        if (size <= 0 || size > MAX_ASSET_BYTES) {
            return MediaStatResult.invalid(folder, filename, relativePath, "Invalid asset size");
        }
        String expectedSha = filename.substring(8, 72);
        String ext = filename.substring(72);
        String actualSha = sha256File(target);
        if (!expectedSha.equals(actualSha)) {
            return MediaStatResult.invalid(folder, filename, relativePath, "SHA-256 mismatch");
        }
        String[] extMime = detectAssetExtAndMime(folder, target, size);
        if (extMime == null || !ext.equals(extMime[0])) {
            return MediaStatResult.invalid(folder, filename, relativePath, "Unsupported or mismatched media signature");
        }
        return MediaStatResult.valid(
            folder,
            filename,
            relativePath,
            expectedSha,
            size,
            extMime[1],
            "media/" + expectedSha + ext
        );
    }

    private static byte[] readHeadBytes(File file, int maxLen) throws IOException {
        int cap = (int) Math.min(file.length(), maxLen);
        byte[] buf = new byte[cap];
        int offset = 0;
        try (InputStream in = new BufferedInputStream(new FileInputStream(file))) {
            while (offset < cap) {
                int read = in.read(buf, offset, cap - offset);
                if (read == -1) break;
                offset += read;
            }
        }
        return offset == cap ? buf : Arrays.copyOf(buf, offset);
    }

    private static String[] detectAssetExtAndMime(String folder, File file, long size) throws IOException {
        byte[] head = readHeadBytes(file, 8192);
        if ("images".equals(folder) || "backgrounds".equals(folder)) {
            return imageExtAndMime(head);
        }
        if ("audio".equals(folder)) {
            return detectAudioExtAndMime(head, size, file);
        }
        if ("videos".equals(folder)) {
            return detectVideoExtAndMime(head, size);
        }
        return null;
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

    private JSObject inspectStagedZip(File stagedZip, File stagingDir) throws IOException {
        MaterialZipHeaders.verify(stagedZip, MAX_ENTRIES);
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
                MaterialZipHeaders.validateEntryPath(name);
                if (!seenNames.add(name)) {
                    throw new IOException("Повторные файлы в архиве.");
                }
                long maxEntry = "manifest.json".equals(name)
                    ? MAX_MANIFEST_BYTES
                    : ("manifest.sha256".equals(name) ? 64L : MAX_ASSET_BYTES);
                long declared = entry.getSize();
                if (declared < 0 || declared > maxEntry
                    || (entry.getMethod() != ZipEntry.STORED && entry.getMethod() != ZipEntry.DEFLATED)) {
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
            String manifestJson = StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(manifestBytes)).toString();
            String manifestSha256 = StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(shaBytes)).toString();
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
                File probeFile = new File(stagingDir, "probe-" + PROCESS_ID + "-" + UUID.randomUUID() + ".tmp");
                try {
                    MediaProbe probe = probeZipMediaEntry(zip, entry, probeFile);
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
        if (entry.getSize() < 0 || entry.getSize() > maxBytes) {
            throw new IOException("Вложение превышает допустимый размер.");
        }
        byte[] bytes = new byte[(int) entry.getSize()];
        CRC32 crc = new CRC32();
        try (InputStream in = zip.getInputStream(entry)) {
            int offset = 0;
            while (offset < bytes.length) {
                int read = in.read(bytes, offset, bytes.length - offset);
                if (read == -1) throw new IOException("Неполное чтение ZIP: " + entry.getName());
                crc.update(bytes, offset, read);
                offset += read;
            }
            if (in.read() != -1) throw new IOException("Размер записи ZIP не совпадает.");
        }
        verifyEntryIntegrity(entry, bytes.length, crc);
        return bytes;
    }

    private static void verifyEntryIntegrity(ZipEntry entry, long size, CRC32 crc) throws IOException {
        if (size != entry.getSize() || crc.getValue() != entry.getCrc()) {
            throw new IOException("Размер или CRC-32 записи ZIP не совпадает: " + entry.getName());
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

    private MediaProbe probeZipMediaEntry(ZipFile zip, ZipEntry entry, File probeFile) throws IOException {
        MessageDigest digest = newSha256();
        CRC32 crc = new CRC32();
        byte[] prefix = new byte[8192];
        int prefixLen = 0;
        long total = 0;

        try (InputStream in = zip.getInputStream(entry);
             OutputStream out = new BufferedOutputStream(new FileOutputStream(probeFile))) {
            byte[] buffer = new byte[65536];
            int read;
            while ((read = in.read(buffer)) != -1) {
                if (total + read > entry.getSize()) {
                    throw new IOException("Медиафайл превышает лимит 20 МБ.");
                }
                digest.update(buffer, 0, read);
                crc.update(buffer, 0, read);
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

        verifyEntryIntegrity(entry, total, crc);
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

        String[] audioExtMime = entry.getName().endsWith(".mp4") ? null : detectAudioExtAndMime(head, total, probeFile);
        if (audioExtMime != null) {
            return new MediaProbe(sha, total, "audio", audioExtMime[0], audioExtMime[1]);
        }

        String[] videoExtMime = detectVideoExtAndMime(head, total);
        if (videoExtMime != null) {
            return new MediaProbe(sha, total, "video", videoExtMime[0], videoExtMime[1]);
        }

        throw new IOException("Неподдерживаемый или повреждённый медиафайл в архиве: " + entry.getName());
    }

    private JSObject extractAndVerifyAssets(File stagedZip, File mediaRoot, JSArray assets, Set<File> created)
        throws IOException, JSONException {
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
                if (entry == null || entry.isDirectory() || size <= 0 || size > MAX_ASSET_BYTES
                    || entry.getSize() != size || !path.startsWith("media/")
                    || !filename.equals("archive_" + path.substring("media/".length()))
                    || !filename.startsWith("archive_" + sha + ".")) {
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
                            if (total > sizes[i]) {
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
                        created.add(target);
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
            long archiveSize = (long) manifestBytes.length + manifestShaBytes.length;

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
                archiveSize += expectedSize;
                if (expectedSize <= 0 || expectedSize > MAX_ASSET_BYTES || archiveSize > MAX_ARCHIVE_BYTES) {
                    throw new IOException("Размер медиа в архиве превышает допустимый лимит.");
                }

                MaterialZipHeaders.validateEntryPath(entryPath);
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
                        total += read;
                        if (total > expectedSize) throw new IOException("Размер медиа изменился при экспорте.");
                        digest.update(buffer, 0, read);
                        zos.write(buffer, 0, read);
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
            return hasValidWavChunks(probeFile, totalLength) ? new String[] { ".wav", "audio/wav" } : null;
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

    private static boolean hasValidWavChunks(File probeFile, long size) throws IOException {
        byte[] bytes = new byte[8];
        ByteBuffer chunk = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        boolean format = false;
        boolean samples = false;
        try (RandomAccessFile file = new RandomAccessFile(probeFile, "r")) {
            for (long offset = 12; offset + bytes.length <= size;) {
                file.seek(offset);
                file.readFully(bytes);
                long length = chunk.getInt(4) & 0xffffffffL;
                long end = offset + bytes.length + length;
                if (end > size) return false;
                int type = chunk.getInt(0);
                if (type == 0x20746d66 && length >= 16) format = true; // fmt
                if (type == 0x61746164) { // data
                    if (length == 0) return false;
                    samples = true;
                }
                if (format && samples) return true;
                offset = end + (length & 1);
            }
        }
        return false;
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
