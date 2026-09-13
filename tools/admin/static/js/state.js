/**
 * Global Admin State Variables
 */
let usersData = [];
let decksData = [];
let activeUserFilter = null;
let activeAssignDeckId = null;
let activeRegenDeckId = null;
let activeBatchTaskId = null;
let isBatchStudioMode = false;
let activeDeckTargetLang = 'de';
let regenInterval = null;
let batchRegenInterval = null;
let activeClassificationTaskId = null;
let classificationPollInterval = null;

let stagedDecks = {};
const STAGED_STORAGE_KEY = 'lerne_admin_staged_decks';
let selectedDeckIds = new Set();

// Active health filter for decks: 'all' | 'missing_audio' | 'missing_context' | 'empty' | 'default' | 'library'
let deckHealthFilter = 'all';

const ADMIN_VOICES_BY_LANG = {
  de: [
    { group: '🇩🇪 Германия', voices: [
      { value: 'de-DE-KatjaNeural', label: 'Катя (♀️ Женский — по умолчанию)', default: true },
      { value: 'de-DE-AmalaNeural', label: 'Амала (♀️ Женский)' },
      { value: 'de-DE-SeraphinaMultilingualNeural', label: 'Серафина (♀️ Женский)' },
      { value: 'de-DE-KillianNeural', label: 'Киллиан (♂️ Мужской)' },
      { value: 'de-DE-ConradNeural', label: 'Конрад (♂️ Мужской)' },
      { value: 'de-DE-FlorianMultilingualNeural', label: 'Флориан (♂️ Мужской)' },
    ]},
    { group: '🇦🇹 Австрия', voices: [
      { value: 'de-AT-IngridNeural', label: 'Ингрид (♀️ Женский)' },
      { value: 'de-AT-JonasNeural', label: 'Йонас (♂️ Мужской)' },
    ]},
    { group: '🇨🇭 Швейцария', voices: [
      { value: 'de-CH-JanNeural', label: 'Ян (♂️ Мужской)' },
      { value: 'de-CH-LeniNeural', label: 'Лени (♀️ Женский)' },
    ]}
  ],
  en: [
    { group: '🇺🇸 США', voices: [
      { value: 'en-US-JennyNeural', label: 'Дженни (♀️ Женский — по умолчанию)', default: true },
      { value: 'en-US-AriaNeural', label: 'Ария (♀️ Женский)' },
      { value: 'en-US-AvaNeural', label: 'Ава (♀️ Женский)' },
      { value: 'en-US-EmmaNeural', label: 'Эмма (♀️ Женский)' },
      { value: 'en-US-GuyNeural', label: 'Гай (♂️ Мужской)' },
      { value: 'en-US-BrianNeural', label: 'Брайан (♂️ Мужской)' },
      { value: 'en-US-AndrewNeural', label: 'Эндрю (♂️ Мужской)' },
    ]},
    { group: '🇬🇧 Великобритания', voices: [
      { value: 'en-GB-SoniaNeural', label: 'Соня (♀️ Женский)' },
      { value: 'en-GB-MaisieNeural', label: 'Мэйзи (♀️ Женский)' },
      { value: 'en-GB-RyanNeural', label: 'Райан (♂️ Мужской)' },
      { value: 'en-GB-ThomasNeural', label: 'Томас (♂️ Мужской)' },
    ]}
  ],
  no: [
    { group: '🇳🇴 Норвегия (Bokmål)', voices: [
      { value: 'nb-NO-FinnNeural', label: 'Финн (♂️ Мужской — по умолчанию)', default: true },
      { value: 'nb-NO-PernilleNeural', label: 'Пернилле (♀️ Женский)' },
      { value: 'nb-NO-IselinNeural', label: 'Иселин (♀️ Женский)' },
    ]}
  ],
  nb: [
    { group: '🇳🇴 Норвегия (Bokmål)', voices: [
      { value: 'nb-NO-FinnNeural', label: 'Финн (♂️ Мужской — по умолчанию)', default: true },
      { value: 'nb-NO-PernilleNeural', label: 'Пернилле (♀️ Женский)' },
      { value: 'nb-NO-IselinNeural', label: 'Иселин (♀️ Женский)' },
    ]}
  ],
  uk: [
    { group: '🇺🇦 Украина', voices: [
      { value: 'uk-UA-PolinaNeural', label: 'Поліна (♀️ Жіночий — за замовчуванням)', default: true },
      { value: 'uk-UA-OstapNeural', label: 'Остап (♂️ Чоловічий)' },
    ]}
  ],
  ru: [
    { group: '🇷🇺 Россия', voices: [
      { value: 'ru-RU-SvetlanaNeural', label: 'Светлана (♀️ Женский — по умолчанию)', default: true },
      { value: 'ru-RU-DmitryNeural', label: 'Дмитрий (♂️ Мужской)' },
    ]}
  ]
};

let usersStats = { total: 0, registered: 0, guest: 0 };
let currentDeckPage = 1;
const deckPageSize = 40;
let currentRenderedDecks = [];
let decksAutoRefreshInterval = null;

let foldersData = [];
let activeAssignFolderId = null;
let folderFilterMode = 'all';
let folderUserFilter = null;
let activeFolderRegenId = null;
let folderDecksState = {};
let globalBatchExcludedCards = new Set();

let promptsData = [];
let currentDeckCards = [];
let currentPlayingAudio = null;
let currentPreviewAudio = null;

let committedDryRunCardIds = new Set();
let activeStudioPreset = 'context_only';
let currentDryRunAudio = null;
let currentPlayingDryRunIndex = null;
let currentPlayingDryRunBtn = null;
let lastSingleDryRunKey = '';
let lastBatchDryRunKey = '';

let previewDeckId = null;
let previewDeckData = null;
let previewCardsList = [];

let activeBulkTaskId = null;
let bulkPollInterval = null;

let activeCollaborativeType = null;
let activeCollaborativeId = null;
