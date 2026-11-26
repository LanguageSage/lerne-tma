package com.lerne.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import com.lerne.app.piper.PiperModelSupport;
import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
        // Simulate espeak-ng output for "München eins Haus":
        // 'c' + U+0327 (combining cedilla) -> NFC 'ç' (U+00E7) when U+0327 is absent from token set,
        // and "aɪ" -> U+E000, "aʊ" -> U+E001.
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

        // Also merges multi-codepoint puaMap entries even when vowelClusters list is empty.
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
}
