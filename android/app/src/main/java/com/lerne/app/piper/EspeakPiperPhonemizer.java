package com.lerne.app.piper;

import android.content.Context;
import android.content.res.AssetManager;
import com.github.csukuangfj.piper.phonemize.PiperPhonemizeKt;
import com.github.csukuangfj.piper.phonemize.PiperPhonemizeResult;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Default offline German/multilingual G2P phonemizer backed by piper-phonemize 1.6.1 (espeak-ng).
 * Uses a static process-wide lock because native espeak-ng state in libpiper-phonemize-jni.so is global.
 */
public final class EspeakPiperPhonemizer implements PiperPhonemizer {

    private static final String PIPER_ROOT_DIR = "lerne-piper";
    private static final String ESPEAK_ASSET_DIR = "espeak-ng-data";
    private static final String READY_MARKER_NAME = ".ready-espeak-v1.6.1";

    private static final Object PROCESS_ESPEAK_LOCK = new Object();
    private static String initializedEspeakPath = "";

    private final Context appContext;

    public EspeakPiperPhonemizer(Context context) {
        this.appContext = context.getApplicationContext();
    }

    @Override
    public void ensureInitialized() throws IOException {
        synchronized (PROCESS_ESPEAK_LOCK) {
            File piperRoot = new File(appContext.getFilesDir(), PIPER_ROOT_DIR);
            File espeakDir = new File(piperRoot, ESPEAK_ASSET_DIR);
            File marker = new File(espeakDir, READY_MARKER_NAME);
            File phontab = new File(espeakDir, "phontab");
            String targetPath = espeakDir.getAbsolutePath();

            if (targetPath.equals(initializedEspeakPath) && marker.isFile() && phontab.isFile()) {
                return;
            }

            if (!marker.isFile() || !phontab.isFile()) {
                PiperModelSupport.deleteRecursively(espeakDir);
                if (!espeakDir.mkdirs() && !espeakDir.isDirectory()) {
                    throw new IOException("Unable to create espeak-ng-data directory");
                }
                extractAssetTree(appContext.getAssets(), ESPEAK_ASSET_DIR, espeakDir);
                if (!phontab.isFile()) {
                    throw new IOException("Extracted espeak-ng-data is incomplete (missing phontab)");
                }
                PiperModelSupport.writeUtf8Atomic(marker, "piper-phonemize-1.6.1\n");
            }

            int status = PiperPhonemizeKt.piperPhonemizeInitialize(targetPath);
            if (status < 0) {
                throw new IOException("Failed to initialize espeak-ng phonemizer (code " + status + ")");
            }
            initializedEspeakPath = targetPath;
        }
    }

    @Override
    public int[][] phonemize(String text, PiperVoiceDescriptor voice) throws IOException {
        if (text == null || text.trim().isEmpty()) {
            throw new IOException("Text for Piper phonemization is empty");
        }
        ensureInitialized();
        String espeakVoice = (voice != null && voice.espeakVoice != null && !voice.espeakVoice.isEmpty())
            ? voice.espeakVoice
            : "de";

        synchronized (PROCESS_ESPEAK_LOCK) {
            PiperPhonemizeResult result = PiperPhonemizeKt.piperPhonemizeText(text.trim(), espeakVoice);
            if (result == null) {
                throw new IOException("Phonemizer returned null for voice " + espeakVoice);
            }
            try {
                int numSentences = result.getNumSentences();
                List<int[]> sentences = new ArrayList<>(Math.max(1, numSentences));
                for (int i = 0; i < numSentences; i++) {
                    int[] raw = result.getPhonemes(i);
                    if (raw == null || raw.length == 0) {
                        continue;
                    }
                    int[] processed = PiperModelSupport.postProcessSentenceCodepoints(
                        raw,
                        voice != null ? voice.vowelClusters : null,
                        voice != null ? voice.puaMap : null,
                        voice != null ? voice.tokenCodepoints : null
                    );
                    if (processed.length > 0) {
                        sentences.add(processed);
                    }
                }
                if (sentences.isEmpty()) {
                    throw new IOException("No speakable phonemes produced for input text");
                }
                return sentences.toArray(new int[0][]);
            } finally {
                result.close();
            }
        }
    }

    @Override
    public void close() {
        // Native espeak-ng state is process-scoped; per-utterance handles are closed in phonemize().
    }

    private static void extractAssetTree(AssetManager assets, String assetPath, File destDir) throws IOException {
        String[] children = assets.list(assetPath);
        if (children == null || children.length == 0) {
            try (InputStream in = assets.open(assetPath);
                 FileOutputStream fos = new FileOutputStream(destDir);
                 BufferedOutputStream out = new BufferedOutputStream(fos, 32768)) {
                byte[] buffer = new byte[32768];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                }
                out.flush();
            }
            return;
        }
        if (!destDir.exists() && !destDir.mkdirs()) {
            throw new IOException("Failed to create directory: " + destDir.getName());
        }
        for (String child : children) {
            extractAssetTree(assets, assetPath + "/" + child, new File(destDir, child));
        }
    }
}
