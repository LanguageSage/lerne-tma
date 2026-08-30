export const SUPPORTED_NATIVE_LANGUAGES = [
  { code: 'uk', name: 'Українська', flag: '🇺🇦', defaultVoice: 'uk-UA-PolinaNeural' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺', defaultVoice: 'ru-RU-SvetlanaNeural' },
  { code: 'en', name: 'English', flag: '🇬🇧', defaultVoice: 'en-US-JennyNeural' },
  { code: 'no', name: 'Norsk', flag: '🇳🇴', defaultVoice: 'nb-NO-FinnNeural' }
];

export const SUPPORTED_TARGET_LANGUAGES = [
  { code: 'de', name: 'Немецкий', flag: '🇩🇪', defaultVoice: 'de-DE-KatjaNeural', speechLocale: 'de-DE' },
  { code: 'en', name: 'Английский', flag: '🇬🇧', defaultVoice: 'en-US-JennyNeural', speechLocale: 'en-US' },
  { code: 'no', name: 'Норвежский', flag: '🇳🇴', defaultVoice: 'nb-NO-FinnNeural', speechLocale: 'nb-NO' },
  { code: 'uk', name: 'Украинский', flag: '🇺🇦', defaultVoice: 'uk-UA-PolinaNeural', speechLocale: 'uk-UA' }
];

export const DEFAULT_TTS_VOICES = {
  de: 'de-DE-KatjaNeural',
  en: 'en-US-JennyNeural',
  no: 'nb-NO-FinnNeural',
  uk: 'uk-UA-PolinaNeural',
  ru: 'ru-RU-SvetlanaNeural',
};

export const getTtsVoiceForLang = (lang, adminSettings) => {
  const code = (lang || 'de').toLowerCase().trim();
  if (code === 'de') return adminSettings?.TTS_VOICE || DEFAULT_TTS_VOICES.de;
  if (code === 'ru') return adminSettings?.TTS_VOICE_RU || DEFAULT_TTS_VOICES.ru;
  if (code === 'no') return adminSettings?.TTS_VOICE_NO || DEFAULT_TTS_VOICES.no;
  if (code === 'en') return adminSettings?.TTS_VOICE_EN || DEFAULT_TTS_VOICES.en;
  if (code === 'uk') return adminSettings?.TTS_VOICE_UK || DEFAULT_TTS_VOICES.uk;
  return adminSettings?.[`TTS_VOICE_${code.toUpperCase()}`] || DEFAULT_TTS_VOICES[code] || DEFAULT_TTS_VOICES.de;
};

export const getSpeechLocaleForLang = (lang) => {
  const code = (lang || 'de').toLowerCase().trim();
  switch (code) {
    case 'no': return 'nb-NO';
    case 'en': return 'en-US';
    case 'uk': return 'uk-UA';
    case 'ru': return 'ru-RU';
    case 'de':
    default: return 'de-DE';
  }
};

/**
 * Structured list of available Edge-TTS voices per language code.
 * Each entry: { value: 'de-DE-KatjaNeural', label: 'Катя', gender: 'f' | 'm' }
 *
 * This is the single source of truth for voice pickers across the app —
 * both in global Settings (VoiceTab) and in the per-card voice switcher.
 */
export const VOICES_BY_LANG = {
  de: [
    { value: 'de-DE-KatjaNeural',   label: 'Катя',    gender: 'f' },
    { value: 'de-DE-AmalaNeural',   label: 'Амала',   gender: 'f' },
    { value: 'de-DE-KillianNeural', label: 'Киллиан', gender: 'm' },
    { value: 'de-DE-ConradNeural',  label: 'Конрад',  gender: 'm' },
    { value: 'de-AT-IngridNeural',  label: 'Ингрид',  gender: 'f' },
    { value: 'de-CH-JanNeural',     label: 'Ян',      gender: 'm' },
  ],
  en: [
    { value: 'en-US-JennyNeural',   label: 'Дженни',  gender: 'f' },
    { value: 'en-US-AriaNeural',    label: 'Ария',    gender: 'f' },
    { value: 'en-US-GuyNeural',     label: 'Гай',     gender: 'm' },
    { value: 'en-GB-SoniaNeural',   label: 'Соня',    gender: 'f' },
    { value: 'en-GB-RyanNeural',    label: 'Райан',   gender: 'm' },
  ],
  no: [
    { value: 'nb-NO-IselinNeural',  label: 'Иселин',  gender: 'f' },
    { value: 'nb-NO-FinnNeural',    label: 'Финн',    gender: 'm' },
  ],
  uk: [
    { value: 'uk-UA-PolinaNeural',  label: 'Поліна',  gender: 'f' },
    { value: 'uk-UA-OstapNeural',   label: 'Остап',   gender: 'm' },
  ],
  ru: [
    { value: 'ru-RU-SvetlanaNeural', label: 'Светлана', gender: 'f' },
    { value: 'ru-RU-DmitryNeural',   label: 'Дмитрий',  gender: 'm' },
  ],
};


