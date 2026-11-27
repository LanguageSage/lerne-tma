import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const mode = (process.env.LERNE_MODE || '').toUpperCase();
if (mode && mode !== 'LOCAL') throw new Error('Unknown LERNE_MODE; use LOCAL or leave it unset');
const local = mode === 'LOCAL' || process.env.VITE_LERNE_LOCAL === '1';
const standalone = process.env.VITE_LERNE_STANDALONE === '1';
if (local && standalone) throw new Error('LOCAL and STANDALONE cannot be enabled together');
const preview = local && process.env.LERNE_V2_PREVIEW === '1';
const localPort = preview ? 5174 : 5173;
const localApiPort = preview ? 8002 : 8001;
const rawStandalonePort = Number.parseInt(process.env.LERNE_STANDALONE_PORT || '', 10);
const standalonePort = Number.isInteger(rawStandalonePort) && rawStandalonePort > 0 && rawStandalonePort <= 65535
  ? rawStandalonePort
  : 5175;
const localNonce = local ? randomBytes(16).toString('base64') : undefined;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localRoot = process.env.LERNE_DATA_ROOT || path.resolve(projectRoot, '../data');
const configPath = path.resolve(process.env.LERNE_LOCAL_CONFIG || path.join(localRoot, 'config/local.json'));
if (local) {
  if (process.env.VERCEL || process.env.VERCEL_ENV || process.env.NODE_ENV === 'production'
      || process.env.ENVIRONMENT === 'production') throw new Error('LOCAL cannot run in Production');
  const relative = path.relative(fs.realpathSync(projectRoot), fs.realpathSync(configPath));
  if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw new Error('LOCAL config must be outside the repository');
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('VITE_')) delete process.env[key];
  }
  process.env.VITE_LERNE_LOCAL = '1';
}
const localPlugin = {
  name: 'lerne-local-isolation',
  configureServer(server) {
    if (!preview) return;
    server.middlewares.use('/v2-preview', (_req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(fs.readFileSync(path.join(projectRoot, 'local/v2_preview.html'), 'utf8')
        .replaceAll('__NONCE__', localNonce));
    });
  },
  transformIndexHtml: html => html.replace(/<link[^>]+https:\/\/fonts\.[^>]+>/g, '')
    .replace(/<script src="https:\/\/telegram\.org[^>]+><\/script>/g, ''),
  transform(code, id) {
    if (id.endsWith('.css')) return code.replace(/@import url\(['"]https?:[^;]+;/g, '');
  },
};
const STANDALONE_HOST_ALLOWLIST = {
  gemini: (host) => host === 'generativelanguage.googleapis.com',
  openrouter: (host) => host === 'openrouter.ai',
  groq: (host) => host === 'api.groq.com',
  azure_tts: (host) => /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?\.tts\.speech\.microsoft\.com$/.test(host),
};

const RESERVED_EXT_HEADERS = new Set([
  'authorization',
  'x-goog-api-key',
  'ocp-apim-subscription-key',
  'host',
  'content-length',
  'cookie',
  'set-cookie',
]);

function scrubSecretText(text, secret) {
  const s = String(secret || '').trim();
  const raw = String(text || '');
  return s.length >= 4 ? raw.replaceAll(s, '***') : raw;
}

function attachStandaloneExtHttpsMiddleware(server, allowedOrigins) {
  server.middlewares.use('/__standalone_ext_https', (req, res) => {
    let responded = false;
    const fail = (status, message) => {
      if (responded) return;
      responded = true;
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ ok: false, error: message }));
    };

    const remote = req.socket?.remoteAddress || '';
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) {
      return fail(403, 'Loopback requests only');
    }
    if (req.method !== 'POST') {
      return fail(405, 'Method not allowed');
    }
    if (Array.isArray(req.headers.origin) || Array.isArray(req.headers.host)) {
      return fail(403, 'Invalid duplicate security headers');
    }
    const origin = req.headers.origin;
    if (!isTrustedStandaloneHost(req) || !isTrustedStandaloneOrigin(origin, req, allowedOrigins)) {
      return fail(403, 'Untrusted origin');
    }

    const chunks = [];
    let totalBytes = 0;
    const MAX_BODY = 2 * 1024 * 1024;
    req.on('data', (chunk) => {
      if (responded) return;
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY) {
        fail(413, 'Request body too large');
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', () => fail(400, 'Stream read error'));
    req.on('end', async () => {
      if (responded) return;
      let apiKey = '';
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const slot = String(parsed?.slot || '').trim();
        const rawUrl = String(parsed?.url || '').trim();
        const method = String(parsed?.method || 'POST').trim().toUpperCase();
        apiKey = String(parsed?.apiKey || '').trim();
        const validator = STANDALONE_HOST_ALLOWLIST[slot];
        if (!validator) return fail(403, 'Unsupported provider slot');
        if (!['GET', 'POST'].includes(method)) return fail(400, 'Unsupported HTTP method');
        if (!apiKey) return fail(401, 'API key is required');

        let target;
        try {
          target = new URL(rawUrl);
        } catch {
          return fail(400, 'Invalid target URL');
        }
        if (target.protocol !== 'https:' || target.username || target.password || (target.port && target.port !== '443')) {
          return fail(403, 'Only standard HTTPS URLs are permitted');
        }
        if (!validator(target.hostname.toLowerCase())) {
          return fail(403, `Host not allowed for ${slot}`);
        }

        const outHeaders = {};
        if (parsed?.headers && typeof parsed.headers === 'object') {
          for (const [k, v] of Object.entries(parsed.headers)) {
            const trimmed = String(k).trim();
            const lower = trimmed.toLowerCase();
            if (trimmed && !RESERVED_EXT_HEADERS.has(lower) && typeof v === 'string' && !/[\r\n]/.test(v)) {
              outHeaders[trimmed] = v;
            }
          }
        }
        if (slot === 'gemini') outHeaders['x-goog-api-key'] = apiKey;
        else if (slot === 'azure_tts') outHeaders['Ocp-Apim-Subscription-Key'] = apiKey;
        else outHeaders.Authorization = `Bearer ${apiKey}`;

        const timeoutMs = Math.max(1000, Math.min(120000, Number(parsed?.timeoutMs) || 45000));
        const body = method === 'POST'
          ? (typeof parsed?.bodyBase64 === 'string'
            ? Buffer.from(parsed.bodyBase64, 'base64')
            : (typeof parsed?.body === 'string' ? parsed.body : undefined))
          : undefined;

        const upstream = await fetch(target.toString(), {
          method,
          headers: outHeaders,
          body,
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
        });
        const maxRespBytes = 20 * 1024 * 1024;
        const respChunks = [];
        let respTotal = 0;
        if (upstream.body && typeof upstream.body.getReader === 'function') {
          const reader = upstream.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            respTotal += value.byteLength;
            if (respTotal > maxRespBytes) {
              await reader.cancel().catch(() => {});
              return fail(502, 'Upstream response exceeded 20 MiB');
            }
            respChunks.push(Buffer.from(value));
          }
        } else {
          const fallbackBuf = Buffer.from(await upstream.arrayBuffer());
          if (fallbackBuf.length > maxRespBytes) {
            return fail(502, 'Upstream response exceeded 20 MiB');
          }
          respChunks.push(fallbackBuf);
        }
        const buf = Buffer.concat(respChunks);
        const contentType = upstream.headers.get('content-type') || '';
        const responseType = parsed?.responseType === 'base64' ? 'base64' : 'text';

        res.statusCode = 200;
        responded = true;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({
          status: upstream.status,
          ok: upstream.ok,
          contentType,
          ...(responseType === 'base64' && upstream.ok
            ? { bodyBase64: buf.toString('base64') }
            : { bodyText: upstream.ok ? buf.toString('utf8') : scrubSecretText(buf.toString('utf8'), apiKey) }),
        }));
      } catch (err) {
        return fail(502, scrubSecretText(err?.message || 'Upstream HTTPS error', apiKey));
      }
    });
  });
}

