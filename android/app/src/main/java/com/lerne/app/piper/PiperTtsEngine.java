package com.lerne.app.piper;

import java.io.IOException;
import java.util.function.BooleanSupplier;

/**
 * Replaceable neural acoustic TTS inference engine boundary.
 * Implementations must keep at most one voice model loaded in memory at a time.
 */
public interface PiperTtsEngine {
    PiperSynthOutput synthesize(
        PiperVoiceDescriptor voice,
        int[][] phonemeSentences,
        int speakerId,
        float speed,
        BooleanSupplier isCancelled
    ) throws IOException;

    String getLoadedModelId();

    void releaseModelIfLoaded(String modelId);

    void release();
}
