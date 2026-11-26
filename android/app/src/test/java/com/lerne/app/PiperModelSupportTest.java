package com.lerne.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import com.lerne.app.piper.PiperArchiveImporter;
import com.lerne.app.piper.PiperBundledModelsInstaller;
import com.lerne.app.piper.PiperModelSupport;
import com.lerne.app.piper.PiperVoiceDescriptor;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class PiperModelSupportTest {

    @Rule
    public TemporaryFolder temp = new TemporaryFolder();

    @Test
    public void validatesSafeModelIdsAndSpeakerSelection() {
        assertEquals("de_DE-thorsten-high", PiperModelSupport.validateModelId("de_DE-thorsten-high"));
        assertEquals("de_DE-eva_k-x_low", PiperModelSupport.validateModelId("de_DE-eva_k-x_low"));
        assertThrows(IllegalArgumentException.class, () -> PiperModelSupport.validateModelId(""));
        assertThrows(IllegalArgumentException.class, () -> PiperModelSupport.validateModelId("../escape"));
        assertThrows(IllegalArgumentException.class, () -> PiperModelSupport.validateModelId(".hidden"));
        assertThrows(IllegalArgumentException.class, () -> PiperModelSupport.validateModelId("dir/model"));

        Map<String, Integer> spkMap = new HashMap<>();
        spkMap.put("neutral", 0);
        spkMap.put("amused", 1);
        spkMap.put("whisper", 7);

        PiperModelSupport.ParsedVoiceSelection s1 = PiperModelSupport.parseVoiceAndSpeaker(
            "piper:de_DE-thorsten_emotional-medium:amused",
            spkMap,
            8,
            null
        );
        assertEquals("de_DE-thorsten_emotional-medium", s1.modelId);
        assertEquals(1, s1.speakerId);

        PiperModelSupport.ParsedVoiceSelection s2 = PiperModelSupport.parseVoiceAndSpeaker(
            "piper::default",
            Collections.emptyMap(),
            1,
            null
        );
        assertEquals("", s2.modelId);
        assertEquals(0, s2.speakerId);

        assertThrows(
            IllegalArgumentException.class,
            () -> PiperModelSupport.parseVoiceAndSpeaker("de_DE-thorsten-high:amused", Collections.emptyMap(), 1, null)
        );
        assertThrows(
            IllegalArgumentException.class,
            () -> PiperModelSupport.parseVoiceAndSpeaker("de_DE-thorsten_emotional-medium:unknown", spkMap, 8, null)
        );
    }

    @Test
    public void composesGermanNfdCedillaAndMergesPiper15VowelClustersToPua() {
        Set<Integer> tokens = new HashSet<>(Arrays.asList(
            (int) 'm', (int) 'ʏ', (int) 'n', (int) 'ç', (int) 'ə', (int) ' ',
            (int) 'n', (int) 's', (int) 'h', 0xE000, 0xE001
        ));
        Map<String, Integer> puaMap = new HashMap<>();
        puaMap.put("aɪ", 0xE000);
        puaMap.put("aʊ", 0xE001);

        List<List<String>> clusters = Arrays.asList(
            Arrays.asList("a", "ɪ"),
            Arrays.asList("a", "ʊ")
        );

        int[] raw = new int[] {
            'm', 'ʏ', 'n', 'c', 0x0327, 'ə', 'n', ' ',
            'a', 'ɪ', 'n', 's', ' ',
            'h', 'a', 'ʊ', 's'
        };

        int[] processed = PiperModelSupport.postProcessSentenceCodepoints(raw, clusters, puaMap, tokens);
        int[] expected = new int[] {
            'm', 'ʏ', 'n', 'ç', 'ə', 'n', ' ',
            0xE000, 'n', 's', ' ',
            'h', 0xE001, 's'
        };
        assertArrayEquals(expected, processed);

        int[] withoutExplicitClusters = PiperModelSupport.postProcessSentenceCodepoints(
            raw,
            Collections.emptyList(),
            puaMap,
            tokens
        );
        assertArrayEquals(expected, withoutExplicitClusters);
    }

    @Test
    public void encodesValidPcm16WavHeaderWithPaddingAndClamping() throws Exception {
        float[] shortSamples = new float[] { 0.0f, 0.5f, -0.5f, 1.8f, -1.8f };
        byte[] wav = PiperModelSupport.encodeFloatSamplesToWavBytes(shortSamples, 22050, 1024 * 1024);
        assertTrue("WAV must satisfy >= 128 byte media inspector minimum", wav.length >= 128);
        assertTrue(AndroidSystemTtsPolicy.isValidWavHeader(wav));

        ByteBuffer buf = ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN);
        assertEquals(22050, buf.getInt(24));
        assertEquals(44100, buf.getInt(28));
        assertEquals((short) 16, buf.getShort(34));
        assertEquals((short) 0, buf.getShort(44));
        assertEquals((short) 16384, buf.getShort(46));
        assertEquals((short) -16383, buf.getShort(48));
        assertEquals(Short.MAX_VALUE, buf.getShort(50));
        assertEquals((short) -32767, buf.getShort(52));

        assertThrows(
            IOException.class,
            () -> PiperModelSupport.encodeFloatSamplesToWavBytes(new float[100], 22050, 100)
        );
    }

    @Test
    public void appendsSherpaMetadataPropsIdempotentlyToRawOnnx() throws Exception {
        File rawOnnx = temp.newFile("synthetic_model.onnx");
        byte[] fakeWeights = new byte[4096];
        Arrays.fill(fakeWeights, (byte) 0x08);
        Files.write(rawOnnx.toPath(), fakeWeights);

        assertFalse(PiperModelSupport.containsSherpaMetadataMarker(rawOnnx));
        boolean modifiedFirst = PiperModelSupport.ensureOnnxSherpaMetadata(rawOnnx, 22050, "de", 1, "German");
        assertTrue(modifiedFirst);
        long sizeAfterFirst = rawOnnx.length();
        assertTrue(sizeAfterFirst > 4096);
        assertTrue(PiperModelSupport.containsSherpaMetadataMarker(rawOnnx));

        boolean modifiedSecond = PiperModelSupport.ensureOnnxSherpaMetadata(rawOnnx, 22050, "de", 1, "German");
        assertFalse("Second call must be a no-op once metadata_props are present", modifiedSecond);
        assertEquals(sizeAfterFirst, rawOnnx.length());
    }

    @Test
    public void bundledModelsInstallerIsUpgradeSafeIdempotentAndHonorsTombstones() throws Exception {
        File modelsRoot = temp.newFolder("piper-models");
        AtomicInteger onnxOpenReads = new AtomicInteger(0);
        InMemoryAssetSource assets = buildBundledAssets(onnxOpenReads);

        // 1. First launch extracts both bundled models
        PiperBundledModelsInstaller.InstallSummary first =
            PiperBundledModelsInstaller.ensureBundledModelsInstalled(assets, modelsRoot);
        assertEquals(Arrays.asList("de_DE-thorsten-high", "de_DE-kerstin-medium"), first.extractedIds);
        assertEquals(2, onnxOpenReads.get());

        // 2. Second launch does ZERO re-copies when SHA-256 and size match
        PiperBundledModelsInstaller.InstallSummary second =
            PiperBundledModelsInstaller.ensureBundledModelsInstalled(assets, modelsRoot);
        assertTrue(second.extractedIds.isEmpty());
        assertEquals(2, second.skippedIds.size());
        assertEquals("No ONNX bytes should be re-read on intact upgrade/restart", 2, onnxOpenReads.get());

        // 3. User deletes Kerstin -> tombstone prevents silent re-copy on restart, restoreBundledModels brings it back
        File kerstinDir = new File(modelsRoot, "de_DE-kerstin-medium");
        String kerstinSha = PiperModelSupport.readUtf8File(new File(kerstinDir, ".bundled")).trim();
        PiperModelSupport.deleteRecursively(kerstinDir);
        PiperBundledModelsInstaller.recordBundledDeletionTombstone(modelsRoot, "de_DE-kerstin-medium", kerstinSha);

        assertTrue(PiperBundledModelsInstaller.hasRestorableDeletedBundledModels(assets, modelsRoot));
        PiperBundledModelsInstaller.InstallSummary third =
            PiperBundledModelsInstaller.ensureBundledModelsInstalled(assets, modelsRoot);
        assertTrue("Deleted bundled model must stay deleted across app restarts", third.extractedIds.isEmpty());
        assertFalse(kerstinDir.exists());

        PiperBundledModelsInstaller.InstallSummary restored =
            PiperBundledModelsInstaller.restoreBundledModels(assets, modelsRoot);
        assertEquals(Collections.singletonList("de_DE-kerstin-medium"), restored.extractedIds);
        assertTrue(kerstinDir.isDirectory());
        assertFalse(PiperBundledModelsInstaller.hasRestorableDeletedBundledModels(assets, modelsRoot));
    }

    @Test
    public void archiveImporterValidatesChecksumsRejectsBadZipsWithoutDamagingExistingModels() throws Exception {
        File modelsRoot = temp.newFolder("piper-import-models");
        AtomicInteger reads = new AtomicInteger(0);
        PiperBundledModelsInstaller.ensureBundledModelsInstalled(buildBundledAssets(reads), modelsRoot);

        // 1. Valid raw HuggingFace-style ZIP (single folder, no tokens.txt, raw ONNX without metadata_props)
        byte[] rawZip = createVoiceZip(
            "de_DE-ramona-low/",
            "de_DE-ramona-low",
            false,
            false,
            false
        );
        AtomicInteger releasedCounter = new AtomicInteger(0);
        PiperVoiceDescriptor imported = PiperArchiveImporter.importFromZipStream(
            new ByteArrayInputStream(rawZip),
            modelsRoot,
            512L * 1024L * 1024L,
            () -> false,
            id -> releasedCounter.incrementAndGet()
        );
        assertEquals("de_DE-ramona-low", imported.id);
        assertFalse(imported.bundled);
        assertTrue(imported.tokensFile.isFile() && imported.tokensFile.length() > 0);
        assertTrue(PiperModelSupport.containsSherpaMetadataMarker(imported.onnxFile));
        assertEquals(1, releasedCounter.get());

        // 2. Zip-slip path traversal is rejected and leaves all 3 installed models intact
        ByteArrayOutputStream slipOut = new ByteArrayOutputStream();
        try (ZipOutputStream zos = new ZipOutputStream(slipOut)) {
            zos.putNextEntry(new ZipEntry("../evil.onnx"));
            zos.write(new byte[128]);
            zos.closeEntry();
        }
        assertThrows(
            IOException.class,
            () -> PiperArchiveImporter.importFromZipStream(
                new ByteArrayInputStream(slipOut.toByteArray()),
                modelsRoot,
                512L * 1024L * 1024L,
                () -> false,
                null
            )
        );

        // 3. Corrupted manifest SHA-256 for an ALREADY-INSTALLED model ID fails atomically without damaging existing model!
        byte[] badShaZip = createVoiceZip("", "de_DE-ramona-low", true, true, true);
        assertThrows(
            IOException.class,
            () -> PiperArchiveImporter.importFromZipStream(
                new ByteArrayInputStream(badShaZip),
                modelsRoot,
                512L * 1024L * 1024L,
                () -> false,
                null
            )
        );
        assertEquals(3, PiperModelSupport.discoverInstalledVoices(modelsRoot).size());

        // 4. Insufficient disk space is rejected upfront
        assertThrows(
            IOException.class,
            () -> PiperArchiveImporter.importFromZipStream(
                new ByteArrayInputStream(rawZip),
                modelsRoot,
                8L * 1024L * 1024L,
                () -> false,
                null
            )
        );

        // 5. Cancellation cleans up staging directories cleanly
        AtomicBoolean cancelled = new AtomicBoolean(true);
        assertThrows(
            IOException.class,
            () -> PiperArchiveImporter.importFromZipStream(
                new ByteArrayInputStream(rawZip),
                modelsRoot,
                512L * 1024L * 1024L,
                cancelled::get,
                null
            )
        );
        for (File child : modelsRoot.listFiles()) {
            assertFalse("No leftover staging directory allowed: " + child.getName(), child.getName().startsWith(".import-"));
        }

        // 6. Zero free disk bytes (0L) is rejected (not bypassed) and stale crash staging dirs are swept
        assertThrows(
            IOException.class,
            () -> PiperArchiveImporter.importFromZipStream(
                new ByteArrayInputStream(rawZip),
                modelsRoot,
                0L,
                () -> false,
                null
            )
        );
        File crashedStaging = new File(modelsRoot, ".import-raw-crashed-123");
        assertTrue(crashedStaging.mkdirs());
        PiperBundledModelsInstaller.cleanupStaleStagingDirs(modelsRoot);
        assertFalse(crashedStaging.exists());
    }

    private static byte[] buildSyntheticOnnxWithMetadata() throws IOException {
        File tmp = File.createTempFile("piper-synth-test", ".onnx");
        try {
            byte[] base = new byte[512];
            Arrays.fill(base, (byte) 0x08);
            Files.write(tmp.toPath(), base);
            PiperModelSupport.ensureOnnxSherpaMetadata(tmp, 22050, "de", 1, "German");
            return Files.readAllBytes(tmp.toPath());
        } finally {
            tmp.delete();
        }
    }

    private static String sampleOnnxJson() {
        return "{"
            + "\"audio\":{\"sample_rate\":22050,\"quality\":\"medium\"},"
            + "\"espeak\":{\"voice\":\"de\"},"
            + "\"language\":{\"code\":\"de_DE\",\"name_english\":\"German\"},"
            + "\"num_speakers\":1,"
            + "\"phoneme_id_map\":{\"_\":[0],\"^\":[1],\"$\":[2],\" \":[3],\"a\":[4],\"b\":[5],\"d\":[6],\"e\":[7],\"s\":[8]}"
            + "}";
    }

    private static String sha256Hex(byte[] data) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] digest = md.digest(data);
        StringBuilder sb = new StringBuilder(digest.length * 2);
        for (byte b : digest) {
            sb.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        }
        return sb.toString();
    }

    private static byte[] createVoiceZip(
        String prefix,
        String modelId,
        boolean includeManifest,
        boolean preInjectMetadata,
        boolean corruptManifestSha
    ) throws Exception {
        byte[] onnxBytes;
        if (preInjectMetadata) {
            onnxBytes = buildSyntheticOnnxWithMetadata();
        } else {
            onnxBytes = new byte[512];
            Arrays.fill(onnxBytes, (byte) 0x08);
        }
        byte[] jsonBytes = sampleOnnxJson().getBytes(StandardCharsets.UTF_8);
        String onnxSha = corruptManifestSha ? "0000000000000000000000000000000000000000000000000000000000000000" : sha256Hex(onnxBytes);

        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        try (ZipOutputStream zos = new ZipOutputStream(baos)) {
            zos.putNextEntry(new ZipEntry(prefix + modelId + ".onnx"));
            zos.write(onnxBytes);
            zos.closeEntry();

            zos.putNextEntry(new ZipEntry(prefix + modelId + ".onnx.json"));
            zos.write(jsonBytes);
            zos.closeEntry();

            if (includeManifest) {
                String manifest = "{"
                    + "\"id\":\"" + modelId + "\","
                    + "\"display_name\":\"" + modelId + "\","
                    + "\"files\":{\"" + modelId + ".onnx\":{\"size_bytes\":" + onnxBytes.length + ",\"sha256\":\"" + onnxSha + "\"}}"
                    + "}";
                zos.putNextEntry(new ZipEntry(prefix + "manifest.json"));
                zos.write(manifest.getBytes(StandardCharsets.UTF_8));
                zos.closeEntry();
            }
        }
        return baos.toByteArray();
    }

    private static InMemoryAssetSource buildBundledAssets(AtomicInteger onnxOpenReads) throws Exception {
        InMemoryAssetSource src = new InMemoryAssetSource(onnxOpenReads);
        for (String id : Arrays.asList("de_DE-thorsten-high", "de_DE-kerstin-medium")) {
            byte[] onnx = buildSyntheticOnnxWithMetadata();
            String sha = sha256Hex(onnx);
            byte[] json = sampleOnnxJson().getBytes(StandardCharsets.UTF_8);
            byte[] tokens = "_ 0\n^ 1\n$ 2\n  3\na 4\nb 5\nd 6\ne 7\ns 8\n".getBytes(StandardCharsets.UTF_8);
            String manifest = "{"
                + "\"id\":\"" + id + "\","
                + "\"display_name\":\"" + id + "\","
                + "\"provenance\":{\"dataset_license\":\"CC0-1.0\",\"commercial_safe\":true},"
                + "\"files\":{\"" + id + ".onnx\":{\"size_bytes\":" + onnx.length + ",\"sha256\":\"" + sha + "\"}}"
                + "}";
            String base = PiperBundledModelsInstaller.BUNDLED_ASSETS_ROOT + "/" + id;
            src.putFile(base + "/" + id + ".onnx", onnx);
            src.putFile(base + "/" + id + ".onnx.json", json);
            src.putFile(base + "/tokens.txt", tokens);
            src.putFile(base + "/manifest.json", manifest.getBytes(StandardCharsets.UTF_8));
        }
        return src;
    }

    private static final class InMemoryAssetSource implements PiperBundledModelsInstaller.AssetSource {
        private final Map<String, byte[]> files = new LinkedHashMap<>();
        private final AtomicInteger onnxReads;

        InMemoryAssetSource(AtomicInteger onnxReads) {
            this.onnxReads = onnxReads;
        }

        void putFile(String path, byte[] data) {
            files.put(path, data);
        }

        @Override
        public String[] list(String path) {
            String prefix = path.endsWith("/") ? path : path + "/";
            Set<String> children = new LinkedHashMap<String, Boolean>().keySet();
            Map<String, Boolean> ordered = new LinkedHashMap<>();
            for (String key : files.keySet()) {
                if (key.startsWith(prefix)) {
                    String rest = key.substring(prefix.length());
                    int slash = rest.indexOf('/');
                    ordered.put(slash >= 0 ? rest.substring(0, slash) : rest, Boolean.TRUE);
                }
            }
            return ordered.keySet().toArray(new String[0]);
        }

        @Override
        public InputStream open(String path) throws IOException {
            byte[] data = files.get(path);
            if (data == null) {
                throw new FileNotFoundException(path);
            }
            if (path.endsWith(".onnx")) {
                onnxReads.incrementAndGet();
            }
            return new ByteArrayInputStream(data);
        }
    }
}
