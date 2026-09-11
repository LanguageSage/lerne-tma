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
    { id: 'de-DE-KatjaNeural', name: '🇩🇪 Katja (Женский, естественный, основной)' },
    { id: 'de-DE-ConradNeural', name: '🇩🇪 Conrad (Мужской, четкий)' },
    { id: 'de-DE-AmalaNeural', name: '🇩🇪 Amala (Женский, мягкий)' },
    { id: 'de-DE-BerndNeural', name: '🇩🇪 Bernd (Мужской, глубокий)' },
    { id: 'de-DE-ChristophNeural', name: '🇩🇪 Christoph (Мужской, дикторский)' },
    { id: 'de-DE-ElkeNeural', name: '🇩🇪 Elke (Женский)' },
    { id: 'de-DE-GiselaNeural', name: '🇩🇪 Gisela (Женский)' },
    { id: 'de-DE-KasperNeural', name: '🇩🇪 Kasper (Мужской)' },
    { id: 'de-DE-KillianNeural', name: '🇩🇪 Killian (Мужской, молодой)' },
    { id: 'de-DE-KlarissaNeural', name: '🇩🇪 Klarissa (Женский)' },
    { id: 'de-DE-KlausNeural', name: '🇩🇪 Klaus (Мужской)' },
    { id: 'de-DE-LouisaNeural', name: '🇩🇪 Louisa (Женский, живой)' },
    { id: 'de-DE-MajaNeural', name: '🇩🇪 Maja (Женский, юный)' },
    { id: 'de-DE-RalfNeural', name: '🇩🇪 Ralf (Мужской)' },
    { id: 'de-DE-TanjaNeural', name: '🇩🇪 Tanja (Женский)' },
    { id: 'de-DE-FlorianMultilingualNeural', name: '🇩🇪 Florian (Мультиязычный)' },
    { id: 'de-DE-SeraphinaMultilingualNeural', name: '🇩🇪 Seraphina (Мультиязычный)' }
  ],
  en: [
    { id: 'en-US-JennyNeural', name: '🇺🇸 Jenny (Женский, основной)' },
    { id: 'en-US-GuyNeural', name: '🇺🇸 Guy (Мужской, четкий)' },
    { id: 'en-GB-SoniaNeural', name: '🇬🇧 Sonia (Британский, женский)' },
    { id: 'en-GB-RyanNeural', name: '🇬🇧 Ryan (Британский, мужской)' }
  ],
  nb: [
    { id: 'nb-NO-PernilleNeural', name: '🇳🇴 Pernille (Норвежский, женский)' },
    { id: 'nb-NO-FinnNeural', name: '🇳🇴 Finn (Норвежский, мужской)' }
  ],
  no: [
    { id: 'nb-NO-PernilleNeural', name: '🇳🇴 Pernille (Норвежский, женский)' },
    { id: 'nb-NO-FinnNeural', name: '🇳🇴 Finn (Норвежский, мужской)' }
  ],
  uk: [
    { id: 'uk-UA-PolinaNeural', name: '🇺🇦 Поліна (Українська, жіночий)' },
    { id: 'uk-UA-OstapNeural', name: '🇺🇦 Остап (Українська, чоловічий)' }
  ],
  ru: [
    { id: 'ru-RU-SvetlanaNeural', name: '🇷🇺 Светлана (Женский)' },
    { id: 'ru-RU-DmitryNeural', name: '🇷🇺 Дмитрий (Мужской)' }
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
