package com.lerne.app.piper;

/**
 * Encoded WAV synthesis result produced by a PiperTtsEngine.
 */
public final class PiperSynthOutput {
    public final byte[] wavBytes;
    public final int sampleRate;
    public final int durationMs;

    public PiperSynthOutput(byte[] wavBytes, int sampleRate, int durationMs) {
        this.wavBytes = wavBytes;
        this.sampleRate = sampleRate;
        this.durationMs = durationMs;
    }
}
