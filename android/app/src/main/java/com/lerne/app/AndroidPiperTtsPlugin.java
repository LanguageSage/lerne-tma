package com.lerne.app;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.StatFs;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.lerne.app.piper.EspeakPiperPhonemizer;
import com.lerne.app.piper.PiperArchiveImporter;
import com.lerne.app.piper.PiperBundledModelsInstaller;
import com.lerne.app.piper.PiperModelSupport;
import com.lerne.app.piper.PiperPhonemizer;
import com.lerne.app.piper.PiperSynthOutput;
import com.lerne.app.piper.PiperTtsEngine;
import com.lerne.app.piper.PiperVoiceDescriptor;
import com.lerne.app.piper.SherpaOnnxPiperEngine;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
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
 * Runs all initialization, bundled voice sync, SAF ZIP import/delete, model loading, synthesis,
 * and teardown release off the main UI thread.
 */
@CapacitorPlugin(name = "AndroidPiperTts")
public class AndroidPiperTtsPlugin extends Plugin {

    private static final String PIPER_ROOT_DIR = "lerne-piper";
    private static final String MODELS_SUBDIR = "models";

    private final ExecutorService piperExecutor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean shuttingDown = new AtomicBoolean(false);
    private final AtomicBoolean bundledModelsSynced = new AtomicBoolean(false);
    private final AtomicBoolean importInProgress = new AtomicBoolean(false);
    private final AtomicBoolean activeImportCancelled = new AtomicBoolean(false);
    private final AtomicLong generationSeq = new AtomicLong(0L);
    private final AtomicLong cancelledAllThroughSeq = new AtomicLong(0L);
    private final Set<String> cancelledRequestIds = Collections.newSetFromMap(new ConcurrentHashMap<>());

    private PiperPhonemizer phonemizer;
    private PiperTtsEngine ttsEngine;
    private PiperBundledModelsInstaller.AssetSource bundledAssetSource;

    @Override
    public void load() {
        super.load();
        phonemizer = new EspeakPiperPhonemizer(getContext());
        ttsEngine = new SherpaOnnxPiperEngine();
        bundledAssetSource = new PiperBundledModelsInstaller.AndroidAssetSource(getContext().getAssets());
    }

