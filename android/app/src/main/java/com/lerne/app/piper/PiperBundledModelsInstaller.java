package com.lerne.app.piper;

import android.content.res.AssetManager;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.function.Consumer;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Upgrade-safe, idempotent extractor for Piper voice models bundled inside APK assets
 * under assets/lerne-bundled-piper-models/<modelId>/.
 */
public final class PiperBundledModelsInstaller {

    public static final String BUNDLED_ASSETS_ROOT = "lerne-bundled-piper-models";
    public static final String TOMBSTONES_SUBDIR = ".deleted-bundled";

    private static final String[] STALE_STAGING_PREFIXES = new String[] {
        ".bundled-staging-",
        ".bundled-backup-",
        ".import-raw-",
        ".import-ready-",
        ".import-backup-"
    };

    public interface AssetSource {
        String[] list(String path) throws IOException;
        InputStream open(String path) throws IOException;
    }

    public static final class AndroidAssetSource implements AssetSource {
        private final AssetManager assetManager;

        public AndroidAssetSource(AssetManager assetManager) {
            this.assetManager = assetManager;
        }

        @Override
        public String[] list(String path) throws IOException {
            return assetManager.list(path);
        }

        @Override
        public InputStream open(String path) throws IOException {
            return assetManager.open(path);
        }
    }

    public static final class InstallSummary {
        public final List<String> extractedIds;
        public final List<String> skippedIds;
        public final boolean hasRestorableDeletedModels;

        public InstallSummary(
            List<String> extractedIds,
            List<String> skippedIds,
            boolean hasRestorableDeletedModels
        ) {
            this.extractedIds = Collections.unmodifiableList(extractedIds);
            this.skippedIds = Collections.unmodifiableList(skippedIds);
            this.hasRestorableDeletedModels = hasRestorableDeletedModels;
        }
    }

    private PiperBundledModelsInstaller() {}

    public static InstallSummary ensureBundledModelsInstalled(
        AssetSource assets,
        File modelsRootDir
    ) throws IOException {
        return ensureBundledModelsInstalled(assets, modelsRootDir, null);
    }

    public static InstallSummary ensureBundledModelsInstalled(
        AssetSource assets,
        File modelsRootDir,
        Consumer<String> beforeReplaceCallback
    ) throws IOException {
        return syncBundledModels(assets, modelsRootDir, false, beforeReplaceCallback);
    }

    public static InstallSummary restoreBundledModels(
        AssetSource assets,
        File modelsRootDir
    ) throws IOException {
        return restoreBundledModels(assets, modelsRootDir, null);
    }

    public static InstallSummary restoreBundledModels(
        AssetSource assets,
        File modelsRootDir,
        Consumer<String> beforeReplaceCallback
    ) throws IOException {
        // Tombstones are cleared individually after each model is successfully extracted,
        // preserving restorable state if I/O or disk space fails partway.
        return syncBundledModels(assets, modelsRootDir, true, beforeReplaceCallback);
    }

    public static void cleanupStaleStagingDirs(File modelsRootDir) {
        if (modelsRootDir == null || !modelsRootDir.isDirectory()) {
            return;
        }
        File[] children = modelsRootDir.listFiles();
        if (children == null) {
            return;
        }
        for (File child : children) {
            String name = child.getName();
            for (String prefix : STALE_STAGING_PREFIXES) {
                if (name.startsWith(prefix)) {
                    PiperModelSupport.deleteRecursively(child);
                    break;
                }
            }
        }
    }

    public static boolean isModelBundledInAssets(AssetSource assets, String modelId) {
        if (assets == null || modelId == null || modelId.trim().isEmpty()) {
            return false;
        }
        try {
            String validId = PiperModelSupport.validateModelId(modelId);
            String[] bundledIds = assets.list(BUNDLED_ASSETS_ROOT);
            if (bundledIds == null) return false;
            for (String item : bundledIds) {
                if (validId.equals(item)) {
                    return true;
                }
            }
        } catch (Exception ignored) {
            return false;
        }
        return false;
    }

