package com.lerne.app.piper;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Pure JVM-testable helpers for Piper voice metadata, tokens.txt + PUA diphthong mapping,
 * NFC combining-mark fallback, zero-RAM ONNX ModelProto metadata_props injection, and WAV encoding.
 */
public final class PiperModelSupport {

    public static final int MAX_WAV_BYTES = 20 * 1024 * 1024;
    private static final int MIN_PCM_PAYLOAD_BYTES = 84; // 44 + 84 = 128 bytes minimum for inspectMediaBytes
    private static final Pattern SAFE_MODEL_ID = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$");

    private static final Map<String, Integer> PRIORITY_MODELS;
    static {
        Map<String, Integer> map = new HashMap<>();
        map.put("de_DE-thorsten-high", 0);
        map.put("de_DE-kerstin-medium", 1);
        map.put("de_DE-thorsten-medium", 2);
        map.put("de_DE-thorsten_emotional-medium", 3);
        map.put("de_DE-ramona-low", 4);
        map.put("de_DE-eva_k-x_low", 5);
        PRIORITY_MODELS = Collections.unmodifiableMap(map);
    }

    private static final class CachedDescriptorEntry {
        final long onnxLen;
        final long onnxMtime;
        final long jsonMtime;
        final long manifestMtime;
        final boolean bundledMarker;
        final PiperVoiceDescriptor descriptor;

        CachedDescriptorEntry(
            long onnxLen,
            long onnxMtime,
            long jsonMtime,
            long manifestMtime,
            boolean bundledMarker,
            PiperVoiceDescriptor descriptor
        ) {
            this.onnxLen = onnxLen;
            this.onnxMtime = onnxMtime;
            this.jsonMtime = jsonMtime;
            this.manifestMtime = manifestMtime;
            this.bundledMarker = bundledMarker;
            this.descriptor = descriptor;
        }
    }

    private static final Map<String, CachedDescriptorEntry> DESCRIPTOR_CACHE = new ConcurrentHashMap<>();

    public static void invalidateDescriptorCache() {
        DESCRIPTOR_CACHE.clear();
    }

    public static final class TokensMapping {
        public final Map<String, Integer> puaMap;
        public final Set<Integer> tokenCodepoints;

        public TokensMapping(Map<String, Integer> puaMap, Set<Integer> tokenCodepoints) {
            this.puaMap = puaMap;
            this.tokenCodepoints = tokenCodepoints;
        }
    }

    public static final class ParsedVoiceSelection {
        public final String modelId;
        public final int speakerId;

        public ParsedVoiceSelection(String modelId, int speakerId) {
            this.modelId = modelId;
            this.speakerId = speakerId;
        }
    }

    public static float clampRate(Double rawRate) {
        if (rawRate == null || rawRate.isNaN() || rawRate.isInfinite()) {
            return 1.0f;
        }
        return (float) Math.max(0.5d, Math.min(2.0d, rawRate));
    }

    public static String validateModelId(String rawId) {
        String clean = rawId == null ? "" : rawId.trim();
        if (clean.isEmpty() || clean.contains("..") || !SAFE_MODEL_ID.matcher(clean).matches()) {
            throw new IllegalArgumentException("Invalid Piper model identifier: " + rawId);
        }
        return clean;
    }

    public static ParsedVoiceSelection parseVoiceAndSpeaker(
        String rawVoiceSpec,
        Map<String, Integer> speakerIdMap,
        int numSpeakers,
        Integer explicitSpeakerId
    ) {
        String clean = rawVoiceSpec == null ? "" : rawVoiceSpec.trim();
        if (clean.startsWith("piper:")) {
            clean = clean.substring("piper:".length()).trim();
        }
        if (clean.startsWith(":")) {
            clean = clean.substring(1).trim();
        }
        if ("default".equalsIgnoreCase(clean)) {
            clean = "";
        }

        int totalSpeakers = Math.max(1, numSpeakers);
        Integer resolvedSpeaker = null;
        if (explicitSpeakerId != null) {
            if (explicitSpeakerId < 0 || (totalSpeakers > 1 && explicitSpeakerId >= totalSpeakers)
                || (totalSpeakers == 1 && explicitSpeakerId != 0)) {
                throw new IllegalArgumentException("Invalid speakerId " + explicitSpeakerId);
            }
            resolvedSpeaker = explicitSpeakerId;
        }

        String modelPart = clean;
        if (clean.contains(":")) {
            int idx = clean.indexOf(':');
            modelPart = clean.substring(0, idx).trim();
            String spk = clean.substring(idx + 1).trim();
            if (spk.isEmpty()) {
                throw new IllegalArgumentException("Empty speaker selector in voice spec: " + rawVoiceSpec);
            }
            if (totalSpeakers <= 1) {
                throw new IllegalArgumentException("Model " + modelPart + " does not support multiple speakers");
            }
            if (spk.chars().allMatch(Character::isDigit)) {
                int parsed = Integer.parseInt(spk);
                if (parsed < 0 || parsed >= totalSpeakers) {
                    throw new IllegalArgumentException("Speaker index out of range: " + parsed);
                }
                resolvedSpeaker = parsed;
            } else if (speakerIdMap != null && speakerIdMap.containsKey(spk)) {
                resolvedSpeaker = speakerIdMap.get(spk);
            } else {
                throw new IllegalArgumentException("Unknown speaker '" + spk + "' for model " + modelPart);
            }
        }

        return new ParsedVoiceSelection(modelPart, resolvedSpeaker != null ? resolvedSpeaker : 0);
    }