    @Override
    protected void handleOnDestroy() {
        shuttingDown.set(true);
        activeImportCancelled.set(true);
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
                File modelsDir = ensureModelsReady();
                call.resolve(buildCatalogResponse(modelsDir));
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
                File modelsDir = ensureModelsReady();
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
    public void pickAndImportModelZip(PluginCall call) {
        if (!importInProgress.compareAndSet(false, true)) {
            call.reject("Импорт голосовой модели уже выполняется");
            return;
        }
        activeImportCancelled.set(false);

        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {
            "application/zip",
            "application/x-zip-compressed",
            "application/octet-stream"
        });

        Activity activity = getActivity();
        if (activity == null) {
            importInProgress.set(false);
            call.reject("Активность Android недоступна");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                startActivityForResult(call, intent, "handlePickModelZipResult");
            } catch (RuntimeException ex) {
                importInProgress.set(false);
                call.reject("Системный диалог выбора файла недоступен на этом устройстве", ex);
            }
        });
    }

    @ActivityCallback
    private void handlePickModelZipResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            importInProgress.set(false);
            return;
        }
        if (result.getResultCode() != Activity.RESULT_OK
            || result.getData() == null
            || result.getData().getData() == null) {
            importInProgress.set(false);
            JSObject cancelled = new JSObject();
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }

        final Uri uri = result.getData().getData();
        try {
            piperExecutor.execute(() -> {
                try {
                    long compressedBytes = queryOpenableSize(uri);
                    if (compressedBytes > PiperArchiveImporter.MAX_ARCHIVE_COMPRESSED_BYTES) {
                        call.reject("Размер архива голосовой модели превышает лимит 350 МБ");
                        return;
                    }
                    File modelsDir = ensureModelsReady();
                    long freeBytes = queryAvailableDiskBytes(modelsDir);

                    PiperVoiceDescriptor imported;
                    try (InputStream stream = getContext().getContentResolver().openInputStream(uri)) {
                        if (stream == null) {
                            call.reject("Не удалось открыть выбранный файл модели");
                            return;
                        }
                        imported = PiperArchiveImporter.importFromZipStream(
                            stream,
                            modelsDir,
                            freeBytes,
                            () -> shuttingDown.get() || activeImportCancelled.get(),
                            modelId -> {
                                if (ttsEngine != null) {
                                    ttsEngine.releaseModelIfLoaded(modelId);
                                }
                            }
                        );
                    }

                    JSObject res = buildCatalogResponse(modelsDir);
                    res.put("cancelled", false);
                    res.put("imported", descriptorToJson(imported));
                    call.resolve(res);
                } catch (Exception ex) {
                    if (activeImportCancelled.get()) {
                        JSObject cancelled = new JSObject();
                        cancelled.put("cancelled", true);
                        call.resolve(cancelled);
                    } else {
                        call.reject(ex.getMessage() != null ? ex.getMessage() : "Ошибка импорта голосовой модели", ex);
                    }
                } finally {
                    importInProgress.set(false);
                    activeImportCancelled.set(false);
                }
            });
        } catch (RejectedExecutionException ex) {
            importInProgress.set(false);
            call.reject("Piper TTS plugin is shutting down", ex);
        }
    }

    @PluginMethod
    public void cancelModelImport(PluginCall call) {
        activeImportCancelled.set(true);
        JSObject res = new JSObject();
        res.put("cancelled", true);
        call.resolve(res);
    }

    @PluginMethod
    public void deleteModel(PluginCall call) {
        final String rawModelId = call.getString("modelId", "");
        final String modelId;
        try {
            modelId = PiperModelSupport.validateModelId(rawModelId);
        } catch (IllegalArgumentException ex) {
            call.reject("Некорректный идентификатор модели Piper: " + rawModelId);
            return;
        }
        if (ttsEngine != null && modelId.equals(ttsEngine.getLoadedModelId())) {
            cancelledAllThroughSeq.set(generationSeq.get());
        }

        submitBackground(call, () -> {
            try {
                File modelsDir = ensureModelsReady();
                File targetDir = new File(modelsDir, modelId);
                if (!targetDir.isDirectory()) {
                    call.reject("Голосовая модель не найдена: " + modelId);
                    return;
                }

                File bundledMarker = new File(targetDir, ".bundled");
                boolean wasBundled = bundledMarker.isFile()
                    || PiperBundledModelsInstaller.isModelBundledInAssets(bundledAssetSource, modelId);
                String bundledSha = "";
                if (bundledMarker.isFile()) {
                    try {
                        bundledSha = PiperModelSupport.readUtf8File(bundledMarker).trim();
                    } catch (IOException ignored) {
                        bundledSha = "deleted";
                    }
                } else if (wasBundled) {
                    bundledSha = "deleted";
                }

                if (ttsEngine != null) {
                    ttsEngine.releaseModelIfLoaded(modelId);
                }

                PiperModelSupport.deleteRecursively(targetDir);
                if (targetDir.exists()) {
                    call.reject("Не удалось удалить файлы модели " + modelId);
                    return;
                }

                if (wasBundled) {
                    PiperBundledModelsInstaller.recordBundledDeletionTombstone(modelsDir, modelId, bundledSha);
                }
                PiperModelSupport.invalidateDescriptorCache();

                JSObject res = buildCatalogResponse(modelsDir);
                res.put("deletedModelId", modelId);
                call.resolve(res);
            } catch (Exception ex) {
                call.reject("Ошибка удаления голосовой модели: " + ex.getMessage(), ex);
            }
        });
    }

    @PluginMethod
    public void restoreBundledModels(PluginCall call) {
        submitBackground(call, () -> {
            try {
                File modelsDir = ensureModelsRootDir();
                PiperBundledModelsInstaller.InstallSummary summary =
                    PiperBundledModelsInstaller.restoreBundledModels(
                        bundledAssetSource,
                        modelsDir,
                        id -> {
                            if (ttsEngine != null) {
                                ttsEngine.releaseModelIfLoaded(id);
                            }
                        }
                    );
                bundledModelsSynced.set(true);
                JSObject res = buildCatalogResponse(modelsDir);
                res.put("restoredCount", summary.extractedIds.size());
                call.resolve(res);
            } catch (Exception ex) {
                call.reject("Не удалось восстановить встроенные голосовые модели: " + ex.getMessage(), ex);
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

    private File ensureModelsReady() throws IOException {
        File root = ensureModelsRootDir();
        if (bundledModelsSynced.compareAndSet(false, true)) {
            try {
                PiperBundledModelsInstaller.ensureBundledModelsInstalled(
                    bundledAssetSource,
                    root,
                    id -> {
                        if (ttsEngine != null) {
                            ttsEngine.releaseModelIfLoaded(id);
                        }
                    }
                );
            } catch (IOException ex) {
                bundledModelsSynced.set(false);
                throw ex;
            }
        }
        return root;
    }

    private File ensureModelsRootDir() throws IOException {
        File root = new File(new File(getContext().getFilesDir(), PIPER_ROOT_DIR), MODELS_SUBDIR);
        if (!root.exists() && !root.mkdirs()) {
            throw new IOException("Cannot create Piper models directory");
        }
        return root;
    }

    private JSObject buildCatalogResponse(File modelsDir) {
        List<PiperVoiceDescriptor> voices = PiperModelSupport.discoverInstalledVoices(modelsDir);
        JSArray voicesArr = new JSArray();
        for (PiperVoiceDescriptor v : voices) {
            voicesArr.put(descriptorToJson(v));
        }
        JSObject res = new JSObject();
        res.put("available", !voices.isEmpty());
        res.put("loadedModelId", ttsEngine != null ? ttsEngine.getLoadedModelId() : "");
        res.put("modelsDir", modelsDir.getAbsolutePath());
        res.put(
            "canRestoreBundled",
            PiperBundledModelsInstaller.hasRestorableDeletedBundledModels(bundledAssetSource, modelsDir)
        );
        res.put("voices", voicesArr);
        return res;
    }

    private long queryOpenableSize(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(
            uri,
            new String[] { OpenableColumns.SIZE },
            null,
            null,
            null
        )) {
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (idx >= 0 && !cursor.isNull(idx)) {
                    return cursor.getLong(idx);
                }
            }
        } catch (Exception ignored) {
            // Size column may be omitted by certain SAF providers; streaming limit still protects extraction.
        }
        return -1L;
    }

    private static long queryAvailableDiskBytes(File dir) {
        try {
            StatFs statFs = new StatFs(dir.getAbsolutePath());
            return statFs.getAvailableBytes();
        } catch (Exception ignored) {
            return -1L;
        }
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
