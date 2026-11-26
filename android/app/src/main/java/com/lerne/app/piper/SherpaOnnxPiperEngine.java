package com.lerne.app.piper;

import com.k2fsa.sherpa.onnx.GeneratedAudio;
import com.k2fsa.sherpa.onnx.GenerationConfig;
import com.k2fsa.sherpa.onnx.OfflineTts;
import com.k2fsa.sherpa.onnx.OfflineTtsConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig;
import java.io.IOException;
import java.util.function.BooleanSupplier;

/**
 * Single-model lazy OfflineTts engine backed by sherpa-onnx 2.0.3 (Apache-2.0).
 * Never keeps more than one ONNX voice model loaded in RAM simultaneously:
 * switching models, deleting an active model, or destroying the plugin immediately releases native memory.
 */
public final class SherpaOnnxPiperEngine implements PiperTtsEngine {

    private final Object lock = new Object();
    private OfflineTts activeTts;
    private String loadedModelId = "";
    private long loadedOnnxLength = -1L;
    private long loadedOnnxMtime = -1L;

    @Override
    public PiperSynthOutput synthesize(
        PiperVoiceDescriptor voice,
        int[][] phonemeSentences,
        int speakerId,
        float speed,
        BooleanSupplier isCancelled
    ) throws IOException {
        if (voice == null || voice.onnxFile == null || !voice.onnxFile.isFile()) {
            throw new IOException("Piper voice model file is missing");
        }
        if (phonemeSentences == null || phonemeSentences.length == 0) {
            throw new IOException("Phoneme sentence array is empty");
        }
        BooleanSupplier cancelCheck = isCancelled != null ? isCancelled : () -> false;
        if (cancelCheck.getAsBoolean()) {
            throw new IOException("TTS synthesis cancelled");
        }

        synchronized (lock) {
            OfflineTts tts = obtainLoadedModelLocked(voice);
            if (cancelCheck.getAsBoolean()) {
                throw new IOException("TTS synthesis cancelled");
            }

            GenerationConfig genCfg = new GenerationConfig();
            genCfg.setSid(Math.max(0, Math.min(voice.numSpeakers - 1, speakerId)));
            genCfg.setSpeed(PiperModelSupport.clampRate((double) speed));
            genCfg.setSilenceScale(0.2f);
            genCfg.setPhonemeCodepoints(phonemeSentences);

            GeneratedAudio audio;
            try {
                audio = tts.generateWithConfigAndCallback(
                    "",
                    genCfg,
                    chunk -> cancelCheck.getAsBoolean() ? 0 : 1
                );
            } catch (RuntimeException ex) {
                throw new IOException("Sherpa-ONNX synthesis failed: " + ex.getMessage(), ex);
            }

            if (cancelCheck.getAsBoolean()) {
                throw new IOException("TTS synthesis cancelled");
            }
            if (audio == null || audio.getSamples() == null || audio.getSamples().length == 0) {
                throw new IOException("Sherpa-ONNX returned empty audio");
            }

            int sr = audio.getSampleRate() > 0 ? audio.getSampleRate() : voice.sampleRate;
            float[] samples = audio.getSamples();
            byte[] wavBytes = PiperModelSupport.encodeFloatSamplesToWavBytes(
                samples,
                sr,
                PiperModelSupport.MAX_WAV_BYTES
            );
            int durationMs = (int) Math.round((samples.length * 1000.0d) / sr);
            return new PiperSynthOutput(wavBytes, sr, durationMs);
        }
    }

    @Override
    public String getLoadedModelId() {
        synchronized (lock) {
            return loadedModelId;
        }
    }

    @Override
    public void releaseModelIfLoaded(String modelId) {
        if (modelId == null || modelId.isEmpty()) {
            return;
        }
        synchronized (lock) {
            if (modelId.equals(loadedModelId)) {
                releaseLocked();
            }
        }
    }

    @Override
    public void release() {
        synchronized (lock) {
            releaseLocked();
        }
    }

    private OfflineTts obtainLoadedModelLocked(PiperVoiceDescriptor voice) throws IOException {
        long curLen = voice.onnxFile.length();
        long curMtime = voice.onnxFile.lastModified();
        if (activeTts != null
            && voice.id.equals(loadedModelId)
            && curLen == loadedOnnxLength
            && curMtime == loadedOnnxMtime) {
            return activeTts;
        }

        // Release previous ONNX model BEFORE allocating the new one so two models never coexist in RAM.
        releaseLocked();

        int cores = Runtime.getRuntime().availableProcessors();
        int numThreads = Math.max(1, Math.min(4, cores / 2));

        OfflineTtsVitsModelConfig vitsCfg = new OfflineTtsVitsModelConfig();
        vitsCfg.setModel(voice.onnxFile.getAbsolutePath());
        vitsCfg.setTokens(voice.tokensFile.getAbsolutePath());
        vitsCfg.setDataDir("");
        vitsCfg.setDictDir("");
        vitsCfg.setLexicon("");
        vitsCfg.setNoiseScale(voice.noiseScale);
        vitsCfg.setNoiseScaleW(voice.noiseW);
        vitsCfg.setLengthScale(voice.lengthScale);

        OfflineTtsModelConfig modelCfg = new OfflineTtsModelConfig();
        modelCfg.setVits(vitsCfg);
        modelCfg.setNumThreads(numThreads);
        modelCfg.setDebug(false);
        modelCfg.setProvider("cpu");

        OfflineTtsConfig ttsCfg = new OfflineTtsConfig();
        ttsCfg.setModel(modelCfg);
        ttsCfg.setMaxNumSentences(1);
        ttsCfg.setSilenceScale(0.2f);

        try {
            activeTts = new OfflineTts(null, ttsCfg);
            loadedModelId = voice.id;
            loadedOnnxLength = curLen;
            loadedOnnxMtime = curMtime;
            return activeTts;
        } catch (RuntimeException ex) {
            releaseLocked();
            throw new IOException("Failed to load Piper ONNX model '" + voice.id + "': " + ex.getMessage(), ex);
        }
    }

    private void releaseLocked() {
        if (activeTts != null) {
            try {
                activeTts.release();
            } catch (Exception ignored) {
                // Best-effort native pointer release.
            }
            activeTts = null;
        }
        loadedModelId = "";
        loadedOnnxLength = -1L;
        loadedOnnxMtime = -1L;
    }
}
