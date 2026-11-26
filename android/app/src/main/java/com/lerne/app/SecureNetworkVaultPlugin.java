package com.lerne.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.HttpsURLConnection;

/**
 * Hardware-backed Android Keystore vault + strict HTTPS allowlist executor.
 * Keys are encrypted with AES-256-GCM at rest, decrypted only in native memory
 * during outbound allowlisted requests, and NEVER returned back to WebView JS.
 */
@CapacitorPlugin(name = "SecureNetworkVault")
public class SecureNetworkVaultPlugin extends Plugin {

    private static final String KEYSTORE_PROVIDER = "AndroidKeyStore";
    private static final String KEY_ALIAS = "lerne_offline_api_vault_aes256";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final String PREFS_NAME = "lerne_secure_vault";
    private static final int GCM_TAG_BITS = 128;

    private final ExecutorService networkExecutor = Executors.newCachedThreadPool();
    private final Map<String, HttpsURLConnection> activeRequests = new ConcurrentHashMap<>();
    private final Object keystoreLock = new Object();

    @Override
    protected void handleOnDestroy() {
        for (HttpsURLConnection conn : activeRequests.values()) {
            try {
                conn.disconnect();
            } catch (Exception ignored) {
                // Best-effort connection shutdown on plugin destroy.
            }
        }
        activeRequests.clear();
        networkExecutor.shutdownNow();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void getKeyStatus(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        JSObject slots = new JSObject();
        for (String slot : SecureNetworkVaultPolicy.ALLOWED_SLOTS) {
            String stored = prefs.getString("slot_" + slot, null);
            slots.put(slot, stored != null && !stored.isEmpty());
        }
        JSObject result = new JSObject();
        result.put("slots", slots);
        result.put("storage", "android_keystore");
        call.resolve(result);
    }

    @PluginMethod
    public void setKey(PluginCall call) {
        String slot = call.getString("slot", "");
        String value = call.getString("value", "");
        if (!SecureNetworkVaultPolicy.isValidSlot(slot)) {
            call.reject("Unsupported API key slot");
            return;
        }
        if (value == null || value.trim().isEmpty()) {
            call.reject("API key must not be empty");
            return;
        }
        String cleanValue = value.trim();
        try {
            String sealed = encryptWithKeystore(cleanValue);
            getContext()
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString("slot_" + slot, sealed)
                .apply();
            JSObject result = new JSObject();
            result.put("ok", true);
            result.put("slot", slot);
            call.resolve(result);
        } catch (Exception ex) {
            call.reject("Failed to store key securely: " + ex.getClass().getSimpleName());
        }
    }

    @PluginMethod
    public void deleteKey(PluginCall call) {
        String slot = call.getString("slot", "");
        if (!SecureNetworkVaultPolicy.isValidSlot(slot)) {
            call.reject("Unsupported API key slot");
            return;
        }
        getContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove("slot_" + slot)
            .apply();
        JSObject result = new JSObject();
        result.put("ok", true);
        result.put("slot", slot);
        call.resolve(result);
    }

    @PluginMethod
    public void cancelRequest(PluginCall call) {
        String requestId = call.getString("requestId", "");
        if (requestId != null && !requestId.isEmpty()) {
            HttpsURLConnection conn = activeRequests.remove(requestId);
            if (conn != null) {
                networkExecutor.execute(() -> {
                    try {
                        conn.disconnect();
                    } catch (Exception ignored) {
                        // Best-effort abort.
                    }
                });
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void request(PluginCall call) {
        final String requestId = call.getString("requestId", "");
        final String slot = call.getString("slot", "");
        final String urlString = call.getString("url", "");
        final String method;
        final URL targetUrl;
        try {
            method = SecureNetworkVaultPolicy.normalizeMethod(call.getString("method", "POST"));
            targetUrl = SecureNetworkVaultPolicy.validateRequestUrl(slot, urlString);
        } catch (IllegalArgumentException ex) {
            call.reject(ex.getMessage());
            return;
        }

        final JSObject reqHeadersObj = call.getObject("headers", new JSObject());
        final String bodyText = call.getString("body", null);
        final String bodyBase64 = call.getString("bodyBase64", null);
        final String responseType = call.getString("responseType", "text");
        final int timeoutMs = SecureNetworkVaultPolicy.clampTimeoutMs(call.getInt("timeoutMs", null));

        networkExecutor.execute(() -> executeHttpsRequest(
            call, requestId, slot, targetUrl, method, reqHeadersObj, bodyText, bodyBase64, responseType, timeoutMs
        ));
    }

    private void executeHttpsRequest(
        PluginCall call,
        String requestId,
        String slot,
        URL targetUrl,
        String method,
        JSObject reqHeadersObj,
        String bodyText,
        String bodyBase64,
        String responseType,
        int timeoutMs
    ) {
        String secret = null;
        HttpsURLConnection conn = null;
        try {
            secret = readSecretForSlot(slot);
            Map<String, String> headers = new LinkedHashMap<>();
            if (reqHeadersObj != null) {
                Iterator<String> keys = reqHeadersObj.keys();
                while (keys.hasNext()) {
                    String headerName = keys.next();
                    if (!SecureNetworkVaultPolicy.isReservedHeader(headerName)) {
                        String val = reqHeadersObj.optString(headerName, "");
                        if (val != null && !val.contains("\r") && !val.contains("\n")) {
                            headers.put(headerName, val);
                        }
                    }
                }
            }
            SecureNetworkVaultPolicy.injectAuthHeader(slot, secret, headers);

            byte[] payloadBytes = null;
            if ("POST".equals(method)) {
                if (bodyBase64 != null) {
                    payloadBytes = Base64.decode(bodyBase64, Base64.DEFAULT);
                } else if (bodyText != null) {
                    payloadBytes = bodyText.getBytes(StandardCharsets.UTF_8);
                }
            }

            conn = (HttpsURLConnection) targetUrl.openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(Math.min(timeoutMs, 20_000));
            conn.setReadTimeout(timeoutMs);
            conn.setRequestMethod(method);
            for (Map.Entry<String, String> entry : headers.entrySet()) {
                conn.setRequestProperty(entry.getKey(), entry.getValue());
            }

            if (requestId != null && !requestId.isEmpty()) {
                activeRequests.put(requestId, conn);
            }

            if ("POST".equals(method) && payloadBytes != null) {
                conn.setDoOutput(true);
                conn.setFixedLengthStreamingMode(payloadBytes.length);
                try (OutputStream out = conn.getOutputStream()) {
                    out.write(payloadBytes);
                }
            }

            int status = conn.getResponseCode();
            if (SecureNetworkVaultPolicy.isRedirectStatus(status)) {
                call.reject("HTTPS redirect blocked by security policy (HTTP " + status + ")");
                return;
            }

            InputStream stream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            byte[] responseBytes = stream != null ? readBoundedStream(stream) : new byte[0];
            String contentType = conn.getContentType() != null ? conn.getContentType() : "";

            JSObject result = new JSObject();
            result.put("status", status);
            result.put("ok", status >= 200 && status < 300);
            result.put("contentType", contentType);
            if ("base64".equalsIgnoreCase(responseType) && status < 400) {
                result.put("bodyBase64", Base64.encodeToString(responseBytes, Base64.NO_WRAP));
            } else {
                String text = new String(responseBytes, StandardCharsets.UTF_8);
                result.put("bodyText", status >= 400 ? SecureNetworkVaultPolicy.scrubSecret(text, secret) : text);
            }
            call.resolve(result);
        } catch (Exception ex) {
            String message = SecureNetworkVaultPolicy.scrubSecret(
                ex.getMessage() != null ? ex.getMessage() : ex.getClass().getSimpleName(),
                secret
            );
            call.reject("HTTPS request failed: " + message);
        } finally {
            if (requestId != null && !requestId.isEmpty()) {
                activeRequests.remove(requestId);
            }
            if (conn != null) {
                try {
                    conn.disconnect();
                } catch (Exception ignored) {
                    // Best-effort cleanup.
                }
            }
        }
    }

    private byte[] readBoundedStream(InputStream stream) throws IOException {
        try (InputStream in = stream; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            int total = 0;
            while ((read = in.read(buffer)) != -1) {
                total += read;
                if (total > SecureNetworkVaultPolicy.MAX_RESPONSE_BYTES) {
                    throw new IOException("Response exceeded 20 MiB limit");
                }
                out.write(buffer, 0, read);
            }
            return out.toByteArray();
        }
    }

    private SecretKey getOrCreateKey() throws Exception {
        synchronized (keystoreLock) {
            KeyStore ks = KeyStore.getInstance(KEYSTORE_PROVIDER);
            ks.load(null);
            KeyStore.Entry entry = ks.getEntry(KEY_ALIAS, null);
            if (entry instanceof KeyStore.SecretKeyEntry) {
                return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
            }
            KeyGenerator keyGen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER);
            KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build();
            keyGen.init(spec);
            return keyGen.generateKey();
        }
    }

    private String encryptWithKeystore(String plaintext) throws Exception {
        SecretKey key = getOrCreateKey();
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, key);
        byte[] iv = cipher.getIV();
        byte[] encrypted = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(iv, Base64.NO_WRAP) + "." + Base64.encodeToString(encrypted, Base64.NO_WRAP);
    }

    private String readSecretForSlot(String slot) throws Exception {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String sealed = prefs.getString("slot_" + slot, null);
        if (sealed == null || sealed.isEmpty()) {
            return null;
        }
        String[] parts = sealed.split("\\.", 2);
        if (parts.length != 2) {
            throw new IllegalStateException("Corrupted secure vault entry for " + slot);
        }
        byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
        byte[] cipherBytes = Base64.decode(parts[1], Base64.NO_WRAP);
        SecretKey key = getOrCreateKey();
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, iv));
        byte[] plainBytes = cipher.doFinal(cipherBytes);
        return new String(plainBytes, StandardCharsets.UTF_8);
    }
}
