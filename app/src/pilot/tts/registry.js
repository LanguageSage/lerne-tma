import { VOICES_BY_LANG, DEFAULT_TTS_VOICES } from '../../constants/languageConstants.js';
import { readStandaloneGeminiTtsModel, readStandaloneTtsProvider } from '../standaloneSettings.js';
import { androidSystemTtsProvider } from './androidSystemTtsProvider.js';
import { azureTtsProvider } from './azureTtsProvider.js';
import { GEMINI_TTS_MODELS, GEMINI_TTS_VOICES, geminiTtsProvider } from './geminiTtsProvider.js';

export { GEMINI_TTS_MODELS, GEMINI_TTS_VOICES };

const PROVIDERS = {
  gemini: geminiTtsProvider,
  android_system: androidSystemTtsProvider,
  azure: azureTtsProvider,
};

export function listStandaloneTtsProviders() {
  const providers = [geminiTtsProvider];
  if (androidSystemTtsProvider.isSupported()) {
    providers.push(androidSystemTtsProvider);
  }
  providers.push(azureTtsProvider);
  return providers;
}

export function getStandaloneTtsProvider(providerId = null) {
  const chosen = String(providerId || readStandaloneTtsProvider()).trim().toLowerCase();
  const provider = PROVIDERS[chosen];
  if (!provider) {
    throw new Error(`Неизвестный TTS-провайдер: ${chosen}`);
  }
  return provider;
}

export function parseStandaloneVoiceSpec(rawVoice, fallbackProvider = null) {
  const defaultProvider = fallbackProvider || readStandaloneTtsProvider();
  const raw = String(rawVoice || '').trim();
  if (!raw) {
    return { providerId: defaultProvider, voice: '', model: null, engine: null };
  }
  if (raw.startsWith('gemini:')) {
    const rest = raw.slice('gemini:'.length);
    if (rest.includes(':')) {
      const [model, voice] = rest.split(':', 2);
      return { providerId: 'gemini', voice: voice.trim(), model: model.trim() || null, engine: null };
    }
    return { providerId: 'gemini', voice: rest.trim(), model: null, engine: null };
  }
  if (raw.startsWith('android_system:')) {
    const rest = raw.slice('android_system:'.length);
    if (rest.includes(':')) {
      const [engine, voice] = rest.split(':', 2);
      return { providerId: 'android_system', voice: voice.trim(), model: null, engine: engine.trim() || null };
    }
    return { providerId: 'android_system', voice: rest.trim(), model: null, engine: null };
  }
  if (raw.startsWith('azure:')) {
    return { providerId: 'azure', voice: raw.slice('azure:'.length).trim(), model: null, engine: null };
  }
  // Unprefixed Edge-style voice ID (e.g. from legacy setting) routes to currently active Standalone provider.
  if (defaultProvider === 'azure') {
    return { providerId: 'azure', voice: raw, model: null, engine: null };
  }
  if (defaultProvider === 'android_system') {
    return { providerId: 'android_system', voice: '', model: null, engine: null };
  }
  return { providerId: 'gemini', voice: 'Kore', model: readStandaloneGeminiTtsModel(), engine: null };
}

export function getVoicesForStandaloneProvider(providerId, lang = 'de', androidVoices = []) {
  const code = String(lang || 'de').toLowerCase().replace('_', '-').split('-')[0] || 'de';
  if (providerId === 'gemini') {
    return GEMINI_TTS_VOICES;
  }
  if (providerId === 'azure') {
    const base = VOICES_BY_LANG[code] || VOICES_BY_LANG.de || [];
    return base.map((v) => ({
      ...v,
      value: `azure:${v.value}`,
    }));
  }
  if (providerId === 'android_system') {
    const langPrefix = code === 'no' ? 'nb' : code;
    const filtered = (androidVoices || []).filter((v) => String(v.locale || '').toLowerCase().startsWith(langPrefix));
    const list = filtered.length ? filtered : (androidVoices || []);
    return [
      { value: 'android_system::default', label: 'По умолчанию (язык карточки)' },
      ...list.map((v) => ({
        value: `android_system:${v.name}`,
        label: `${v.name} (${v.locale || code}${v.networkRequired ? ', онлайн' : ', офлайн'})`,
      })),
    ];
  }
  return GEMINI_TTS_VOICES;
}

export function getDefaultStandaloneVoice(providerId, lang = 'de') {
  const code = String(lang || 'de').toLowerCase().replace('_', '-').split('-')[0] || 'de';
  if (providerId === 'azure') {
    const def = DEFAULT_TTS_VOICES[code] || DEFAULT_TTS_VOICES.de;
    return `azure:${def}`;
  }
  if (providerId === 'android_system') {
    return 'android_system::default';
  }
  return 'gemini:Kore';
}
