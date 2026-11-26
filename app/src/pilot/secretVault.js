import { getNativePlugin, isNativePluginAvailable } from './nativeBridge.js';

export const VAULT_SLOTS = ['gemini', 'openrouter', 'groq', 'azure_tts'];

const WEB_MEMORY_SECRETS = new Map();

const HOST_VALIDATORS = {
  gemini: (host) => host === 'generativelanguage.googleapis.com',
  openrouter: (host) => host === 'openrouter.ai',
  groq: (host) => host === 'api.groq.com',
  azure_tts: (host) => /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?\.tts\.speech\.microsoft\.com$/.test(host),
};

const RESERVED_HEADERS = new Set([
  'authorization',
  'x-goog-api-key',
  'ocp-apim-subscription-key',
  'host',
  'content-length',
  'cookie',
  'set-cookie',
]);

export function hasNativeSecureVault() {
  return isNativePluginAvailable('SecureNetworkVault');
}

export function getVaultStorageMode() {
  return hasNativeSecureVault() ? 'android_keystore' : 'memory';
}

export function scrubSecret(text, secret) {
  const s = String(secret || '').trim();
  const raw = String(text || '');
  return s.length >= 4 ? raw.replaceAll(s, '***') : raw;
}

export function validateAllowlistedUrl(slot, rawUrl) {
  const validator = HOST_VALIDATORS[slot];
  if (!validator) {
    throw new Error(`Unsupported key slot: ${slot}`);
  }
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    throw new Error('Malformed HTTPS URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
    throw new Error('Only strict standard HTTPS URLs are permitted');
  }
  if (!validator(parsed.hostname.toLowerCase())) {
    throw new Error(`URL host ${parsed.hostname} is not allowlisted for ${slot}`);
  }
  return parsed.toString();
}

export async function getVaultKeyStatus() {
  if (hasNativeSecureVault()) {
    const res = await getNativePlugin('SecureNetworkVault').getKeyStatus();
    return {
      storage: res?.storage || 'android_keystore',
      slots: res?.slots || {},
    };
  }
  const slots = {};
  for (const slot of VAULT_SLOTS) {
    slots[slot] = WEB_MEMORY_SECRETS.has(slot) && Boolean(WEB_MEMORY_SECRETS.get(slot));
  }
  return { storage: 'memory', slots };
}

export async function setVaultKey(slot, value) {
  if (!VAULT_SLOTS.includes(slot)) {
    throw new Error(`Unsupported key slot: ${slot}`);
  }
  const clean = String(value || '').trim();
  if (!clean) {
    throw new Error('API key cannot be empty');
  }
  if (hasNativeSecureVault()) {
    await getNativePlugin('SecureNetworkVault').setKey({ slot, value: clean });
    return true;
  }
  WEB_MEMORY_SECRETS.set(slot, clean);
  return true;
}

export async function deleteVaultKey(slot) {
  if (!VAULT_SLOTS.includes(slot)) {
    throw new Error(`Unsupported key slot: ${slot}`);
  }
  if (hasNativeSecureVault()) {
    await getNativePlugin('SecureNetworkVault').deleteKey({ slot });
    return true;
  }
  WEB_MEMORY_SECRETS.delete(slot);
  return true;
}

export function clearWebMemorySecrets() {
  WEB_MEMORY_SECRETS.clear();
}

function buildDirectWebHeaders(slot, secret, extraHeaders = {}) {
  const headers = {};
  for (const [k, v] of Object.entries(extraHeaders || {})) {
    const trimmed = String(k).trim();
    if (trimmed && !RESERVED_HEADERS.has(trimmed.toLowerCase()) && typeof v === 'string' && !/[\r\n]/.test(v)) {
      headers[trimmed] = v;
    }
  }
  if (slot === 'gemini') headers['x-goog-api-key'] = secret;
  else if (slot === 'azure_tts') headers['Ocp-Apim-Subscription-Key'] = secret;
  else headers.Authorization = `Bearer ${secret}`;
  return headers;
}

function makeAbortError() {
  if (typeof DOMException === 'function') {
    return new DOMException('Request canceled', 'AbortError');
  }
  const err = new Error('Request canceled');
  err.name = 'AbortError';
  return err;
}

