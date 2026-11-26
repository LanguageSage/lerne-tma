package com.lerne.app;

import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Unified Android System TextToSpeech adapter covering Google TTS, Samsung TTS,
 * and third-party compatible system TTS engines (including Piper/Sherpa-ONNX engines).
 * Synthesizes utterances to temporary WAV files and returns Base64 WAV bytes to WebView
 * so the JS SHA-256 media pipeline handles storage, deduplication, and offline playback uniformly.
 */
@CapacitorPlugin(name = "AndroidSystemTts")
public class AndroidSystemTtsPlugin extends Plugin {

    private static final int INIT_TIMEOUT_SEC = 10;
    private static final int SYNTH_TIMEOUT_SEC = 45;

    private final ExecutorService ttsExecutor = Executors.newSingleThreadExecutor();
    private final Object ttsLock = new Object();
    private TextToSpeech activeTts;
    private String activeEnginePkg = "";

    @Override
    protected void handleOnDestroy() {
        synchronized (ttsLock) {
            shutdownTtsLocked();
        }
        ttsExecutor.shutdownNow();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void listEnginesAndVoices(PluginCall call) {
        final String requestedEngine = call.getString("engine", "");
        ttsExecutor.execute(() -> {
            try {
                TextToSpeech tts = obtainReadyTts(requestedEngine);
                JSArray enginesArr = new JSArray();
                List<TextToSpeech.EngineInfo> engines = tts.getEngines();
                if (engines != null) {
                    for (TextToSpeech.EngineInfo info : engines) {
                        JSObject item = new JSObject();
                        item.put("name", info.name != null ? info.name : "");
                        item.put("label", info.label != null ? info.label : info.name);
                        enginesArr.put(item);
                    }
                }

                JSArray voicesArr = new JSArray();
                Set<Voice> voices = tts.getVoices();
                if (voices != null) {
                    List<Voice> sorted = new ArrayList<>(voices);
                    sorted.sort(Comparator.comparing(Voice::getName));
                    for (Voice v : sorted) {
                        JSObject item = new JSObject();
                        item.put("name", v.getName());
                        item.put("locale", v.getLocale() != null ? v.getLocale().toLanguageTag() : "");
                        item.put("quality", v.getQuality());
                        item.put("networkRequired", v.isNetworkConnectionRequired());
                        voicesArr.put(item);
                    }
                }

                JSObject result = new JSObject();
                result.put("engines", enginesArr);
                result.put("voices", voicesArr);
                result.put("activeEngine", activeEnginePkg != null && !activeEnginePkg.isEmpty() ? activeEnginePkg : tts.getDefaultEngine());
                call.resolve(result);
            } catch (Exception ex) {
                call.reject("Android System TTS unavailable: " + ex.getMessage());
            }
        });
    }

    @PluginMethod
    public void synthesizeToWav(PluginCall call) {
        final String text = call.getString("text", "");
        final String engine = call.getString("engine", "");
        final String voiceName = call.getString("voice", "");
        final String lang = call.getString("lang", "de");
        final float rate = AndroidSystemTtsPolicy.clampRate(call.getDouble("rate", 1.0));

        if (text == null || text.trim().isEmpty()) {
            call.reject("TTS text must not be empty");
            return;
        }

        ttsExecutor.execute(() -> {
            File tempWav = new File(getContext().getCacheDir(), "lerne_sys_tts_" + UUID.randomUUID() + ".wav");
            try {
                TextToSpeech tts = obtainReadyTts(engine);
                if (voiceName != null && !voiceName.trim().isEmpty()) {
                    Voice chosen = null;
                    Set<Voice> voices = tts.getVoices();
                    if (voices != null) {
                        for (Voice v : voices) {
                            if (voiceName.trim().equals(v.getName())) {
                                chosen = v;
                                break;
                            }
                        }
                    }
                    if (chosen != null) {
                        tts.setVoice(chosen);
                    } else {
                        tts.setLanguage(AndroidSystemTtsPolicy.parseLocale(lang));
                    }
                } else {
                    tts.setLanguage(AndroidSystemTtsPolicy.parseLocale(lang));
                }
                tts.setSpeechRate(rate);

                String utteranceId = "ut_" + UUID.randomUUID();
                CountDownLatch doneLatch = new CountDownLatch(1);
                AtomicReference<String> synthError = new AtomicReference<>(null);

                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override
                    public void onStart(String id) {}

                    @Override
                    public void onDone(String id) {
                        if (utteranceId.equals(id)) {
                            doneLatch.countDown();
                        }
                    }

                    @Override
                    @Deprecated
                    public void onError(String id) {
                        if (utteranceId.equals(id)) {
                            synthError.set("System TTS synthesis failed");
                            doneLatch.countDown();
                        }
                    }

                    @Override
                    public void onError(String id, int errorCode) {
                        if (utteranceId.equals(id)) {
                            synthError.set("System TTS error code " + errorCode);
                            doneLatch.countDown();
                        }
                    }

                    @Override
                    public void onStop(String id, boolean interrupted) {
                        if (utteranceId.equals(id)) {
                            synthError.set("System TTS synthesis stopped");
                            doneLatch.countDown();
                        }
                    }
                });

                Bundle params = new Bundle();
                int enqueueStatus = tts.synthesizeToFile(text.trim(), params, tempWav, utteranceId);
                if (enqueueStatus != TextToSpeech.SUCCESS) {
                    call.reject("Android TextToSpeech could not start synthesis");
                    return;
                }

                if (!doneLatch.await(SYNTH_TIMEOUT_SEC, TimeUnit.SECONDS)) {
                    tts.stop();
                    call.reject("Android System TTS synthesis timed out");
                    return;
                }

                if (synthError.get() != null) {
                    call.reject(synthError.get());
                    return;
                }

                byte[] wavBytes = readFileBytes(tempWav);
                if (!AndroidSystemTtsPolicy.isValidWavHeader(wavBytes)) {
                    call.reject("Android System TTS produced an invalid WAV file");
                    return;
                }

                JSObject result = new JSObject();
                result.put("audioBase64", Base64.encodeToString(wavBytes, Base64.NO_WRAP));
                result.put("mimeType", "audio/wav");
                result.put("ext", ".wav");
                call.resolve(result);
            } catch (Exception ex) {
                call.reject("Android System TTS failed: " + ex.getMessage());
            } finally {
                if (tempWav.exists()) {
                    // Best-effort cleanup of temp synthesis file.
                    tempWav.delete();
                }
            }
        });
    }

    @PluginMethod
    public void cancelSynthesis(PluginCall call) {
        synchronized (ttsLock) {
            if (activeTts != null) {
                try {
                    activeTts.stop();
                } catch (Exception ignored) {
                    // Best-effort stop.
                }
            }
        }
        call.resolve();
    }

    private TextToSpeech obtainReadyTts(String requestedEngine) throws InterruptedException {
        String cleanEngine = requestedEngine == null ? "" : requestedEngine.trim();
        synchronized (ttsLock) {
            if (activeTts != null && cleanEngine.equals(activeEnginePkg)) {
                return activeTts;
            }
            shutdownTtsLocked();

            CountDownLatch initLatch = new CountDownLatch(1);
            AtomicInteger initStatus = new AtomicInteger(TextToSpeech.ERROR);
            TextToSpeech.OnInitListener listener = status -> {
                initStatus.set(status);
                initLatch.countDown();
            };

            TextToSpeech created = cleanEngine.isEmpty()
                ? new TextToSpeech(getContext().getApplicationContext(), listener)
                : new TextToSpeech(getContext().getApplicationContext(), listener, cleanEngine);

            if (!initLatch.await(INIT_TIMEOUT_SEC, TimeUnit.SECONDS) || initStatus.get() != TextToSpeech.SUCCESS) {
                created.shutdown();
                throw new IllegalStateException("System TTS engine failed to initialize");
            }
            activeTts = created;
            activeEnginePkg = cleanEngine;
            return activeTts;
        }
    }

    private void shutdownTtsLocked() {
        if (activeTts != null) {
            try {
                activeTts.stop();
                activeTts.shutdown();
            } catch (Exception ignored) {
                // Best-effort shutdown.
            }
            activeTts = null;
            activeEnginePkg = "";
        }
    }

    private static byte[] readFileBytes(File file) throws IOException {
        if (!file.isFile() || file.length() <= 0 || file.length() > SecureNetworkVaultPolicy.MAX_RESPONSE_BYTES) {
            throw new IOException("Synthesized WAV file is missing or oversized");
        }
        byte[] data = new byte[(int) file.length()];
        try (FileInputStream in = new FileInputStream(file)) {
            int offset = 0;
            while (offset < data.length) {
                int read = in.read(data, offset, data.length - offset);
                if (read == -1) {
                    break;
                }
                offset += read;
            }
        }
        return data;
    }
}
