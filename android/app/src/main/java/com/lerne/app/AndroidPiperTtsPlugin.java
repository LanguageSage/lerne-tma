package com.lerne.app;

import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.lerne.app.piper.EspeakPiperPhonemizer;
import com.lerne.app.piper.PiperModelSupport;
import com.lerne.app.piper.PiperPhonemizer;
import com.lerne.app.piper.PiperSynthOutput;
import com.lerne.app.piper.PiperTtsEngine;
import com.lerne.app.piper.PiperVoiceDescriptor;
import com.lerne.app.piper.SherpaOnnxPiperEngine;
import java.io.File;
import java.io.IOException;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import org.json.JSONObject;

/**
 * Native Capacitor offline neural TTS plugin backed by replaceable PiperPhonemizer + PiperTtsEngine.
 * Runs all initialization, model loading, synthesis, and teardown release off the main UI thread.
 */
@CapacitorPlugin(name = "AndroidPiperTts")
public class AndroidPiperTtsPlugin extends Plugin {

    private static final String PIPER_ROOT_DIR = "lerne-piper";
    private static final String MODELS_SUBDIR = "models";

    private final ExecutorService piperExecutor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean shuttingDown = new AtomicBoolean(false);
    private final AtomicLong generationSeq = new AtomicLong(0L);
    private final AtomicLong cancelledAllThroughSeq = new AtomicLong(0L);
    private final Set<String> cancelledRequestIds = Collections.newSetFromMap(new ConcurrentHashMap<>());

    private PiperPhonemizer phonemizer;
    private PiperTtsEngine ttsEngine;

    @Override
    public void load() {
        super.load();
        phonemizer = new EspeakPiperPhonemizer(getContext());
        ttsEngine = new SherpaOnnxPiperEngine();
    }