const standaloneAllowedOrigins = new Set([
  `http://127.0.0.1:${standalonePort}`,
  `http://localhost:${standalonePort}`,
]);

function isTrustedStandaloneHost(req, fallbackPort = standalonePort) {
  const hostHeader = req.headers?.host;
  if (typeof hostHeader !== 'string' || !hostHeader) return true;
  const boundPort = req.socket?.localPort || fallbackPort;
  const normalized = hostHeader.trim().toLowerCase();
  return (
    normalized === `127.0.0.1:${boundPort}`
    || normalized === `localhost:${boundPort}`
    || normalized === `127.0.0.1:${fallbackPort}`
    || normalized === `localhost:${fallbackPort}`
  );
}

function isTrustedStandaloneOrigin(origin, req, allowedOrigins, fallbackPort = standalonePort) {
  if (typeof origin !== 'string' || !origin) return false;
  if (allowedOrigins.has(origin)) return true;
  const boundPort = req.socket?.localPort || fallbackPort;
  return origin === `http://127.0.0.1:${boundPort}` || origin === `http://localhost:${boundPort}`;
}

const SAFE_PIPER_MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
const PIPER_PRIORITY_ORDER = new Map([
  ['de_DE-thorsten-high', 0],
  ['de_DE-kerstin-medium', 1],
  ['de_DE-thorsten-medium', 2],
  ['de_DE-thorsten_emotional-medium', 3],
  ['de_DE-ramona-low', 4],
  ['de_DE-eva_k-x_low', 5],
]);
let activeStandalonePiperJobs = 0;
const MAX_STANDALONE_PIPER_JOBS = 2;