    /**
     * Build sherpa-onnx tokens.txt (if missing or empty) and return PUA diphthong map + valid codepoint set.
     */
    public static TokensMapping ensureTokensAndMapping(JSONObject onnxJson, File tokensFile) throws IOException, JSONException {
        JSONObject idMap = onnxJson.optJSONObject("phoneme_id_map");
        if (idMap == null || idMap.length() == 0) {
            throw new IOException("Invalid Piper .onnx.json: missing phoneme_id_map");
        }

        // Preserve deterministic JSON key iteration order via sorted keys only if needed;
        // org.json JSONObject keys() order can vary across JVM/Android, so sort multi-codepoint keys
        // unless tokens.txt already exists on disk!
        Map<Integer, Integer> existingIdToCodepoint = new HashMap<>();
        Set<Integer> reservedPua = new HashSet<>();
        boolean existingTokensValid = false;
        if (tokensFile != null && tokensFile.isFile() && tokensFile.length() > 0) {
            String content = readUtf8File(tokensFile);
            boolean allSingleCp = true;
            int validLineCount = 0;
            for (String line : content.split("\n")) {
                String trimmed = line.trim();
                if (trimmed.isEmpty()) continue;
                int lastSpace = line.lastIndexOf(' ');
                if (lastSpace <= 0) {
                    allSingleCp = false;
                    continue;
                }
                String sym = line.substring(0, lastSpace);
                String idStr = line.substring(lastSpace + 1).trim();
                if (sym.codePointCount(0, sym.length()) != 1) {
                    allSingleCp = false;
                    continue;
                }
                try {
                    int tokenId = Integer.parseInt(idStr);
                    int cp = sym.codePointAt(0);
                    existingIdToCodepoint.put(tokenId, cp);
                    if (cp >= 0xE000 && cp <= 0xF8FF) {
                        reservedPua.add(cp);
                    }
                    validLineCount++;
                } catch (NumberFormatException ignored) {
                    allSingleCp = false;
                }
            }
            existingTokensValid = allSingleCp && validLineCount > 0;
        }

        List<String> singleKeys = new ArrayList<>();
        List<String> multiKeys = new ArrayList<>();
        Iterator<String> keysIter = idMap.keys();
        while (keysIter.hasNext()) {
            String symbol = keysIter.next();
            if ("\n".equals(symbol) || "\r".equals(symbol) || symbol.isEmpty()) {
                continue;
            }
            if (symbol.codePointCount(0, symbol.length()) == 1) {
                singleKeys.add(symbol);
            } else {
                multiKeys.add(symbol);
            }
        }
        Collections.sort(singleKeys, Comparator.comparingInt(s -> extractTokenId(idMap, s)));
        Collections.sort(multiKeys, Comparator.comparingInt(s -> extractTokenId(idMap, s)));

        int expectedCount = singleKeys.size() + multiKeys.size();
        if (existingIdToCodepoint.size() != expectedCount) {
            existingTokensValid = false;
        }

        Map<String, Integer> puaMap = new LinkedHashMap<>();
        Set<Integer> tokenCodepoints = new HashSet<>();
        StringBuilder lines = new StringBuilder();
        int nextPua = 0xE000;

        for (String sym : singleKeys) {
            int tokenId = extractTokenId(idMap, sym);
            int cp = sym.codePointAt(0);
            tokenCodepoints.add(cp);
            lines.append(sym).append(' ').append(tokenId).append('\n');
        }
        for (String sym : multiKeys) {
            int tokenId = extractTokenId(idMap, sym);
            Integer existingCp = existingTokensValid ? existingIdToCodepoint.get(tokenId) : null;
            int cp;
            if (existingCp != null && existingCp >= 0xE000 && existingCp <= 0xF8FF) {
                cp = existingCp;
            } else {
                while (reservedPua.contains(nextPua)) {
                    nextPua++;
                }
                cp = nextPua++;
                reservedPua.add(cp);
                existingTokensValid = false;
            }
            puaMap.put(sym, cp);
            tokenCodepoints.add(cp);
            lines.append(new String(Character.toChars(cp))).append(' ').append(tokenId).append('\n');
        }

        if (tokensFile != null && !existingTokensValid) {
            writeUtf8Atomic(tokensFile, lines.toString());
        }
        return new TokensMapping(puaMap, tokenCodepoints);
    }

