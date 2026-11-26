package com.lerne.app;

import java.util.Locale;

/**
 * Pure JVM-testable helpers for AndroidSystemTtsPlugin.
 */
final class AndroidSystemTtsPolicy {

    private AndroidSystemTtsPolicy() {}

    static float clampRate(Double rawRate) {
        if (rawRate == null || rawRate.isNaN() || rawRate.isInfinite()) {
            return 1.0f;
        }
        return (float) Math.max(0.5d, Math.min(2.0d, rawRate));
    }

    static Locale parseLocale(String lang) {
        String clean = lang == null ? "" : lang.trim().replace('_', '-').toLowerCase(Locale.ROOT);
        if (clean.isEmpty() || "de".equals(clean)) {
            return Locale.GERMANY;
        }
        if ("no".equals(clean) || "nb".equals(clean)) {
            return Locale.forLanguageTag("nb-NO");
        }
        if ("en".equals(clean)) {
            return Locale.US;
        }
        if ("uk".equals(clean)) {
            return Locale.forLanguageTag("uk-UA");
        }
        if ("ru".equals(clean)) {
            return Locale.forLanguageTag("ru-RU");
        }
        Locale parsed = Locale.forLanguageTag(clean);
        return parsed.getLanguage().isEmpty() ? Locale.GERMANY : parsed;
    }

    static boolean isValidWavHeader(byte[] bytes) {
        return bytes != null
            && bytes.length >= 44
            && bytes[0] == 'R'
            && bytes[1] == 'I'
            && bytes[2] == 'F'
            && bytes[3] == 'F'
            && bytes[8] == 'W'
            && bytes[9] == 'A'
            && bytes[10] == 'V'
            && bytes[11] == 'E';
    }
}