function isRealpathInside(candidatePath, rootDir) {
  try {
    const realRoot = fs.realpathSync(rootDir);
    const realCand = fs.realpathSync(candidatePath);
    const rel = path.relative(realRoot, realCand);
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
  } catch {
    return false;
  }
}

function killStandalonePiperTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    try {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.on('error', () => {
        try { child.kill(); } catch { /* ignore */ }
      });
      return;
    } catch {
      try { child.kill(); } catch { /* ignore */ }
      return;
    }
  }
  try { child.kill('SIGKILL'); } catch { /* ignore */ }
}

function resolveStandalonePiperRoot() {
  const raw = String(process.env.LERNE_PIPER_ROOT || '').trim();
  return raw ? path.resolve(raw) : path.resolve(localRoot, 'tts', 'piper');
}

function resolveStandalonePiperRunner(piperRoot) {
  const envBin = String(process.env.LERNE_PIPER_BIN || '').trim();
  if (envBin) {
    const resolvedEnv = path.resolve(envBin);
    try {
      if (fs.statSync(resolvedEnv).isFile()) {
        return { cmd: resolvedEnv, baseArgs: [] };
      }
    } catch { /* ignore */ }
  }

  const isWin = process.platform === 'win32';
  const scriptsDir = path.join(piperRoot, 'runtime', 'venv', isWin ? 'Scripts' : 'bin');
  const venvPython = path.join(scriptsDir, isWin ? 'python.exe' : 'python');
  const venvPiper = path.join(scriptsDir, isWin ? 'piper.exe' : 'piper');
  try {
    // Prefer signed venv python.exe -m piper over unsigned pip distlib piper.exe wrapper (avoids Windows 11 EPERM).
    if (fs.statSync(venvPython).isFile() && fs.statSync(venvPiper).isFile()) {
      return { cmd: venvPython, baseArgs: ['-m', 'piper'] };
    }
  } catch { /* ignore */ }

  const exeName = isWin ? 'piper.exe' : 'piper';
  for (const cand of [
    path.join(piperRoot, exeName),
    path.join(piperRoot, 'piper', exeName),
    venvPiper,
  ]) {
    try {
      if (fs.statSync(cand).isFile()) {
        return { cmd: cand, baseArgs: [] };
      }
    } catch { /* ignore */ }
  }
  return null;
}