    private static int extractTokenId(JSONObject idMap, String key) {
        Object val = idMap.opt(key);
        if (val instanceof JSONArray) {
            return ((JSONArray) val).optInt(0, 0);
        }
        if (val instanceof Number) {
            return ((Number) val).intValue();
        }
        return idMap.optInt(key, 0);
    }

    /**
     * Post-process raw espeak-ng phoneme codepoints for a sentence:
     * 1. Compose NFD base + combining mark via NFC when combining mark is absent from model tokens
     *    (fixes e.g. 'c' + U+0327 -> 'ç' U+00E7 in German "ich", "München" on 130-symbol models).
     * 2. Merge multi-codepoint Piper 1.5 vowel_clusters (e.g. ["a","ɪ"]) to deterministic PUA codepoints.
     */
    public static int[] postProcessSentenceCodepoints(
        int[] rawCodepoints,
        List<List<String>> vowelClusters,
        Map<String, Integer> puaMap,
        Set<Integer> tokenCodepoints
    ) {
        if (rawCodepoints == null || rawCodepoints.length == 0) {
            return new int[0];
        }

        // Step 1: NFC fallback for combining marks missing from tokenCodepoints
        List<Integer> normalized = new ArrayList<>(rawCodepoints.length);
        for (int cp : rawCodepoints) {
            if (cp == 0 || cp == '\n' || cp == '\r') {
                continue;
            }
            int type = Character.getType(cp);
            boolean isCombining = (type == Character.NON_SPACING_MARK || type == Character.COMBINING_SPACING_MARK);
            if (isCombining && tokenCodepoints != null && !tokenCodepoints.isEmpty()
                && !tokenCodepoints.contains(cp) && !normalized.isEmpty()) {
                int prev = normalized.get(normalized.size() - 1);
                String pair = new String(new int[] { prev, cp }, 0, 2);
                String nfc = Normalizer.normalize(pair, Normalizer.Form.NFC);
                if (nfc.codePointCount(0, nfc.length()) == 1) {
                    int composed = nfc.codePointAt(0);
                    if (tokenCodepoints.contains(composed)) {
                        normalized.set(normalized.size() - 1, composed);
                        continue;
                    }
                }
            }
            normalized.add(cp);
        }

        if (puaMap == null || puaMap.isEmpty()) {
            int[] out = new int[normalized.size()];
            for (int i = 0; i < normalized.size(); i++) {
                out[i] = normalized.get(i);
            }
            return out;
        }

        // Step 2: Greedy longest-match merge of vowel_clusters + multi-codepoint puaMap keys -> PUA codepoint
        Set<String> clusterKeys = new HashSet<>();
        int maxClusterLen = 0;
        if (vowelClusters != null) {
            for (List<String> cluster : vowelClusters) {
                if (cluster == null || cluster.size() < 2) continue;
                StringBuilder sb = new StringBuilder();
                for (String item : cluster) {
                    sb.append(item);
                }
                String joined = sb.toString();
                if (puaMap.containsKey(joined)) {
                    int cpLen = joined.codePointCount(0, joined.length());
                    clusterKeys.add(joined);
                    if (cpLen > maxClusterLen) {
                        maxClusterLen = cpLen;
                    }
                }
            }
        }
        for (String puaKey : puaMap.keySet()) {
            int cpLen = puaKey.codePointCount(0, puaKey.length());
            if (cpLen >= 2) {
                clusterKeys.add(puaKey);
                if (cpLen > maxClusterLen) {
                    maxClusterLen = cpLen;
                }
            }
        }

        if (clusterKeys.isEmpty() || maxClusterLen < 2) {
            int[] out = new int[normalized.size()];
            for (int i = 0; i < normalized.size(); i++) {
                out[i] = normalized.get(i);
            }
            return out;
        }

        List<Integer> merged = new ArrayList<>(normalized.size());
        int n = normalized.size();
        int i = 0;
        while (i < n) {
            int matchedLen = 0;
            int matchedPua = 0;
            int maxTry = Math.min(maxClusterLen, n - i);
            for (int len = maxTry; len >= 2; len--) {
                StringBuilder cand = new StringBuilder();
                for (int k = 0; k < len; k++) {
                    cand.appendCodePoint(normalized.get(i + k));
                }
                String key = cand.toString();
                if (clusterKeys.contains(key)) {
                    Integer pua = puaMap.get(key);
                    if (pua != null) {
                        matchedLen = len;
                        matchedPua = pua;
                        break;
                    }
                }
            }
            if (matchedLen >= 2) {
                merged.add(matchedPua);
                i += matchedLen;
            } else {
                merged.add(normalized.get(i));
                i += 1;
            }
        }

        int[] result = new int[merged.size()];
        for (int idx = 0; idx < merged.size(); idx++) {
            result[idx] = merged.get(idx);
        }
        return result;
    }