function decodeBase64Bytes(b64) {
  const binary = atob(b64 || '');
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * Execute an outbound HTTPS request using a key stored in Android Keystore (never returned to JS)
 * on native Android, or using the session-memory key via Standalone loopback transport / direct fetch on Web.
 */
export async function secureHttpsRequest({
  slot,
  url,
  method = 'POST',
  headers = {},
  body = undefined,
  bodyBase64 = undefined,
  responseType = 'text',
  timeoutMs = 45000,
  signal = undefined,
}) {
  if (signal?.aborted) {
    throw makeAbortError();
  }
  const safeUrl = validateAllowlistedUrl(slot, url);
  const cleanMethod = String(method || 'POST').toUpperCase();

  if (hasNativeSecureVault()) {
    const requestId = typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const plugin = getNativePlugin('SecureNetworkVault');
    const onAbort = () => {
      plugin.cancelRequest({ requestId }).catch(() => {});
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await plugin.request({
        requestId,
        slot,
        url: safeUrl,
        method: cleanMethod,
        headers,
        body: typeof body === 'string' ? body : undefined,
        bodyBase64,
        responseType,
        timeoutMs,
      });
      if (signal?.aborted) throw makeAbortError();
      return {
        status: Number(res?.status || 0),
        ok: Boolean(res?.ok),
        contentType: res?.contentType || '',
        bodyText: res?.bodyText || '',
        bodyBytes: res?.bodyBase64 ? decodeBase64Bytes(res.bodyBase64) : null,
      };
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  const secret = WEB_MEMORY_SECRETS.get(slot);
  if (!secret) {
    throw new Error(`API ключ (${slot}) не задан в текущей сессии`);
  }

  // On Vite dev/preview localhost server (`run_standalone.bat`), use loopback HTTPS bridge to avoid CORS errors.
  const canUseLoopbackBridge = typeof window !== 'undefined'
    && (window.location?.hostname === '127.0.0.1' || window.location?.hostname === 'localhost')
    && (window.location?.protocol === 'http:' || window.location?.protocol === 'https:');

  if (canUseLoopbackBridge) {
    const bridgeUrl = new URL('/__standalone_ext_https', window.location.origin).toString();
    const bridgeRes = await fetch(bridgeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slot,
        url: safeUrl,
        method: cleanMethod,
        headers,
        body: typeof body === 'string' ? body : undefined,
        bodyBase64,
        responseType,
        timeoutMs,
        apiKey: secret,
      }),
      redirect: 'error',
      signal,
    }).catch((err) => {
      if (err?.name === 'AbortError' || signal?.aborted) throw makeAbortError();
      throw new Error(scrubSecret(err?.message || 'Standalone HTTPS bridge unreachable', secret));
    });

    if (bridgeRes.status !== 404) {
      const data = await bridgeRes.json().catch(() => ({}));
      if (!bridgeRes.ok) {
        throw new Error(scrubSecret(data?.error || `Standalone bridge HTTP ${bridgeRes.status}`, secret));
      }
      return {
        status: Number(data?.status || 0),
        ok: Boolean(data?.ok),
        contentType: data?.contentType || '',
        bodyText: data?.bodyText || '',
        bodyBytes: data?.bodyBase64 ? decodeBase64Bytes(data.bodyBase64) : null,
      };
    }
  }

  const directHeaders = buildDirectWebHeaders(slot, secret, headers);
  const directBody = cleanMethod === 'POST'
    ? (typeof bodyBase64 === 'string' ? decodeBase64Bytes(bodyBase64) : body)
    : undefined;
  let directRes;
  try {
    directRes = await fetch(safeUrl, {
      method: cleanMethod,
      headers: directHeaders,
      body: directBody,
      redirect: 'error',
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) throw makeAbortError();
    throw new Error(scrubSecret(err?.message || 'HTTPS request failed', secret));
  }
  const buf = new Uint8Array(await directRes.arrayBuffer());
  const contentType = directRes.headers?.get?.('content-type') || '';
  if (responseType === 'base64' && directRes.ok) {
    return {
      status: directRes.status,
      ok: true,
      contentType,
      bodyText: '',
      bodyBytes: buf,
    };
  }
  const text = new TextDecoder().decode(buf);
  return {
    status: directRes.status,
    ok: directRes.ok,
    contentType,
    bodyText: directRes.ok ? text : scrubSecret(text, secret),
    bodyBytes: null,
  };
}
