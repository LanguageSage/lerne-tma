import { tr } from '../i18n/locale';
export const SUPPORTED_NATIVE_LANGUAGES = [
  { code: 'uk', name: 'Українська', flag: '🇺🇦', defaultVoice: 'uk-UA-PolinaNeural' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺', defaultVoice: 'ru-RU-SvetlanaNeural' },
  { code: 'en', name: 'English', flag: '🇬🇧', defaultVoice: 'en-US-JennyNeural' }
];

export const SUPPORTED_TARGET_LANGUAGES = [
  { code: 'de', get name() { return tr("Немецкий"); }, flag: '🇩🇪', defaultVoice: 'de-DE-KatjaNeural', speechLocale: 'de-DE' },
  { code: 'en', get name() { return tr("Английский"); }, flag: '🇬🇧', defaultVoice: 'en-US-JennyNeural', speechLocale: 'en-US' },
  { code: 'no', get name() { return tr("Норвежский"); }, flag: '🇳🇴', defaultVoice: 'nb-NO-FinnNeural', speechLocale: 'nb-NO' },
  { code: 'uk', get name() { return tr("Украинский"); }, flag: '🇺🇦', defaultVoice: 'uk-UA-PolinaNeural', speechLocale: 'uk-UA' }
];

export const DEFAULT_TTS_VOICES = {
  de: 'de-DE-KatjaNeural',
  en: 'en-US-JennyNeural',
  no: 'nb-NO-FinnNeural',
  uk: 'uk-UA-PolinaNeural',
  ru: 'ru-RU-SvetlanaNeural',
};

export const getTtsVoiceForLang = (lang, adminSettings) => {
  const rawCode = (lang || 'de').toLowerCase().trim().replace('_', '-');
  const code = rawCode.split('-')[0] || 'de';
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
    { value: 'de-DE-KatjaNeural',                  get label() { return tr("🇩🇪 Катя"); },      gender: 'f', get region() { return tr("Германия"); } },
    { value: 'de-DE-AmalaNeural',                  get label() { return tr("🇩🇪 Амала"); },     gender: 'f', get region() { return tr("Германия"); } },
    { value: 'de-DE-SeraphinaMultilingualNeural', get label() { return tr("🇩🇪 Серафина"); },  gender: 'f', get region() { return tr("Германия"); } },
    { value: 'de-DE-KillianNeural',                get label() { return tr("🇩🇪 Киллиан"); },   gender: 'm', get region() { return tr("Германия"); } },
    { value: 'de-DE-ConradNeural',                 get label() { return tr("🇩🇪 Конрад"); },    gender: 'm', get region() { return tr("Германия"); } },
    { value: 'de-DE-FlorianMultilingualNeural',   get label() { return tr("🇩🇪 Флориан"); },   gender: 'm', get region() { return tr("Германия"); } },
    { value: 'de-AT-IngridNeural',                 get label() { return tr("🇦🇹 Ингрид"); },    gender: 'f', get region() { return tr("Австрия"); } },
    { value: 'de-AT-JonasNeural',                  get label() { return tr("🇦🇹 Йонас"); },     gender: 'm', get region() { return tr("Австрия"); } },
    { value: 'de-CH-JanNeural',                    get label() { return tr("🇨🇭 Ян"); },        gender: 'm', get region() { return tr("Швейцария"); } },
    { value: 'de-CH-LeniNeural',                   get label() { return tr("🇨🇭 Лени"); },      gender: 'f', get region() { return tr("Швейцария"); } },
  ],
  en: [
    { value: 'en-US-JennyNeural',   get label() { return tr("🇺🇸 Дженни"); },  gender: 'f', get region() { return tr("США"); } },
    { value: 'en-US-AriaNeural',    get label() { return tr("🇺🇸 Ария"); },    gender: 'f', get region() { return tr("США"); } },
    { value: 'en-US-AvaNeural',     get label() { return tr("🇺🇸 Ава"); },     gender: 'f', get region() { return tr("США"); } },
    { value: 'en-US-EmmaNeural',    get label() { return tr("🇺🇸 Эмма"); },    gender: 'f', get region() { return tr("США"); } },
    { value: 'en-US-GuyNeural',     get label() { return tr("🇺🇸 Гай"); },     gender: 'm', get region() { return tr("США"); } },
    { value: 'en-US-BrianNeural',   get label() { return tr("🇺🇸 Брайан"); },  gender: 'm', get region() { return tr("США"); } },
    { value: 'en-US-AndrewNeural',  get label() { return tr("🇺🇸 Эндрю"); },   gender: 'm', get region() { return tr("США"); } },
    { value: 'en-GB-SoniaNeural',   get label() { return tr("🇬🇧 Соня"); },    gender: 'f', get region() { return tr("Великобритания"); } },
    { value: 'en-GB-MaisieNeural',  get label() { return tr("🇬🇧 Мэйзи"); },   gender: 'f', get region() { return tr("Великобритания"); } },
    { value: 'en-GB-RyanNeural',    get label() { return tr("🇬🇧 Райан"); },   gender: 'm', get region() { return tr("Великобритания"); } },
    { value: 'en-GB-ThomasNeural',  get label() { return tr("🇬🇧 Томас"); },   gender: 'm', get region() { return tr("Великобритания"); } },
  ],
  no: [
    { value: 'nb-NO-FinnNeural',     get label() { return tr("🇳🇴 Финн"); },     gender: 'm', get region() { return tr("Норвегия"); } },
    { value: 'nb-NO-PernilleNeural', get label() { return tr("🇳🇴 Пернилле"); }, gender: 'f', get region() { return tr("Норвегия"); } },
    { value: 'nb-NO-IselinNeural',   get label() { return tr("🇳🇴 Иселин"); },   gender: 'f', get region() { return tr("Норвегия"); } },
  ],
  uk: [
    { value: 'uk-UA-PolinaNeural',  get label() { return tr("🇺🇦 Поліна"); },  gender: 'f', get region() { return tr("Україна"); } },
    { value: 'uk-UA-OstapNeural',   get label() { return tr("🇺🇦 Остап"); },   gender: 'm', get region() { return tr("Україна"); } },
  ],
  ru: [
    { value: 'ru-RU-SvetlanaNeural', get label() { return tr("🇷🇺 Светлана"); }, gender: 'f', get region() { return tr("Россия"); } },
    { value: 'ru-RU-DmitryNeural',   get label() { return tr("🇷🇺 Дмитрий"); },  gender: 'm', get region() { return tr("Россия"); } },
  ],
};