    public static boolean hasRestorableDeletedBundledModels(AssetSource assets, File modelsRootDir) {
        if (assets == null || modelsRootDir == null) {
            return false;
        }
        try {
            String[] bundledIds = assets.list(BUNDLED_ASSETS_ROOT);
            if (bundledIds == null || bundledIds.length == 0) {
                return false;
            }
            File tombstonesDir = new File(modelsRootDir, TOMBSTONES_SUBDIR);
            for (String rawId : bundledIds) {
                if (rawId == null || rawId.trim().isEmpty()) continue;
                String modelId;
                try {
                    modelId = PiperModelSupport.validateModelId(rawId);
                } catch (IllegalArgumentException ignored) {
                    continue;
                }
                File targetDir = new File(modelsRootDir, modelId);
                File tombstone = new File(tombstonesDir, modelId);
                if (!targetDir.isDirectory() && tombstone.isFile()) {
                    return true;
                }
            }
        } catch (IOException ignored) {
            return false;
        }
        return false;
    }

    public static void recordBundledDeletionTombstone(File modelsRootDir, String modelId, String sha256) throws IOException {
        String validId = PiperModelSupport.validateModelId(modelId);
        File tombstonesDir = new File(modelsRootDir, TOMBSTONES_SUBDIR);
        if (!tombstonesDir.exists() && !tombstonesDir.mkdirs()) {
            throw new IOException("Cannot create Piper tombstones directory");
        }
        String markerValue = (sha256 == null || sha256.trim().isEmpty()) ? "deleted" : sha256.trim().toLowerCase(Locale.ROOT);
        PiperModelSupport.writeUtf8Atomic(new File(tombstonesDir, validId), markerValue);
    }

    public static void clearBundledDeletionTombstone(File modelsRootDir, String modelId) {
        try {
            String validId = PiperModelSupport.validateModelId(modelId);
            File tombstone = new File(new File(modelsRootDir, TOMBSTONES_SUBDIR), validId);
            if (tombstone.exists()) {
                tombstone.delete();
            }
        } catch (IllegalArgumentException ignored) {
            // Ignore invalid ID.
        }
    }

    private static InstallSummary syncBundledModels(
        AssetSource assets,
        File modelsRootDir,
        boolean ignoreTombstones,
        Consumer<String> beforeReplaceCallback
    ) throws IOException {
        if (modelsRootDir != null) {
            if (!modelsRootDir.exists() && !modelsRootDir.mkdirs()) {
                throw new IOException("Cannot create Piper models directory");
            }
            cleanupStaleStagingDirs(modelsRootDir);
        }
        if (assets == null || modelsRootDir == null) {
            return new InstallSummary(Collections.emptyList(), Collections.emptyList(), false);
        }
        String[] entries = assets.list(BUNDLED_ASSETS_ROOT);
        if (entries == null || entries.length == 0) {
            return new InstallSummary(Collections.emptyList(), Collections.emptyList(), false);
        }

        List<String> extracted = new ArrayList<>();
        List<String> skipped = new ArrayList<>();
        boolean hasRestorable = false;
        File tombstonesDir = new File(modelsRootDir, TOMBSTONES_SUBDIR);

        for (String rawDirName : entries) {
            if (rawDirName == null || rawDirName.trim().isEmpty()) {
                continue;
            }
            final String modelId;
            try {
                modelId = PiperModelSupport.validateModelId(rawDirName);
            } catch (IllegalArgumentException ignored) {
                continue;
            }
            String assetModelRoot = BUNDLED_ASSETS_ROOT + "/" + modelId;
            String[] modelFiles = assets.list(assetModelRoot);
            if (modelFiles == null || modelFiles.length == 0) {
                continue;
            }

            JSONObject manifest = readOptionalAssetJson(assets, assetModelRoot + "/manifest.json");
            String onnxName = modelId + ".onnx";
            long expectedOnnxSize = -1L;
            String expectedOnnxSha = "";
            if (manifest != null) {
                JSONObject filesObj = manifest.optJSONObject("files");
                if (filesObj != null) {
                    JSONObject onnxEntry = filesObj.optJSONObject(onnxName);
                    if (onnxEntry == null) {
                        onnxEntry = filesObj.optJSONObject("onnx");
                    }
                    if (onnxEntry != null) {
                        expectedOnnxSize = onnxEntry.optLong("size_bytes", -1L);
                        expectedOnnxSha = onnxEntry.optString("sha256", "").trim().toLowerCase(Locale.ROOT);
                    }
                }
            }

            File targetDir = new File(modelsRootDir, modelId);
            File tombstone = new File(tombstonesDir, modelId);

            // Preserve user-imported override of the same modelId across APK launches/upgrades.
            if (targetDir.isDirectory() && new File(targetDir, ".imported").isFile() && !new File(targetDir, ".bundled").isFile()) {
                skipped.add(modelId);
                continue;
            }

            // Respect user deletion of bundled model unless explicitly restoring.
            if (!ignoreTombstones && !targetDir.isDirectory() && tombstone.isFile()) {
                hasRestorable = true;
                skipped.add(modelId);
                continue;
            }

            if (isBundledTargetAlreadyUpToDate(targetDir, onnxName, expectedOnnxSize, expectedOnnxSha)) {
                skipped.add(modelId);
                continue;
            }

            extractSingleBundledModel(
                assets,
                assetModelRoot,
                modelFiles,
                modelsRootDir,
                modelId,
                onnxName,
                expectedOnnxSize,
                expectedOnnxSha,
                beforeReplaceCallback
            );
            clearBundledDeletionTombstone(modelsRootDir, modelId);
            extracted.add(modelId);
        }

        if (!extracted.isEmpty()) {
            PiperModelSupport.invalidateDescriptorCache();
        }
        return new InstallSummary(extracted, skipped, hasRestorable);
    }