    /**
     * Ensure raw imported HuggingFace Piper ONNX files carry sherpa-onnx VITS metadata_props (ModelProto field 14).
     * Appends ~200 bytes of valid Protobuf repeated StringStringEntryProto fields only when missing.
     */
    public static boolean ensureOnnxSherpaMetadata(File onnxFile, JSONObject onnxJson) throws IOException {
        JSONObject audioObj = onnxJson != null ? onnxJson.optJSONObject("audio") : null;
        int sampleRate = audioObj != null ? audioObj.optInt("sample_rate", 22050) : 22050;
        JSONObject espeakObj = onnxJson != null ? onnxJson.optJSONObject("espeak") : null;
        String espeakVoice = espeakObj != null ? espeakObj.optString("voice", "de") : "de";
        int numSpeakers = onnxJson != null ? Math.max(1, onnxJson.optInt("num_speakers", 1)) : 1;
        JSONObject langObj = onnxJson != null ? onnxJson.optJSONObject("language") : null;
        String langName = langObj != null ? langObj.optString("name_english", "German") : "German";
        return ensureOnnxSherpaMetadata(onnxFile, sampleRate, espeakVoice, numSpeakers, langName);
    }

    public static boolean ensureOnnxSherpaMetadata(
        File onnxFile,
        int rawSampleRate,
        String espeakVoice,
        int numSpeakers,
        String langName
    ) throws IOException {
        if (onnxFile == null || !onnxFile.isFile() || onnxFile.length() < 64) {
            throw new IOException("Missing or invalid Piper ONNX file");
        }
        if (containsSherpaMetadataMarker(onnxFile)) {
            return false;
        }

        int sampleRate = rawSampleRate == 22500 ? 22050 : (rawSampleRate > 0 ? rawSampleRate : 22050);
        String cleanVoice = (espeakVoice == null || espeakVoice.trim().isEmpty()) ? "de" : espeakVoice.trim();
        String cleanLang = (langName == null || langName.trim().isEmpty()) ? "German" : langName.trim();

        Map<String, String> props = new LinkedHashMap<>();
        props.put("model_type", "vits");
        props.put("comment", "piper");
        props.put("language", cleanLang);
        props.put("voice", cleanVoice);
        props.put("version", "1");
        props.put("has_espeak", "1");
        props.put("has_g2pw", "0");
        props.put("n_speakers", String.valueOf(Math.max(1, numSpeakers)));
        props.put("sample_rate", String.valueOf(sampleRate));

        ByteArrayOutputStream tail = new ByteArrayOutputStream(256);
        for (Map.Entry<String, String> entry : props.entrySet()) {
            writeModelMetadataProp(tail, entry.getKey(), entry.getValue());
        }

        try (FileOutputStream fos = new FileOutputStream(onnxFile, true)) {
            fos.write(tail.toByteArray());
            fos.flush();
            fos.getFD().sync();
        }
        return true;
    }

