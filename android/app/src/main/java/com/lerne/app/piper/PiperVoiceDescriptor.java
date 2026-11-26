package com.lerne.app.piper;

import java.io.File;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Immutable descriptor for a locally installed Piper ONNX voice model.
 */
public final class PiperVoiceDescriptor {
    public final String id;
    public final String displayName;
    public final String language;
    public final String espeakVoice;
    public final String gender;
    public final String quality;
    public final int sampleRate;
    public final int numSpeakers;
    public final Map<String, Integer> speakerIdMap;
    public final float noiseScale;
    public final float noiseW;
    public final float lengthScale;
    public final long sizeBytes;
    public final String license;
    public final boolean commercialSafe;
    public final boolean bundled;
    public final String sha256;
    public final File modelDir;
    public final File onnxFile;
    public final File jsonFile;
    public final File tokensFile;
    public final List<List<String>> vowelClusters;
    public final Map<String, Integer> puaMap;
    public final Set<Integer> tokenCodepoints;

    public PiperVoiceDescriptor(
        String id,
        String displayName,
        String language,
        String espeakVoice,
        String gender,
        String quality,
        int sampleRate,
        int numSpeakers,
        Map<String, Integer> speakerIdMap,
        float noiseScale,
        float noiseW,
        float lengthScale,
        long sizeBytes,
        String license,
        boolean commercialSafe,
        boolean bundled,
        String sha256,
        File modelDir,
        File onnxFile,
        File jsonFile,
        File tokensFile,
        List<List<String>> vowelClusters,
        Map<String, Integer> puaMap,
        Set<Integer> tokenCodepoints
    ) {
        this.id = id;
        this.displayName = displayName;
        this.language = language;
        this.espeakVoice = espeakVoice;
        this.gender = gender;
        this.quality = quality;
        this.sampleRate = sampleRate;
        this.numSpeakers = Math.max(1, numSpeakers);
        this.speakerIdMap = speakerIdMap != null
            ? Collections.unmodifiableMap(speakerIdMap)
            : Collections.emptyMap();
        this.noiseScale = noiseScale;
        this.noiseW = noiseW;
        this.lengthScale = lengthScale;
        this.sizeBytes = sizeBytes;
        this.license = license != null ? license : "";
        this.commercialSafe = commercialSafe;
        this.bundled = bundled;
        this.sha256 = sha256 != null ? sha256 : "";
        this.modelDir = modelDir;
        this.onnxFile = onnxFile;
        this.jsonFile = jsonFile;
        this.tokensFile = tokensFile;
        this.vowelClusters = vowelClusters != null
            ? Collections.unmodifiableList(vowelClusters)
            : Collections.emptyList();
        this.puaMap = puaMap != null
            ? Collections.unmodifiableMap(puaMap)
            : Collections.emptyMap();
        this.tokenCodepoints = tokenCodepoints != null
            ? Collections.unmodifiableSet(tokenCodepoints)
            : Collections.emptySet();
    }
}