function discoverStandalonePiperVoices(piperRoot) {
  const modelsDir = path.join(piperRoot, 'models');
  let entries;
  try {
    if (!fs.statSync(modelsDir).isDirectory()) return [];
    entries = fs.readdirSync(modelsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const voices = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || !SAFE_PIPER_MODEL_ID_RE.test(entry.name)) {
      continue;
    }
    const mdir = path.join(modelsDir, entry.name);
    if (!isRealpathInside(mdir, modelsDir)) continue;
    let files;
    try {
      files = fs.readdirSync(mdir);
    } catch {
      continue;
    }
    const onnxName = files.sort().find((f) => f.endsWith('.onnx') && !f.endsWith('.tmp'));
    if (!onnxName) continue;
    const modelId = onnxName.slice(0, -'.onnx'.length);
    if (!SAFE_PIPER_MODEL_ID_RE.test(modelId)) continue;
    const onnxPath = path.join(mdir, onnxName);
    const jsonPath = path.join(mdir, `${onnxName}.json`);
    if (!isRealpathInside(onnxPath, modelsDir) || !isRealpathInside(jsonPath, modelsDir)) continue;

    let onnxStat;
    let onnxJson;
    try {
      onnxStat = fs.statSync(onnxPath);
      if (!onnxStat.isFile() || onnxStat.size <= 64 || !fs.statSync(jsonPath).isFile()) continue;
      onnxJson = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } catch {
      continue;
    }

    let manifest = null;
    const manifestPath = path.join(mdir, 'manifest.json');
    try {
      if (fs.existsSync(manifestPath) && isRealpathInside(manifestPath, modelsDir)) {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      }
    } catch {
      manifest = null;
    }

    let licenseText = JSON.stringify(onnxJson);
    for (const metaFile of ['MODEL_CARD', 'LICENSE', 'README.md']) {
      const p = path.join(mdir, metaFile);
      try {
        if (fs.existsSync(p) && isRealpathInside(p, modelsDir) && fs.statSync(p).size <= 65536) {
          licenseText += `\n${fs.readFileSync(p, 'utf8')}`;
        }
      } catch { /* ignore */ }
    }
    const lowerLic = licenseText.toLowerCase();
    let license = 'Локальная модель';
    let commercialSafe = true;
    if (lowerLic.includes('cc-by-nc') || lowerLic.includes('noncommercial') || lowerLic.includes('non-commercial')) {
      license = 'CC-BY-NC';
      commercialSafe = false;
    } else if (lowerLic.includes('cc0') || lowerLic.includes('public domain') || lowerLic.includes('mit license')) {
      license = 'CC0 / MIT';
    } else if (lowerLic.includes('cc-by')) {
      license = 'CC-BY';
    }
    if (manifest?.provenance) {
      if (typeof manifest.provenance.commercial_safe === 'boolean') {
        commercialSafe = manifest.provenance.commercial_safe;
      }
      if (manifest.provenance.dataset_license) license = String(manifest.provenance.dataset_license);
    }

    const rawSr = Number(onnxJson?.audio?.sample_rate) || 22050;
    const sampleRate = rawSr === 22500 ? 22050 : rawSr;
    const numSpeakers = Math.max(1, Number.parseInt(onnxJson?.num_speakers ?? 1, 10) || 1);
    const speakerIdMap = (onnxJson?.speaker_id_map && typeof onnxJson.speaker_id_map === 'object')
      ? onnxJson.speaker_id_map
      : {};
    const langCode = String(onnxJson?.language?.code || manifest?.language || (modelId.split('-')[0] || 'de_DE'));
    const onnxManifest = manifest?.files?.[onnxName] || manifest?.files?.onnx || null;

    voices.push({
      id: modelId,
      displayName: String(manifest?.display_name || modelId),
      lang: langCode,
      espeakVoice: String(onnxJson?.espeak?.voice || langCode.split(/[-_]/)[0] || 'de'),
      gender: String(manifest?.gender || ''),
      quality: String(onnxJson?.audio?.quality || ''),
      sampleRate,
      numSpeakers,
      lengthScale: Number(onnxJson?.inference?.length_scale) || 1.0,
      sizeBytes: onnxStat.size,
      sizeMb: Math.round((onnxStat.size / (1024 * 1024)) * 10) / 10,
      license,
      commercialSafe,
      bundled: Boolean(manifest?.bundled_in_apk_default),
      sha256: String(onnxManifest?.sha256 || ''),
      speakerIdMap,
      _onnxPath: onnxPath,
      _jsonPath: jsonPath,
    });
  }

  voices.sort((a, b) => {
    if (a.commercialSafe !== b.commercialSafe) return a.commercialSafe ? -1 : 1;
    const pa = PIPER_PRIORITY_ORDER.get(a.id) ?? 100;
    const pb = PIPER_PRIORITY_ORDER.get(b.id) ?? 100;
    if (pa !== pb) return pa - pb;
    return a.id.localeCompare(b.id);
  });
  return voices;
}

