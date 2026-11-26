package com.lerne.app;

import static org.junit.Assert.*;

import java.net.URL;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import org.junit.Test;

public class SecureNetworkVaultPolicyTest {

    @Test
    public void allowsOnlyStrictHttpsHostsPerSlot() {
        URL geminiUrl = SecureNetworkVaultPolicy.validateRequestUrl(
            "gemini",
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
        );
        assertEquals("generativelanguage.googleapis.com", geminiUrl.getHost());

        URL openrouterUrl = SecureNetworkVaultPolicy.validateRequestUrl(
            "openrouter",
            "https://openrouter.ai/api/v1/chat/completions"
        );
        assertEquals("openrouter.ai", openrouterUrl.getHost());

        URL groqUrl = SecureNetworkVaultPolicy.validateRequestUrl(
            "groq",
            "https://api.groq.com/openai/v1/chat/completions"
        );
        assertEquals("api.groq.com", groqUrl.getHost());

        URL azureUrl = SecureNetworkVaultPolicy.validateRequestUrl(
            "azure_tts",
            "https://germanywestcentral.tts.speech.microsoft.com/cognitiveservices/v1"
        );
        assertEquals("germanywestcentral.tts.speech.microsoft.com", azureUrl.getHost());
    }

    @Test
    public void rejectsCleartextCustomPortsRedirectsUserInfoAndForeignHosts() {
        assertThrows(
            IllegalArgumentException.class,
            () -> SecureNetworkVaultPolicy.validateRequestUrl(
                "gemini",
                "http://generativelanguage.googleapis.com/v1beta/models"
            )
        );
        assertThrows(
            IllegalArgumentException.class,
            () -> SecureNetworkVaultPolicy.validateRequestUrl(
                "gemini",
                "https://generativelanguage.googleapis.com:8443/v1beta/models"
            )
        );
        assertThrows(
            IllegalArgumentException.class,
            () -> SecureNetworkVaultPolicy.validateRequestUrl(
                "gemini",
                "https://user:pass@generativelanguage.googleapis.com/v1beta/models"
            )
        );
        assertThrows(
            IllegalArgumentException.class,
            () -> SecureNetworkVaultPolicy.validateRequestUrl(
                "gemini",
                "https://evil.example/v1beta/models"
            )
        );
        assertThrows(
            IllegalArgumentException.class,
            () -> SecureNetworkVaultPolicy.validateRequestUrl(
                "azure_tts",
                "https://-bad.tts.speech.microsoft.com/cognitiveservices/v1"
            )
        );
        assertTrue(SecureNetworkVaultPolicy.isRedirectStatus(301));
        assertTrue(SecureNetworkVaultPolicy.isRedirectStatus(302));
        assertFalse(SecureNetworkVaultPolicy.isRedirectStatus(200));
    }

    @Test
    public void injectsAuthHeadersBlocksReservedOverridesAndScrubsSecrets() {
        Map<String, String> headers = new LinkedHashMap<>();
        SecureNetworkVaultPolicy.injectAuthHeader("gemini", "AIzaSecret1234", headers);
        assertEquals("AIzaSecret1234", headers.get("x-goog-api-key"));

        Map<String, String> bearerHeaders = new LinkedHashMap<>();
        SecureNetworkVaultPolicy.injectAuthHeader("groq", "gsk_Secret5678", bearerHeaders);
        assertEquals("Bearer gsk_Secret5678", bearerHeaders.get("Authorization"));

        assertTrue(SecureNetworkVaultPolicy.isReservedHeader("Authorization"));
        assertTrue(SecureNetworkVaultPolicy.isReservedHeader("x-goog-api-key"));
        assertTrue(SecureNetworkVaultPolicy.isReservedHeader("Ocp-Apim-Subscription-Key"));
        assertFalse(SecureNetworkVaultPolicy.isReservedHeader("Content-Type"));

        assertEquals(
            "Error using *** on endpoint",
            SecureNetworkVaultPolicy.scrubSecret("Error using AIzaSecret1234 on endpoint", "AIzaSecret1234")
        );
    }

    @Test
    public void ttsPolicyClampsRatesResolvesLocalesAndDetectsWavHeaders() {
        assertEquals(0.5f, AndroidSystemTtsPolicy.clampRate(0.1d), 0.001f);
        assertEquals(1.0f, AndroidSystemTtsPolicy.clampRate(Double.NaN), 0.001f);
        assertEquals(2.0f, AndroidSystemTtsPolicy.clampRate(5.0d), 0.001f);
        assertEquals(Locale.GERMANY, AndroidSystemTtsPolicy.parseLocale("de"));
        assertEquals("nb", AndroidSystemTtsPolicy.parseLocale("no").getLanguage());

        byte[] wav = new byte[44];
        wav[0] = 'R';
        wav[1] = 'I';
        wav[2] = 'F';
        wav[3] = 'F';
        wav[8] = 'W';
        wav[9] = 'A';
        wav[10] = 'V';
        wav[11] = 'E';
        assertTrue(AndroidSystemTtsPolicy.isValidWavHeader(wav));
        wav[0] = 'I';
        assertFalse(AndroidSystemTtsPolicy.isValidWavHeader(wav));
    }
}
