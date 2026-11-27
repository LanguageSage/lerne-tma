import { storage } from '../utils/auth.js';
import { isNativePlatform, isNativePluginAvailable } from './nativeBridge.js';

export const STANDALONE_SETTINGS_KEYS = {
  aiProvider: 'lerne_standalone_ai_provider',
  aiModels: 'lerne_standalone_ai_models',
  ttsProvider: 'lerne_standalone_tts_provider',
  geminiTtsModel: 'lerne_standalone_gemini_tts_model',
  azureRegion: 'lerne_standalone_azure_region',
  androidTtsEngine: 'lerne_standalone_android_tts_engine',
  useLocalTtsWhenAudioMissing: 'lerne_use_local_tts_when_missing',
};

export const DEFAULT_STANDALONE_AI_MODELS = {
  gemini: 'gemini-2.5-flash',
  openrouter: 'google/gemini-2.5-flash',
  groq: 'llama-3.3-70b-versatile',
};

export const DEFAULT_STANDALONE_GEMINI_TTS_MODEL = 'gemini-2.5-flash-preview-tts';

export function readStandaloneAiProvider() {
  const val = String(storage.get(STANDALONE_SETTINGS_KEYS.aiProvider) || 'gemini').trim().toLowerCase();
  return ['gemini', 'openrouter', 'groq'].includes(val) ? val : 'gemini';
}

export function readStandaloneAiModels() {
  try {
    const raw = storage.get(STANDALONE_SETTINGS_KEYS.aiModels);
    const parsed = raw ? JSON.parse(raw) : {};
    return { ...DEFAULT_STANDALONE_AI_MODELS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch {
    return { ...DEFAULT_STANDALONE_AI_MODELS };
  }
}

export function readStandaloneTtsProvider() {
  const val = String(storage.get(STANDALONE_SETTINGS_KEYS.ttsProvider) || '').trim().toLowerCase();
  if (['piper', 'gemini', 'android_system', 'azure'].includes(val)) {
    if (val === 'android_system' && !isNativePluginAvailable('AndroidSystemTts')) return 'gemini';
    if (val === 'piper' && !isNativePluginAvailable('AndroidPiperTts')) return 'gemini';
    return val;
  }
  if (isNativePlatform() && isNativePluginAvailable('AndroidPiperTts')) {
    return 'piper';
  }
  if (isNativePlatform() && isNativePluginAvailable('AndroidSystemTts')) {
    return 'android_system';
  }
  return 'gemini';
}

export function readStandaloneGeminiTtsModel() {
  const val = String(storage.get(STANDALONE_SETTINGS_KEYS.geminiTtsModel) || '').trim();
  return ['gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts'].includes(val)
    ? val
    : DEFAULT_STANDALONE_GEMINI_TTS_MODEL;
}

export function readStandaloneAzureRegion() {
  return String(storage.get(STANDALONE_SETTINGS_KEYS.azureRegion) || '').trim().toLowerCase();
}

export function readStandaloneAndroidTtsEngine() {
  return String(storage.get(STANDALONE_SETTINGS_KEYS.androidTtsEngine) || '').trim();
}

export function readStandaloneTtsVoices() {
  try {
    const raw = storage.get('lerne_tts_voices');
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function readStandaloneTtsRate(side = 'front') {
  const key = side === 'back' ? 'lerne_tts_speed_ru' : 'lerne_tts_speed';
  const num = Number(storage.get(key) ?? 0);
  const clamped = Number.isFinite(num) ? Math.max(-50, Math.min(100, Math.round(num))) : 0;
  return `${clamped >= 0 ? '+' : ''}${clamped}%`;
}

export function readUseLocalTtsWhenAudioMissing() {
  return storage.get(STANDALONE_SETTINGS_KEYS.useLocalTtsWhenAudioMissing) !== 'false';
}
