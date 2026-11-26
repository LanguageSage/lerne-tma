package com.lerne.app;

import java.net.MalformedURLException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Pure JVM-testable security policy for outbound HTTPS requests executed by SecureNetworkVaultPlugin.
 */
final class SecureNetworkVaultPolicy {

    static final int MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
    static final int DEFAULT_TIMEOUT_MS = 45_000;
    static final int MAX_TIMEOUT_MS = 120_000;

    static final Set<String> ALLOWED_SLOTS = Collections.unmodifiableSet(
        new HashSet<>(Arrays.asList("gemini", "openrouter", "groq", "azure_tts"))
    );

    static final Set<String> ALLOWED_METHODS = Collections.unmodifiableSet(
        new HashSet<>(Arrays.asList("GET", "POST"))
    );

    static final Set<String> RESERVED_HEADERS = Collections.unmodifiableSet(
        new HashSet<>(Arrays.asList(
            "authorization",
            "x-goog-api-key",
            "ocp-apim-subscription-key",
            "host",
            "content-length",
            "cookie",
            "set-cookie"
        ))
    );

    private static final Pattern AZURE_TTS_HOST_PATTERN = Pattern.compile(
        "^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?\\.tts\\.speech\\.microsoft\\.com$"
    );

    private SecureNetworkVaultPolicy() {}

    static boolean isValidSlot(String slot) {
        return slot != null && ALLOWED_SLOTS.contains(slot);
    }

    static String normalizeMethod(String method) {
        String clean = method == null || method.trim().isEmpty()
            ? "POST"
            : method.trim().toUpperCase(Locale.ROOT);
        if (!ALLOWED_METHODS.contains(clean)) {
            throw new IllegalArgumentException("Unsupported HTTP method: " + clean);
        }
        return clean;
    }

    static URL validateRequestUrl(String slot, String urlString) {
        if (!isValidSlot(slot)) {
            throw new IllegalArgumentException("Unsupported vault slot");
        }
        if (urlString == null || urlString.trim().isEmpty()) {
            throw new IllegalArgumentException("URL is required");
        }
        URI uri;
        URL parsed;
        try {
            uri = new URI(urlString.trim());
            parsed = uri.toURL();
        } catch (URISyntaxException | MalformedURLException | IllegalArgumentException ex) {
            throw new IllegalArgumentException("Malformed HTTPS URL");
        }

        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!"https".equals(scheme)) {
            throw new IllegalArgumentException("Only HTTPS requests are permitted");
        }
        if (uri.getRawUserInfo() != null && !uri.getRawUserInfo().isEmpty()) {
            throw new IllegalArgumentException("Credentials in URL authority are forbidden");
        }
        int port = uri.getPort();
        if (port != -1 && port != 443) {
            throw new IllegalArgumentException("Non-standard HTTPS port is forbidden");
        }
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
        if (!isHostAllowedForSlot(slot, host)) {
            throw new IllegalArgumentException("Host is not in allowlist for slot " + slot);
        }
        return parsed;
    }

    static boolean isHostAllowedForSlot(String slot, String host) {
        if (host == null || host.isEmpty()) {
            return false;
        }
        switch (slot) {
            case "gemini":
                return "generativelanguage.googleapis.com".equals(host);
            case "openrouter":
                return "openrouter.ai".equals(host);
            case "groq":
                return "api.groq.com".equals(host);
            case "azure_tts":
                return AZURE_TTS_HOST_PATTERN.matcher(host).matches();
            default:
                return false;
        }
    }

    static boolean isReservedHeader(String headerName) {
        if (headerName == null) {
            return true;
        }
        String normalized = headerName.trim().toLowerCase(Locale.ROOT);
        return normalized.isEmpty() || RESERVED_HEADERS.contains(normalized) || normalized.contains("\r") || normalized.contains("\n");
    }

    static void injectAuthHeader(String slot, String secret, Map<String, String> outHeaders) {
        if (secret == null || secret.trim().isEmpty()) {
            throw new IllegalStateException("API key for " + slot + " is not configured");
        }
        String cleanSecret = secret.trim();
        switch (slot) {
            case "gemini":
                outHeaders.put("x-goog-api-key", cleanSecret);
                break;
            case "openrouter":
            case "groq":
                outHeaders.put("Authorization", "Bearer " + cleanSecret);
                break;
            case "azure_tts":
                outHeaders.put("Ocp-Apim-Subscription-Key", cleanSecret);
                break;
            default:
                throw new IllegalArgumentException("Unsupported vault slot");
        }
    }

    static boolean isRedirectStatus(int statusCode) {
        return statusCode >= 300 && statusCode <= 399;
    }

    static int clampTimeoutMs(Integer requestedMs) {
        if (requestedMs == null || requestedMs <= 0) {
            return DEFAULT_TIMEOUT_MS;
        }
        return Math.max(1000, Math.min(MAX_TIMEOUT_MS, requestedMs));
    }

    static String scrubSecret(String text, String secret) {
        if (text == null || text.isEmpty()) {
            return "";
        }
        if (secret == null || secret.trim().length() < 4) {
            return text;
        }
        return text.replace(secret.trim(), "***");
    }
}