    public static boolean containsSherpaMetadataMarker(File onnxFile) throws IOException {
        byte[] needle1 = "model_type".getBytes(StandardCharsets.US_ASCII);
        byte[] needle2 = "has_espeak".getBytes(StandardCharsets.US_ASCII);
        long len = onnxFile.length();
        if (len <= 0) {
            return false;
        }

        // Fast path: ONNX ModelProto field 14 (metadata_props) sits in the tail (or head) of the file.
        int probeSize = (int) Math.min(len, 65536L);
        byte[] probe = new byte[probeSize];
        try (RandomAccessFile raf = new RandomAccessFile(onnxFile, "r")) {
            raf.seek(len - probeSize);
            raf.readFully(probe, 0, probeSize);
            if (indexOfBytes(probe, probeSize, needle1) >= 0 && indexOfBytes(probe, probeSize, needle2) >= 0) {
                return true;
            }
            if (len > probeSize) {
                raf.seek(0L);
                raf.readFully(probe, 0, probeSize);
                if (indexOfBytes(probe, probeSize, needle1) >= 0 && indexOfBytes(probe, probeSize, needle2) >= 0) {
                    return true;
                }
            }
        }
        if (len <= 131072L) {
            return false;
        }

        boolean found1 = false;
        boolean found2 = false;
        byte[] buf = new byte[65536];
        byte[] overlap = new byte[32];
        int overlapLen = 0;

        try (InputStreamHolder in = new InputStreamHolder(onnxFile)) {
            int read;
            while ((read = in.stream.read(buf, overlapLen, buf.length - overlapLen)) != -1) {
                int total = overlapLen + read;
                if (!found1 && indexOfBytes(buf, total, needle1) >= 0) {
                    found1 = true;
                }
                if (!found2 && indexOfBytes(buf, total, needle2) >= 0) {
                    found2 = true;
                }
                if (found1 && found2) {
                    return true;
                }
                overlapLen = Math.min(overlap.length, total);
                System.arraycopy(buf, total - overlapLen, overlap, 0, overlapLen);
                System.arraycopy(overlap, 0, buf, 0, overlapLen);
            }
        }
        return false;
    }