    private static boolean isBundledTargetAlreadyUpToDate(
        File targetDir,
        String onnxName,
        long expectedOnnxSize,
        String expectedOnnxSha
    ) {
        if (!targetDir.isDirectory()) {
            return false;
        }
        File onnxFile = new File(targetDir, onnxName);
        File jsonFile = new File(targetDir, onnxName + ".json");
        File tokensFile = new File(targetDir, "tokens.txt");
        if (!onnxFile.isFile() || onnxFile.length() <= 64 || !jsonFile.isFile() || jsonFile.length() <= 2) {
            return false;
        }

        File bundledMarker = new File(targetDir, ".bundled");
        if (!bundledMarker.isFile()) {
            return true;
        }

        if (!tokensFile.isFile() || tokensFile.length() == 0) {
            return false;
        }
        if (expectedOnnxSize > 0) {
            long actualLen = onnxFile.length();
            boolean exactMatch = (actualLen == expectedOnnxSize);
            boolean metadataAppendedMatch = false;
            if (!exactMatch && !expectedOnnxSha.isEmpty()
                && actualLen > expectedOnnxSize
                && actualLen <= expectedOnnxSize + 512) {
                try {
                    metadataAppendedMatch = PiperModelSupport.containsSherpaMetadataMarker(onnxFile);
                } catch (IOException ignored) {
                    metadataAppendedMatch = false;
                }
            }
            if (!exactMatch && !metadataAppendedMatch) {
                return false;
            }
        }
        if (!expectedOnnxSha.isEmpty()) {
            try {
                String installedSha = PiperModelSupport.readUtf8File(bundledMarker).trim().toLowerCase(Locale.ROOT);
                if (!expectedOnnxSha.equals(installedSha)) {
                    return false;
                }
            } catch (IOException ex) {
                return false;
            }
        }
        return true;
    }