    @Override
    protected void handleOnDestroy() {
        shuttingDown.set(true);
        cancelledAllThroughSeq.set(generationSeq.get());
        final PiperTtsEngine engineToRelease = ttsEngine;
        final PiperPhonemizer phonemizerToClose = phonemizer;
        try {
            piperExecutor.execute(() -> {
                if (engineToRelease != null) {
                    engineToRelease.release();
                }
                if (phonemizerToClose != null) {
                    phonemizerToClose.close();
                }
            });
        } catch (RejectedExecutionException ignored) {
            // Executor already stopped.
        }
        piperExecutor.shutdown();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void listVoices(PluginCall call) {
        submitBackground(call, () -> {
            try {
                File modelsDir = ensureModelsRootDir();
                List<PiperVoiceDescriptor> voices = PiperModelSupport.discoverInstalledVoices(modelsDir);
                JSArray voicesArr = new JSArray();
                for (PiperVoiceDescriptor v : voices) {
                    voicesArr.put(descriptorToJson(v));
                }
                JSObject res = new JSObject();
                res.put("available", !voices.isEmpty());
                res.put("loadedModelId", ttsEngine != null ? ttsEngine.getLoadedModelId() : "");
                res.put("modelsDir", modelsDir.getAbsolutePath());
                res.put("voices", voicesArr);
                call.resolve(res);
            } catch (Exception ex) {
                call.reject("Piper voice catalog unavailable: " + ex.getMessage(), ex);
            }
        });
    }

    @PluginMethod
    public void synthesizeToWav(PluginCall call) {
        final String text = call.getString("text", "");
        final String rawVoice = call.getString("voice", "");
        final String lang = call.getString("lang", "de");
        final String requestId = call.getString("requestId", UUID.randomUUID().toString());
        final float speed = PiperModelSupport.clampRate(call.getDouble("rate", 1.0d));
        final Integer explicitSpeaker = call.getData() != null && call.getData().has("speakerId")
            ? call.getInt("speakerId")
            : null;

        if (text == null || text.trim().isEmpty()) {
            call.reject("Текст для синтеза Piper пуст");
            return;
        }

        final long mySeq = generationSeq.incrementAndGet();
        submitBackground(call, () -> {
            try {
                if (isRequestCancelled(mySeq, requestId)) {
                    call.reject("TTS synthesis cancelled");
                    return;
                }
                File modelsDir = ensureModelsRootDir();
                List<PiperVoiceDescriptor> installed = PiperModelSupport.discoverInstalledVoices(modelsDir);
                if (installed.isEmpty()) {
                    call.reject("Локальные голосовые модели Piper не установлены на устройстве.");
                    return;
                }

                PiperVoiceDescriptor chosen = selectVoice(installed, rawVoice, lang);
                PiperModelSupport.ParsedVoiceSelection parsed = PiperModelSupport.parseVoiceAndSpeaker(
                    rawVoice,
                    chosen.speakerIdMap,
                    chosen.numSpeakers,
                    explicitSpeaker
                );

                int[][] phonemeSentences = phonemizer.phonemize(text.trim(), chosen);
                PiperSynthOutput synth = ttsEngine.synthesize(
                    chosen,
                    phonemeSentences,
                    parsed.speakerId,
                    speed,
                    () -> isRequestCancelled(mySeq, requestId)
                );

                if (!AndroidSystemTtsPolicy.isValidWavHeader(synth.wavBytes)) {
                    call.reject("Piper синтезировал некорректный WAV-контейнер");
                    return;
                }

                JSObject res = new JSObject();
                res.put("audioBase64", Base64.encodeToString(synth.wavBytes, Base64.NO_WRAP));
                res.put("mimeType", "audio/wav");
                res.put("ext", ".wav");
                res.put("sampleRate", synth.sampleRate);
                res.put("durationMs", synth.durationMs);
                res.put("modelId", chosen.id);
                call.resolve(res);
            } catch (Exception ex) {
                call.reject("Piper TTS error: " + ex.getMessage(), ex);
            } finally {
                if (requestId != null) {
                    cancelledRequestIds.remove(requestId);
                }
            }
        });
    }

    @PluginMethod
    public void cancelSynthesis(PluginCall call) {
        String requestId = call.getString("requestId", "");
        if (requestId != null && !requestId.trim().isEmpty()) {
            if (cancelledRequestIds.size() > 256) {
                cancelledRequestIds.clear();
            }
            cancelledRequestIds.add(requestId.trim());
        } else {
            cancelledAllThroughSeq.set(generationSeq.get());
        }
        call.resolve();
    }

    @PluginMethod
    public void releaseEngine(PluginCall call) {
        final String modelId = call.getString("modelId", "");
        if (modelId == null || modelId.trim().isEmpty()) {
            cancelledAllThroughSeq.set(generationSeq.get());
        }
        submitBackground(call, () -> {
            if (ttsEngine != null) {
                if (modelId != null && !modelId.trim().isEmpty()) {
                    ttsEngine.releaseModelIfLoaded(modelId.trim());
                } else {
                    ttsEngine.release();
                }
            }
            call.resolve();
        });
    }

    private boolean isRequestCancelled(long seq, String requestId) {
        return shuttingDown.get()
            || cancelledAllThroughSeq.get() >= seq
            || (requestId != null && cancelledRequestIds.contains(requestId))
            || Thread.currentThread().isInterrupted();
    }

    private void submitBackground(PluginCall call, Runnable task) {
        if (shuttingDown.get()) {
            call.reject("Piper TTS plugin is shutting down");
            return;
        }
        try {
            piperExecutor.execute(task);
        } catch (RejectedExecutionException ex) {
            call.reject("Piper TTS plugin is shutting down", ex);
        }
    }

    private File ensureModelsRootDir() throws IOException {
        File root = new File(new File(getContext().getFilesDir(), PIPER_ROOT_DIR), MODELS_SUBDIR);
        if (!root.exists() && !root.mkdirs()) {
            throw new IOException("Cannot create Piper models directory");
        }
        return root;
    }

    static PiperVoiceDescriptor selectVoice(
        List<PiperVoiceDescriptor> installed,
        String rawVoice,
        String lang
    ) {
        String clean = rawVoice == null ? "" : rawVoice.trim();
        if (clean.startsWith("piper:")) {
            clean = clean.substring("piper:".length()).trim();
        }
        if (clean.startsWith(":")) {
            clean = clean.substring(1).trim();
        }
        String modelIdPart = clean.contains(":") ? clean.substring(0, clean.indexOf(':')).trim() : clean;
        if (!modelIdPart.isEmpty() && !"default".equalsIgnoreCase(modelIdPart)) {
            for (PiperVoiceDescriptor v : installed) {
                if (modelIdPart.equals(v.id)) {
                    return v;
                }
            }
            throw new IllegalArgumentException("Голосовая модель Piper не найдена: " + modelIdPart);
        }

        String langPrefix = (lang == null ? "de" : lang.trim().toLowerCase(Locale.ROOT).replace('-', '_').split("_")[0]);
        if (langPrefix.isEmpty()) {
            langPrefix = "de";
        }
        if ("no".equals(langPrefix)) {
            langPrefix = "nb";
        }
        for (PiperVoiceDescriptor v : installed) {
            if (v.commercialSafe && v.language.toLowerCase(Locale.ROOT).startsWith(langPrefix)) {
                return v;
            }
        }
        for (PiperVoiceDescriptor v : installed) {
            if (v.language.toLowerCase(Locale.ROOT).startsWith(langPrefix)) {
                return v;
            }
        }
        throw new IllegalArgumentException(
            "Для языка '" + langPrefix + "' не установлена локальная голосовая модель Piper"
        );
    }

    private static JSObject descriptorToJson(PiperVoiceDescriptor v) {
        JSObject obj = new JSObject();
        obj.put("id", v.id);
        obj.put("displayName", v.displayName);
        obj.put("lang", v.language);
        obj.put("espeakVoice", v.espeakVoice);
        obj.put("gender", v.gender);
        obj.put("quality", v.quality);
        obj.put("sampleRate", v.sampleRate);
        obj.put("numSpeakers", v.numSpeakers);
        obj.put("sizeBytes", v.sizeBytes);
        obj.put("sizeMb", Math.round((v.sizeBytes / (1024.0d * 1024.0d)) * 10.0d) / 10.0d);
        obj.put("license", v.license);
        obj.put("commercialSafe", v.commercialSafe);
        obj.put("bundled", v.bundled);
        obj.put("sha256", v.sha256);
        JSONObject spk = new JSONObject();
        for (Map.Entry<String, Integer> entry : v.speakerIdMap.entrySet()) {
            try {
                spk.put(entry.getKey(), entry.getValue());
            } catch (Exception ignored) {
                // Ignore invalid key.
            }
        }
        obj.put("speakerIdMap", spk);
        return obj;
    }
}