function selectStandalonePiperVoice(voices, rawVoice, rawLang) {
  const clean = String(rawVoice || '').replace(/^piper:/, '').replace(/^:/, '').trim();
  const [modelPart, speakerPart] = clean.includes(':') ? clean.split(':', 2) : [clean, ''];
  if (modelPart && modelPart.toLowerCase() !== 'default') {
    const exact = voices.find((v) => v.id === modelPart);
    if (!exact) {
      throw new Error(`Голосовая модель Piper не найдена: ${modelPart}`);
    }
    return { chosen: exact, speakerPart: speakerPart.trim() };
  }
  const baseLang = String(rawLang || 'de').trim().toLowerCase().replace('-', '_').split('_')[0] || 'de';
  const langPrefix = baseLang === 'no' ? 'nb' : baseLang;
  const voiceBaseLang = (v) => String(v?.lang || '').toLowerCase().replace('-', '_').split('_')[0];
  const chosen = voices.find((v) => v.commercialSafe && voiceBaseLang(v) === langPrefix)
    || voices.find((v) => voiceBaseLang(v) === langPrefix);
  if (!chosen) {
    throw new Error(`Для языка '${langPrefix}' не установлена локальная голосовая модель Piper`);
  }
  return { chosen, speakerPart: '' };
}

function resolveStandalonePiperSpeakerId(chosen, speakerPart, explicitSpeakerId) {
  const total = Math.max(1, chosen.numSpeakers || 1);
  if (Number.isInteger(explicitSpeakerId)) {
    if (explicitSpeakerId < 0 || (total === 1 && explicitSpeakerId !== 0) || (total > 1 && explicitSpeakerId >= total)) {
      throw new Error(`Недопустимый speakerId: ${explicitSpeakerId}`);
    }
    return explicitSpeakerId;
  }
  if (!speakerPart) return 0;
  if (total <= 1) {
    throw new Error(`Модель ${chosen.id} не поддерживает несколько дикторов`);
  }
  if (/^\d+$/.test(speakerPart)) {
    const parsed = Number.parseInt(speakerPart, 10);
    if (parsed < 0 || parsed >= total) throw new Error(`Индекс диктора вне диапазона: ${parsed}`);
    return parsed;
  }
  if (Object.prototype.hasOwnProperty.call(chosen.speakerIdMap, speakerPart)) {
    return Number(chosen.speakerIdMap[speakerPart]) || 0;
  }
  throw new Error(`Неизвестный диктор '${speakerPart}' для модели ${chosen.id}`);
}

