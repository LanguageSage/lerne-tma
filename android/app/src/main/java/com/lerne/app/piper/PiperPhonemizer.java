package com.lerne.app.piper;

import java.io.IOException;

/**
 * Replaceable text-to-phoneme boundary for Piper / VITS models.
 * Isolates GPLv3 espeak-ng / piper-phonemize behind a clean interface so alternative
 * phonemizers can be swapped without touching TTS engine or application logic.
 */
public interface PiperPhonemizer {
    void ensureInitialized() throws IOException;

    int[][] phonemize(String text, PiperVoiceDescriptor voice) throws IOException;

    void close();
}