    private static void extractSingleBundledModel(
        AssetSource assets,
        String assetModelRoot,
        String[] modelFiles,
        File modelsRootDir,
        String modelId,
        String onnxName,
        long expectedOnnxSize,
        String expectedOnnxSha,
        Consumer<String> beforeReplaceCallback
    ) throws IOException {
        File stagingDir = new File(modelsRootDir, ".bundled-staging-" + modelId + "-" + UUID.randomUUID());
        File backupDir = null;
        try {
            if (!stagingDir.mkdirs()) {
                throw new IOException("Cannot create staging directory for bundled Piper voice " + modelId);
            }
            boolean hasOnnx = false;
            boolean hasJson = false;
            for (String fileName : modelFiles) {
                if (fileName == null || fileName.isEmpty() || fileName.contains("/") || fileName.contains("\\") || fileName.contains("..")) {
                    continue;
                }
                File outFile = new File(stagingDir, fileName);
                boolean isOnnx = onnxName.equals(fileName);
                String actualSha = copyAssetToFile(assets, assetModelRoot + "/" + fileName, outFile, isOnnx);
                if (isOnnx) {
                    hasOnnx = true;
                    if (expectedOnnxSize > 0 && outFile.length() != expectedOnnxSize) {
                        throw new IOException(
                            "Bundled Piper ONNX size mismatch for " + modelId
                                + ": expected " + expectedOnnxSize + ", got " + outFile.length()
                        );
                    }
                    if (!expectedOnnxSha.isEmpty() && !expectedOnnxSha.equalsIgnoreCase(actualSha)) {
                        throw new IOException("Bundled Piper ONNX SHA-256 mismatch for " + modelId);
                    }
                } else if ((onnxName + ".json").equals(fileName)) {
                    hasJson = true;
                }
            }
            if (!hasOnnx || !hasJson) {
                throw new IOException("Incomplete bundled Piper voice assets for " + modelId);
            }

            String markerText = expectedOnnxSha.isEmpty() ? "bundled" : expectedOnnxSha;
            PiperModelSupport.writeUtf8Atomic(new File(stagingDir, ".bundled"), markerText);

            try {
                PiperModelSupport.loadVoiceDescriptor(stagingDir);
            } catch (JSONException ex) {
                throw new IOException("Invalid bundled Piper JSON config for " + modelId + ": " + ex.getMessage(), ex);
            }

            File targetDir = new File(modelsRootDir, modelId);
            if (targetDir.exists()) {
                if (beforeReplaceCallback != null) {
                    beforeReplaceCallback.accept(modelId);
                }
                backupDir = new File(modelsRootDir, ".bundled-backup-" + modelId + "-" + UUID.randomUUID());
                if (!targetDir.renameTo(backupDir)) {
                    PiperModelSupport.deleteRecursively(targetDir);
                    backupDir = null;
                }
            }
            if (!stagingDir.renameTo(targetDir)) {
                if (backupDir != null && backupDir.exists()) {
                    backupDir.renameTo(targetDir);
                }
                throw new IOException("Failed to finalize bundled Piper voice directory for " + modelId);
            }
            if (backupDir != null && backupDir.exists()) {
                PiperModelSupport.deleteRecursively(backupDir);
            }
        } finally {
            if (stagingDir.exists()) {
                PiperModelSupport.deleteRecursively(stagingDir);
            }
        }
    }

    private static JSONObject readOptionalAssetJson(AssetSource assets, String assetPath) {
        try (InputStream in = assets.open(assetPath)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream(4096);
            byte[] buf = new byte[4096];
            int r;
            while ((r = in.read(buf)) != -1) {
                if (out.size() + r > 1024 * 1024) {
                    return null;
                }
                out.write(buf, 0, r);
            }
            return new JSONObject(new String(out.toByteArray(), StandardCharsets.UTF_8));
        } catch (Exception ignored) {
            return null;
        }
    }

    private static String copyAssetToFile(
        AssetSource assets,
        String assetPath,
        File destFile,
        boolean computeSha256
    ) throws IOException {
        MessageDigest digest = null;
        if (computeSha256) {
            try {
                digest = MessageDigest.getInstance("SHA-256");
            } catch (NoSuchAlgorithmException ex) {
                throw new IOException("SHA-256 unavailable", ex);
            }
        }
        try (InputStream in = assets.open(assetPath);
             FileOutputStream fos = new FileOutputStream(destFile);
             BufferedOutputStream out = new BufferedOutputStream(fos, 65536)) {
            byte[] buf = new byte[65536];
            int read;
            while ((read = in.read(buf)) != -1) {
                out.write(buf, 0, read);
                if (digest != null) {
                    digest.update(buf, 0, read);
                }
            }
            out.flush();
            fos.getFD().sync();
        }
        if (digest == null) {
            return "";
        }
        byte[] hash = digest.digest();
        StringBuilder hex = new StringBuilder(hash.length * 2);
        for (byte b : hash) {
            hex.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        }
        return hex.toString();
    }
}