function attachStandaloneLocalPiperMiddleware(server, allowedOrigins) {
  server.middlewares.use('/__standalone_local_piper', (req, res) => {
    let responded = false;
    const sendJson = (status, payload) => {
      if (responded) return;
      responded = true;
      if (!req.complete) {
        res.setHeader('Connection', 'close');
        req.resume();
      }
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(payload));
    };

    const remote = req.socket?.remoteAddress || '';
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) {
      return sendJson(403, { ok: false, error: 'Loopback requests only' });
    }
    if (req.headers['x-forwarded-for'] || req.headers.forwarded || req.headers['x-forwarded-host']) {
      return sendJson(403, { ok: false, error: 'Proxied requests are forbidden' });
    }
    if (Array.isArray(req.headers.origin) || Array.isArray(req.headers.host)) {
      return sendJson(403, { ok: false, error: 'Invalid duplicate security headers' });
    }

    const subPath = String(req.url || '/').split('?')[0];
    const origin = req.headers.origin;
    const fetchSite = req.headers['sec-fetch-site'];
    if (!isTrustedStandaloneHost(req)) {
      return sendJson(403, { ok: false, error: 'Untrusted host header' });
    }
    if (typeof origin === 'string' && !isTrustedStandaloneOrigin(origin, req, allowedOrigins)) {
      return sendJson(403, { ok: false, error: 'Untrusted origin' });
    }
    if (typeof fetchSite === 'string' && fetchSite !== 'same-origin' && fetchSite !== 'none') {
      return sendJson(403, { ok: false, error: 'Cross-site requests forbidden' });
    }

    if (subPath === '/voices' && req.method === 'GET') {
      const piperRoot = resolveStandalonePiperRoot();
      const piperRunner = resolveStandalonePiperRunner(piperRoot);
      const voices = discoverStandalonePiperVoices(piperRoot).map((item) => {
        const pub = { ...item };
        delete pub._onnxPath;
        delete pub._jsonPath;
        delete pub.lengthScale;
        return pub;
      });
      return sendJson(200, {
        ok: true,
        available: Boolean(piperRunner && voices.length > 0),
        runnerAvailable: Boolean(piperRunner),
        loadedModelId: '',
        modelsDir: '',
        canRestoreBundled: false,
        voices,
      });
    }

    if (subPath === '/synthesize' && req.method === 'POST') {
      if (!isTrustedStandaloneOrigin(origin, req, allowedOrigins)) {
        return sendJson(403, { ok: false, error: 'Origin header required' });
      }
      if (activeStandalonePiperJobs >= MAX_STANDALONE_PIPER_JOBS) {
        return sendJson(429, { ok: false, error: 'Локальный движок Piper занят предыдущим запросом' });
      }

      const chunks = [];
      let totalBytes = 0;
      const MAX_BODY = 64 * 1024;
      let activeChild = null;
      let clientClosed = false;
      let killRequested = false;

      const onClientDisconnect = () => {
        if (!responded && !res.writableEnded) {
          clientClosed = true;
          if (activeChild && !killRequested) {
            killRequested = true;
            killStandalonePiperTree(activeChild);
          }
        }
      };
      req.on('aborted', onClientDisconnect);
      res.on('close', onClientDisconnect);

      req.on('data', (chunk) => {
        if (responded) return;
        totalBytes += chunk.length;
        if (totalBytes > MAX_BODY) {
          sendJson(413, { ok: false, error: 'Request body too large' });
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('error', () => sendJson(400, { ok: false, error: 'Stream read error' }));
      req.on('end', () => {
        if (responded || clientClosed) return;
        let payload;
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          return sendJson(400, { ok: false, error: 'Invalid JSON payload' });
        }

        const text = String(payload?.text || '').replace(/[\r\n]+/g, ' ').trim();
        if (!text || text.length > 2500) {
          return sendJson(400, { ok: false, error: 'Некорректная длина текста для синтеза Piper' });
        }
        const piperRoot = resolveStandalonePiperRoot();
        const piperRunner = resolveStandalonePiperRunner(piperRoot);
        if (!piperRunner) {
          return sendJson(503, { ok: false, error: 'Исполняемый файл Piper CLI не найден в локальном каталоге' });
        }
        const voices = discoverStandalonePiperVoices(piperRoot);
        if (voices.length === 0) {
          return sendJson(404, { ok: false, error: 'Локальные голосовые модели Piper не найдены' });
        }

        let chosen;
        let speakerId = 0;
        try {
          const sel = selectStandalonePiperVoice(voices, payload?.voice, payload?.lang);
          chosen = sel.chosen;
          speakerId = resolveStandalonePiperSpeakerId(chosen, sel.speakerPart, payload?.speakerId);
        } catch (err) {
          return sendJson(422, { ok: false, error: err?.message || 'Ошибка выбора модели Piper' });
        }

        if (activeStandalonePiperJobs >= MAX_STANDALONE_PIPER_JOBS) {
          return sendJson(429, { ok: false, error: 'Локальный движок Piper занят предыдущим запросом' });
        }

        const rawRate = Number(payload?.rate);
        const rateFloat = Number.isFinite(rawRate) ? Math.max(0.5, Math.min(2.0, rawRate)) : 1.0;
        const lengthScale = Math.max(0.25, Math.min(4.0, (chosen.lengthScale || 1.0) / rateFloat)).toFixed(4);

        let tmpDir;
        try {
          tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lerne-piper-'));
        } catch (mkErr) {
          return sendJson(500, { ok: false, error: `Ошибка создания временного каталога: ${mkErr.message}` });
        }
        const tmpWav = path.join(tmpDir, 'out.wav');
        const args = [
          ...piperRunner.baseArgs,
          '--model', chosen._onnxPath,
          '--config', chosen._jsonPath,
          '--output_file', tmpWav,
          '--length_scale', lengthScale,
        ];
        if (chosen.numSpeakers > 1) {
          args.push('--speaker', String(speakerId));
        }

        const allowedEnvKeys = new Set([
          'SYSTEMDRIVE', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'COMSPEC', 'PATHEXT',
          'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'HOMEDRIVE', 'HOMEPATH', 'HOME',
          'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS',
          'LANG', 'LC_ALL', 'LD_LIBRARY_PATH',
        ]);
        const childEnv = {};
        for (const [k, v] of Object.entries(process.env)) {
          if (v !== undefined && allowedEnvKeys.has(k.toUpperCase())) {
            childEnv[k] = v;
          }
        }
        childEnv.PATH = process.env.PATH
          ? `${path.dirname(piperRunner.cmd)}${path.delimiter}${process.env.PATH}`
          : path.dirname(piperRunner.cmd);
        childEnv.PYTHONUTF8 = '1';
        childEnv.PYTHONIOENCODING = 'utf-8';
        childEnv.PYTHONNOUSERSITE = '1';
        childEnv.PYTHONDONTWRITEBYTECODE = '1';

        activeStandalonePiperJobs += 1;
        let stderrBuf = '';
        let finished = false;
        let timedOut = false;
        let fallbackReleaseTimer = null;

        const cleanupTmp = () => {
          try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
          } catch { /* ignore */ }
        };

        let timer = null;
        const finalizeJob = () => {
          if (finished) return false;
          finished = true;
          if (timer) clearTimeout(timer);
          if (fallbackReleaseTimer) clearTimeout(fallbackReleaseTimer);
          activeStandalonePiperJobs = Math.max(0, activeStandalonePiperJobs - 1);
          return true;
        };

        let child;
        try {
          child = spawn(piperRunner.cmd, args, {
            env: childEnv,
            stdio: ['pipe', 'ignore', 'pipe'],
            windowsHide: true,
          });
        } catch (spawnErr) {
          finalizeJob();
          cleanupTmp();
          return sendJson(500, { ok: false, error: `Ошибка запуска Piper CLI: ${spawnErr.message}` });
        }
        activeChild = child;
        child.stdin?.on('error', () => {});

        const scheduleForceRelease = () => {
          if (fallbackReleaseTimer || finished) return;
          fallbackReleaseTimer = setTimeout(() => {
            if (!finalizeJob()) return;
            try { child.stdin?.destroy(); } catch { /* ignore */ }
            try { child.stderr?.destroy(); } catch { /* ignore */ }
            cleanupTmp();
            if (!clientClosed) {
              sendJson(504, { ok: false, error: 'Превышено время ожидания синтеза Piper (45 с)' });
            }
          }, 2000);
        };

        timer = setTimeout(() => {
          if (!finished) {
            timedOut = true;
            if (!killRequested) {
              killRequested = true;
              killStandalonePiperTree(child);
            }
            scheduleForceRelease();
          }
        }, 45000);

        if (clientClosed && !killRequested) {
          killRequested = true;
          killStandalonePiperTree(child);
          scheduleForceRelease();
        }

        child.stderr.on('data', (d) => {
          if (stderrBuf.length < 4096) stderrBuf += d.toString('utf8');
        });
        child.on('error', (err) => {
          if (!finalizeJob()) return;
          cleanupTmp();
          sendJson(500, { ok: false, error: `Ошибка запуска Piper CLI: ${err.message}` });
        });
        child.on('close', (code) => {
          if (!finalizeJob()) return;
          try {
            if (clientClosed) {
              return;
            }
            if (timedOut) {
              return sendJson(504, { ok: false, error: 'Превышено время ожидания синтеза Piper (45 с)' });
            }
            if (code !== 0) {
              const detail = stderrBuf.trim().slice(0, 240) || `код ${code}`;
              return sendJson(500, { ok: false, error: `Piper CLI завершился с ошибкой (${detail})` });
            }
            let wavStat;
            try {
              wavStat = fs.statSync(tmpWav);
            } catch {
              return sendJson(500, { ok: false, error: 'Piper CLI не создал выходной WAV-файл' });
            }
            if (!wavStat.isFile() || wavStat.size < 128 || wavStat.size > 20 * 1024 * 1024) {
              return sendJson(500, { ok: false, error: 'Piper CLI создал некорректный WAV-файл' });
            }
            const wavBuf = fs.readFileSync(tmpWav);
            if (
              wavBuf.toString('ascii', 0, 4) !== 'RIFF'
              || wavBuf.toString('ascii', 8, 12) !== 'WAVE'
            ) {
              return sendJson(500, { ok: false, error: 'Piper CLI создал некорректный WAV-файл' });
            }
            return sendJson(200, {
              ok: true,
              audioBase64: wavBuf.toString('base64'),
              mimeType: 'audio/wav',
              ext: '.wav',
              sampleRate: chosen.sampleRate,
              modelId: chosen.id,
            });
          } catch (err) {
            return sendJson(500, { ok: false, error: err?.message || 'Ошибка чтения WAV-файла Piper' });
          } finally {
            cleanupTmp();
          }
        });

        if (!finished && !clientClosed && !timedOut) {
          try {
            child.stdin.write(`${text}\n`, 'utf8');
            child.stdin.end();
          } catch { /* ignore broken pipe */ }
        }
      });
      return;
    }

    return sendJson(405, { ok: false, error: 'Unsupported Piper endpoint or method' });
  });
}