    private static int indexOfBytes(byte[] haystack, int haystackLen, byte[] needle) {
        int limit = haystackLen - needle.length;
        outer:
        for (int i = 0; i <= limit; i++) {
            for (int j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    continue outer;
                }
            }
            return i;
        }
        return -1;
    }

    private static void writeModelMetadataProp(ByteArrayOutputStream out, String key, String value) throws IOException {
        byte[] keyBytes = key.getBytes(StandardCharsets.UTF_8);
        byte[] valBytes = value.getBytes(StandardCharsets.UTF_8);
        ByteArrayOutputStream entry = new ByteArrayOutputStream(keyBytes.length + valBytes.length + 8);
        entry.write(0x0A); // StringStringEntryProto.key = 1 (LEN)
        writeVarint(entry, keyBytes.length);
        entry.write(keyBytes);
        entry.write(0x12); // StringStringEntryProto.value = 2 (LEN)
        writeVarint(entry, valBytes.length);
        entry.write(valBytes);
        byte[] body = entry.toByteArray();
        out.write(0x72); // ModelProto.metadata_props = 14 (LEN -> (14 << 3) | 2 = 114 = 0x72)
        writeVarint(out, body.length);
        out.write(body);
    }

    private static void writeVarint(ByteArrayOutputStream out, int value) {
        int v = value;
        while ((v & ~0x7F) != 0) {
            out.write((v & 0x7F) | 0x80);
            v >>>= 7;
        }
        out.write(v);
    }

    public static byte[] encodeFloatSamplesToWavBytes(float[] samples, int sampleRate, int maxBytes) throws IOException {
        if (samples == null || samples.length == 0) {
            throw new IOException("Piper engine produced empty audio samples");
        }
        if (sampleRate < 8000 || sampleRate > 96000) {
            throw new IOException("Invalid Piper sample rate: " + sampleRate);
        }
        long rawPcmBytes = (long) samples.length * 2L;
        long paddedPcmBytes = Math.max(rawPcmBytes, (long) MIN_PCM_PAYLOAD_BYTES);
        long totalWavBytes = 44L + paddedPcmBytes;
        if (totalWavBytes > maxBytes || totalWavBytes > Integer.MAX_VALUE) {
            throw new IOException("Synthesized WAV exceeds size limit (" + totalWavBytes + " bytes)");
        }

        int pcmLen = (int) paddedPcmBytes;
        ByteBuffer buf = ByteBuffer.allocate(44 + pcmLen).order(ByteOrder.LITTLE_ENDIAN);
        buf.put((byte) 'R').put((byte) 'I').put((byte) 'F').put((byte) 'F');
        buf.putInt(36 + pcmLen);
        buf.put((byte) 'W').put((byte) 'A').put((byte) 'V').put((byte) 'E');
        buf.put((byte) 'f').put((byte) 'm').put((byte) 't').put((byte) ' ');
        buf.putInt(16); // PCM chunk size
        buf.putShort((short) 1); // AudioFormat = 1 (PCM)
        buf.putShort((short) 1); // Mono
        buf.putInt(sampleRate);
        buf.putInt(sampleRate * 2); // ByteRate
        buf.putShort((short) 2); // BlockAlign
        buf.putShort((short) 16); // BitsPerSample
        buf.put((byte) 'd').put((byte) 'a').put((byte) 't').put((byte) 'a');
        buf.putInt(pcmLen);

        for (float sample : samples) {
            float clamped = Math.max(-1.0f, Math.min(1.0f, sample));
            short pcm16 = (short) Math.round(clamped * 32767.0f);
            buf.putShort(pcm16);
        }
        while (buf.hasRemaining()) {
            buf.put((byte) 0);
        }
        return buf.array();
    }

    public static PiperVoiceDescriptor loadVoiceDescriptor(File modelDir) throws IOException, JSONException {
        if (modelDir == null || !modelDir.isDirectory()) {
            throw new IOException("Voice model directory does not exist");
        }
        File[] files = modelDir.listFiles();
        if (files == null) {
            throw new IOException("Unable to read voice model directory");
        }
        File onnxFile = null;
        Arrays.sort(files, Comparator.comparing(File::getName));
        for (File f : files) {
            if (f.isFile() && f.getName().endsWith(".onnx") && !f.getName().endsWith(".tmp")) {
                onnxFile = f;
                break;
            }
        }
        if (onnxFile == null) {
            throw new IOException("No .onnx model file found in " + modelDir.getName());
        }
        String stem = onnxFile.getName().substring(0, onnxFile.getName().length() - ".onnx".length());
        String modelId = validateModelId(stem);
        File jsonFile = new File(modelDir, onnxFile.getName() + ".json");
        if (!jsonFile.isFile()) {
            throw new IOException("Companion .onnx.json config missing for " + modelId);
        }

        File manifestFile = new File(modelDir, "manifest.json");
        boolean bundledMarker = new File(modelDir, ".bundled").isFile();
        String cacheKey = modelDir.getAbsolutePath();
        long onnxLen = onnxFile.length();
        long onnxMtime = onnxFile.lastModified();
        long jsonMtime = jsonFile.lastModified();
        long manifestMtime = manifestFile.isFile() ? manifestFile.lastModified() : -1L;

        File tokensFile = new File(modelDir, "tokens.txt");
        CachedDescriptorEntry cached = DESCRIPTOR_CACHE.get(cacheKey);
        if (cached != null
            && cached.onnxLen == onnxLen
            && cached.onnxMtime == onnxMtime
            && cached.jsonMtime == jsonMtime
            && cached.manifestMtime == manifestMtime
            && cached.bundledMarker == bundledMarker
            && tokensFile.isFile()) {
            return cached.descriptor;
        }

        String rawOnnxJson = readUtf8File(jsonFile);
        JSONObject onnxJson = new JSONObject(rawOnnxJson);
        TokensMapping mapping = ensureTokensAndMapping(onnxJson, tokensFile);
        ensureOnnxSherpaMetadata(onnxFile, onnxJson);

        JSONObject manifest = null;
        if (manifestFile.isFile()) {
            try {
                manifest = new JSONObject(readUtf8File(manifestFile));
            } catch (Exception ignored) {
                manifest = null;
            }
        }

        JSONObject langObj = onnxJson.optJSONObject("language");
        String langCode = langObj != null ? langObj.optString("code", "").trim() : "";
        if (langCode.isEmpty() && manifest != null) {
            langCode = manifest.optString("language", "de_DE").trim();
        }
        if (langCode.isEmpty()) {
            langCode = modelId.contains("-") ? modelId.substring(0, modelId.indexOf('-')) : "de_DE";
        }

        JSONObject espeakObj = onnxJson.optJSONObject("espeak");
        String espeakVoice = espeakObj != null ? espeakObj.optString("voice", "").trim() : "";
        if (espeakVoice.isEmpty()) {
            espeakVoice = langCode.replace('_', '-').toLowerCase(Locale.ROOT).split("-")[0];
            if (espeakVoice.isEmpty()) espeakVoice = "de";
        }

        JSONObject audioObj = onnxJson.optJSONObject("audio");
        int sampleRate = audioObj != null ? audioObj.optInt("sample_rate", 22050) : 22050;
        if (sampleRate == 22500) sampleRate = 22050;
        String quality = audioObj != null ? audioObj.optString("quality", "").trim() : "";

        JSONObject infObj = onnxJson.optJSONObject("inference");
        float noiseScale = infObj != null ? (float) infObj.optDouble("noise_scale", 0.667d) : 0.667f;
        float noiseW = infObj != null ? (float) infObj.optDouble("noise_w", 0.8d) : 0.8f;
        float lengthScale = infObj != null ? (float) infObj.optDouble("length_scale", 1.0d) : 1.0f;

        int numSpeakers = Math.max(1, onnxJson.optInt("num_speakers", 1));
        Map<String, Integer> speakerMap = new LinkedHashMap<>();
        JSONObject spkJson = onnxJson.optJSONObject("speaker_id_map");
        if (spkJson != null) {
            Iterator<String> spkKeys = spkJson.keys();
            while (spkKeys.hasNext()) {
                String k = spkKeys.next();
                speakerMap.put(k, spkJson.optInt(k, 0));
            }
        }

        List<List<String>> clusters = new ArrayList<>();
        JSONArray clusterArr = onnxJson.optJSONArray("vowel_clusters");
        if (clusterArr != null) {
            for (int i = 0; i < clusterArr.length(); i++) {
                JSONArray inner = clusterArr.optJSONArray(i);
                if (inner == null || inner.length() < 2) continue;
                List<String> seq = new ArrayList<>(inner.length());
                for (int j = 0; j < inner.length(); j++) {
                    seq.add(inner.optString(j, ""));
                }
                clusters.add(Collections.unmodifiableList(seq));
            }
        }

        String displayName = manifest != null ? manifest.optString("display_name", "").trim() : "";
        if (displayName.isEmpty()) {
            displayName = modelId;
        }
        String gender = manifest != null ? manifest.optString("gender", "").trim() : "";
        boolean bundled = bundledMarker
            || (manifest != null && manifest.optBoolean("bundled_installed", false));

        String sha256 = "";
        if (manifest != null) {
            JSONObject filesObj = manifest.optJSONObject("files");
            if (filesObj != null) {
                JSONObject onnxEntry = filesObj.optJSONObject(onnxFile.getName());
                if (onnxEntry == null) {
                    onnxEntry = filesObj.optJSONObject("onnx");
                }
                if (onnxEntry != null) {
                    sha256 = onnxEntry.optString("sha256", "").trim();
                }
            }
        }

        String[] licenseInfo = inspectLicense(modelDir, rawOnnxJson, manifest);

        PiperVoiceDescriptor descriptor = new PiperVoiceDescriptor(
            modelId,
            displayName,
            langCode,
            espeakVoice,
            gender,
            quality,
            sampleRate,
            numSpeakers,
            speakerMap,
            noiseScale,
            noiseW,
            lengthScale,
            onnxFile.length(),
            licenseInfo[0],
            "true".equals(licenseInfo[1]),
            bundled,
            sha256,
            modelDir,
            onnxFile,
            jsonFile,
            tokensFile,
            clusters,
            mapping.puaMap,
            mapping.tokenCodepoints
        );
        DESCRIPTOR_CACHE.put(
            cacheKey,
            new CachedDescriptorEntry(
                onnxFile.length(),
                onnxFile.lastModified(),
                jsonFile.lastModified(),
                manifestMtime,
                bundledMarker,
                descriptor
            )
        );
        return descriptor;
    }

    public static List<PiperVoiceDescriptor> discoverInstalledVoices(File modelsRootDir) {
        if (modelsRootDir == null || !modelsRootDir.isDirectory()) {
            return Collections.emptyList();
        }
        File[] subdirs = modelsRootDir.listFiles();
        if (subdirs == null) {
            return Collections.emptyList();
        }
        List<PiperVoiceDescriptor> found = new ArrayList<>();
        for (File dir : subdirs) {
            if (!dir.isDirectory() || dir.getName().startsWith(".")) {
                continue;
            }
            try {
                found.add(loadVoiceDescriptor(dir));
            } catch (Exception ignored) {
                // Skip incomplete or corrupt directory without crashing catalog listing.
            }
        }
        found.sort((a, b) -> {
            if (a.commercialSafe != b.commercialSafe) {
                return a.commercialSafe ? -1 : 1;
            }
            int pa = PRIORITY_MODELS.getOrDefault(a.id, 100);
            int pb = PRIORITY_MODELS.getOrDefault(b.id, 100);
            if (pa != pb) {
                return Integer.compare(pa, pb);
            }
            return a.id.compareTo(b.id);
        });
        return found;
    }

    private static String[] inspectLicense(File modelDir, String rawOnnxJson, JSONObject manifest) {
        String label = "Неизвестно";
        boolean commercialSafe = true;

        StringBuilder joined = new StringBuilder();
        for (File f : new File[] {
            new File(modelDir, "MODEL_CARD"),
            new File(modelDir, "LICENSE")
        }) {
            if (f.isFile() && f.length() <= 65536) {
                try {
                    joined.append(readUtf8File(f)).append('\n');
                } catch (IOException ignored) {
                    // Best-effort metadata read.
                }
            }
        }
        if (rawOnnxJson != null) {
            joined.append(rawOnnxJson).append('\n');
        }
        String lower = joined.toString().toLowerCase(Locale.ROOT);
        if (lower.contains("cc-by-nc") || lower.contains("noncommercial") || lower.contains("non-commercial")) {
            label = "CC-BY-NC";
            commercialSafe = false;
        } else if (lower.contains("cc0") || lower.contains("public domain") || lower.contains("mit license")) {
            label = "CC0 / MIT";
        } else if (lower.contains("apache-2.0") || lower.contains("apache 2.0")) {
            label = "Apache-2.0";
        } else if (lower.contains("cc-by") || lower.contains("creative commons attribution")) {
            label = "CC-BY";
        }

        if (manifest != null) {
            JSONObject prov = manifest.optJSONObject("provenance");
            if (prov != null) {
                String dsLic = prov.optString("dataset_license", "").trim();
                if (!dsLic.isEmpty() && "Неизвестно".equals(label)) {
                    label = dsLic;
                }
                if (prov.has("commercial_safe") && !prov.optBoolean("commercial_safe", true)) {
                    commercialSafe = false;
                    if (!dsLic.isEmpty()) {
                        label = dsLic;
                    }
                }
            }
        }
        return new String[] { label, String.valueOf(commercialSafe) };
    }

    public static String readUtf8File(File file) throws IOException {
        if (file == null || !file.isFile() || file.length() > 16 * 1024 * 1024) {
            throw new IOException("Cannot read text file: " + (file != null ? file.getName() : "null"));
        }
        byte[] bytes = new byte[(int) file.length()];
        try (FileInputStream in = new FileInputStream(file)) {
            int offset = 0;
            while (offset < bytes.length) {
                int r = in.read(bytes, offset, bytes.length - offset);
                if (r == -1) break;
                offset += r;
            }
        }
        return new String(bytes, StandardCharsets.UTF_8);
    }

    public static void writeUtf8Atomic(File target, String content) throws IOException {
        File parent = target.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IOException("Cannot create parent directory for " + target.getName());
        }
        File tmp = new File(parent, "." + target.getName() + "." + UUID.randomUUID() + ".tmp");
        try {
            try (FileOutputStream fos = new FileOutputStream(tmp);
                 BufferedOutputStream out = new BufferedOutputStream(fos)) {
                out.write(content.getBytes(StandardCharsets.UTF_8));
                out.flush();
                fos.getFD().sync();
            }
            if (!tmp.renameTo(target)) {
                if (target.exists() && !target.delete()) {
                    throw new IOException("Cannot replace " + target.getName());
                }
                if (!tmp.renameTo(target)) {
                    throw new IOException("Cannot finalize " + target.getName());
                }
            }
        } finally {
            if (tmp.exists()) {
                tmp.delete();
            }
        }
    }

    public static void deleteRecursively(File path) {
        if (path == null || !path.exists()) {
            return;
        }
        if (path.isDirectory()) {
            File[] children = path.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursively(child);
                }
            }
        }
        path.delete();
    }

    private static final class InputStreamHolder implements AutoCloseable {
        final BufferedInputStream stream;

        InputStreamHolder(File file) throws IOException {
            this.stream = new BufferedInputStream(new FileInputStream(file), 65536);
        }

        @Override
        public void close() throws IOException {
            stream.close();
        }
    }
}
