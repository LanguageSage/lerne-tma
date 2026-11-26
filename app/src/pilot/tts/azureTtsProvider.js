import { secureHttpsRequest } from '../secretVault.js';
import { readStandaloneAzureRegion } from '../standaloneSettings.js';
import { normalizeRateString } from './wavUtil.js';

const AZURE_REGION_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const VOICE_TOKEN_RE = /^[A-Za-z0-9_.:-]{1,120}$/;

function escapeXml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export const azureTtsProvider = {
  id: 'azure',
  slot: 'azure_tts',
  label: 'Azure Speech REST (F0 / Paid, MP3)',
  offline: false,
  supportsRate: true,

  buildSsml(text, voice = 'de-DE-KatjaNeural', rate = '+0%', lang = 'de') {
    const cleanVoice = String(voice || 'de-DE-KatjaNeural').replace(/^azure:/, '').trim() || 'de-DE-KatjaNeural';
    if (!VOICE_TOKEN_RE.test(cleanVoice)) {
      throw new Error('Некорректный идентификатор голоса Azure Speech');
    }
    const normRate = normalizeRateString(rate);
    const parts = cleanVoice.split('-');
    const xmlLang = parts.length >= 2 ? `${parts[0]}-${parts[1]}` : `${lang || 'de'}-${String(lang || 'DE').toUpperCase()}`;
    return (
      `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${escapeXml(xmlLang)}">` +
      `<voice name="${escapeXml(cleanVoice)}">` +
      `<prosody rate="${normRate}">${escapeXml(text)}</prosody>` +
      `</voice></speak>`
    );
  },

  async synthesize({ text, voice = 'de-DE-KatjaNeural', rate = '+0%', lang = 'de', region = null, signal = undefined }) {
    const cleanRegion = String(region || readStandaloneAzureRegion()).trim().toLowerCase();
    if (!AZURE_REGION_RE.test(cleanRegion)) {
      throw new Error('Укажите корректный регион Azure Speech в настройках озвучки (например westeurope)');
    }
    const cleanVoice = String(voice || 'de-DE-KatjaNeural').replace(/^azure:/, '').trim() || 'de-DE-KatjaNeural';
    const ssml = this.buildSsml(text, cleanVoice, rate, lang);
    const url = `https://${cleanRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;

    const res = await secureHttpsRequest({
      slot: this.slot,
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-Output-Format': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'LerneOfflinePilot/1.0',
      },
      body: ssml,
      responseType: 'base64',
      timeoutMs: 35000,
      signal,
    });

    if (!res.ok) {
      throw new Error(`Azure Speech HTTP ${res.status}: ${String(res.bodyText || '').slice(0, 220)}`);
    }
    if (!(res.bodyBytes instanceof Uint8Array) || res.bodyBytes.length < 128) {
      throw new Error('Azure Speech вернул пустой или повреждённый MP3-поток');
    }
    return {
      bytes: res.bodyBytes,
      mime: 'audio/mpeg',
      ext: '.mp3',
      provider: this.id,
      voice: cleanVoice,
    };
  },
};