const standalonePlugin = {
  name: 'lerne-standalone-offline',
  configureServer(server) {
    attachStandaloneExtHttpsMiddleware(server, standaloneAllowedOrigins);
    attachStandaloneLocalPiperMiddleware(server, standaloneAllowedOrigins);
  },
  configurePreviewServer(server) {
    attachStandaloneExtHttpsMiddleware(server, standaloneAllowedOrigins);
    attachStandaloneLocalPiperMiddleware(server, standaloneAllowedOrigins);
  },
  transformIndexHtml: html => html.replace(/<link[^>]+https:\/\/fonts\.[^>]+>/g, '')
    .replace(/<script src="https:\/\/telegram\.org[^>]+><\/script>/g, '')
    .replace('</head>', '    <meta name="lerne-android-mode" content="offline-pilot" />\n  </head>'),
  transform(code, id) {
    if (id.endsWith('.css')) return code.replace(/@import url\(['"]https?:[^;]+;/g, '');
  },
};

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  if (local && command !== 'serve') throw new Error('LOCAL is dev-server only; no deployable build');
  return {
  // The regression server must not load developer credentials or proxy to a
  // configured backend. Missing API mocks fail against a closed local port.
  envDir: local || standalone || process.env.LERNE_ISOLATED_CHECKS === '1' ? false : undefined,
  define: { 'import.meta.env.VITE_LERNE_LOCAL': JSON.stringify(local ? '1' : '0'),
    'import.meta.env.VITE_LERNE_STANDALONE': JSON.stringify(standalone ? '1' : '0'),
    'import.meta.env.VITE_LERNE_V2_PREVIEW': JSON.stringify(preview ? '1' : '0') },
  html: { cspNonce: localNonce },
  plugins: [react(), ...(local ? [localPlugin] : []), ...(standalone ? [standalonePlugin] : [])],
  server: {
    cors: (local || standalone) ? false : undefined,
    hmr: process.env.LERNE_ISOLATED_CHECKS === '1' ? false : undefined,
    host: (local || standalone) ? '127.0.0.1' : true,
    port: local ? localPort : standalone ? standalonePort : 5173,
    strictPort: local || standalone,
    allowedHosts: (local || standalone) ? ['localhost', '127.0.0.1'] : true,
    headers: local ? {
      'Content-Security-Policy': `default-src 'self' blob: data:; script-src 'self' 'nonce-${localNonce}'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:${localPort} ws://localhost:${localPort}; object-src 'none'; frame-src 'none'; form-action 'self'; base-uri 'self'`,
    } : {},
    proxy: standalone ? {} : {
      '/api': {
        target: local ? `http://127.0.0.1:${localApiPort}` : process.env.LERNE_ISOLATED_CHECKS === '1'
          ? 'http://127.0.0.1:1'
          : process.env.VITE_DEV_API_TARGET || 'http://127.0.0.1:8001',
        changeOrigin: true,
        configure(proxy) {
          if (!local) return;
          proxy.on('proxyReq', (proxyReq, req) => {
            proxyReq.removeHeader('x-lerne-local-secret');
            const loginPaths = preview ? ['/api/auth/local/preview-users', '/api/auth/local/preview-login', '/api/auth/local/preview-admin'] : ['/api/auth/local/login'];
            if (loginPaths.includes(req.url?.split('?')[0])
                && [`http://127.0.0.1:${localPort}`, `http://localhost:${localPort}`].includes(req.headers.origin)) {
              const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
              if (config.login_secret) proxyReq.setHeader('x-lerne-local-secret', config.login_secret);
            }
          });
        },
      }
    }
  },
  ...(standalone ? {
    preview: {
      cors: false,
      host: '127.0.0.1',
      port: standalonePort,
      strictPort: true,
      allowedHosts: ['localhost', '127.0.0.1'],
    },
  } : {}),
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom')) {
              return 'vendor-react';
            }
            if (id.includes('framer-motion')) {
              return 'vendor-motion';
            }
            if (id.includes('lucide-react')) {
              return 'vendor-icons';
            }
            if (id.includes('dexie')) {
              return 'vendor-db';
            }
            return 'vendor-common';
          }
        }
      }
    }
  }
  };
})
