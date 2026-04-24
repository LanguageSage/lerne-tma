import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers, ChevronLeft, ChevronRight, Volume2, CheckCircle, Info, RefreshCw, Settings, X, Plus, Edit2, Trash2, Image as ImageIcon, Copy, Check } from 'lucide-react';
import './App.css';

// Конфигурация API
const API_BASE = '/api';

const storage = {
  get: (key) => {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  },
  set: (key, value) => {
    try { localStorage.setItem(key, value); } catch (e) {}
  }
};

// Получаем User ID из Telegram, URL или localStorage (Безопасная версия)
const getUserId = () => {
  try {
    // 1. Пытаемся взять из Telegram WebApp
    const tg = window.Telegram?.WebApp;
    if (tg?.initDataUnsafe?.user?.id) {
      const id = parseInt(tg.initDataUnsafe.user.id);
      if (!isNaN(id)) {
        storage.set('lerne_user_id', id);
        return id;
      }
    }
    
    // 2. Пытаемся взять из URL (?user_id=123)
    const params = new URLSearchParams(window.location.search);
    const urlId = params.get('user_id');
    if (urlId) {
      const id = parseInt(urlId);
      if (!isNaN(id)) {
        storage.set('lerne_user_id', id);
        return id;
      }
    }

    // 3. Пытаемся взять из localStorage
    const savedId = storage.get('lerne_user_id');
    if (savedId) {
      const id = parseInt(savedId);
      if (!isNaN(id)) return id;
    }
    
    // 4. Генерируем новый случайный ID (для новых веб-пользователей)
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 642478257;
    }

    const newId = Math.floor(100000000 + Math.random() * 900000000);
    storage.set('lerne_user_id', newId);
    return newId;
  } catch (err) {
    console.error("Critical error in getUserId:", err);
    return 642478257; 
  }
};

const VOICE_OPTIONS = [
  { value: "de-DE-KatjaNeural", label: "Германия: Катя (Жен)" },
  { value: "de-DE-ConradNeural", label: "Германия: Конрад (Муж)" },
  { value: "de-DE-AmalaNeural", label: "Германия: Амала (Жен)" },
  { value: "ru-RU-SvetlanaNeural", label: "Россия: Светлана (Жен)" },
  { value: "ru-RU-DmitryNeural", label: "Россия: Дмитрий (Муж)" },
  { value: "en-US-AriaNeural", label: "США: Ария (Жен)" },
  { value: "en-US-GuyNeural", label: "США: Гай (Муж)" },
];

const USER_ID = getUserId();

const stripMarkdown = (text) => {
  if (!text) return "";
  return text
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/```/g, "")
    .replace(/\*/g, "")
    .replace(/_/g, "")
    .replace(/`/g, "")
    .replace(/<center>/g, "")
    .replace(/<\/center>/g, "")
    .replace(/<large>/g, "")
    .replace(/<\/large>/g, "")
    .trim();
};

function App() {
  const [view, setView] = useState('decks'); // 'decks' | 'study' | 'cards' | 'editor'
  const [decks, setDecks] = useState([]);
  const [currentDeck, setCurrentDeck] = useState(null);
  const [card, setCard] = useState(null);
  const [deckCards, setDeckCards] = useState([]);
  const [editingCard, setEditingCard] = useState(null); // For editor view

  const [isFlipped, setIsFlipped] = useState(false);
  const [studyHistory, setStudyHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [apiError, setApiError] = useState(null);

  const [autoPlay, setAutoPlay] = useState(() => {
    const saved = storage.get('lerne_autoplay');
    return saved !== null ? saved === 'true' : true;
  });
  const [autoShow, setAutoShow] = useState(() => {
    const saved = storage.get('lerne_autoshow');
    return saved !== null ? saved === 'true' : false;
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isNewDeckModalOpen, setIsNewDeckModalOpen] = useState(false);
  const [deckModalMode, setDeckModalMode] = useState('choice'); // 'choice', 'library', 'json'
  const [isOpeningDeck, setIsOpeningDeck] = useState(false);
  const [newDeckName, setNewDeckName] = useState('');
  
  const [adminSettings, setAdminSettings] = useState({});
  const [aiInputPhrase, setAiInputPhrase] = useState('');
  const [isAiWizardOpen, setIsAiWizardOpen] = useState(false);
  const [editorSourceView, setEditorSourceView] = useState('cards');
  const [userPrompts, setUserPrompts] = useState({ translation_prompt: '', context_prompt: '' });
  const [activeSettingsTab, setActiveSettingsTab] = useState('general'); // 'general' | 'voice' | 'ai' | 'prompts' | 'presets'
  const [availableModels, setAvailableModels] = useState([]);
  const [presets, setPresets] = useState([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  
  // Новые состояния для импорта
  const [externalDecks, setExternalDecks] = useState([]);
  const [communityDecks, setCommunityDecks] = useState([]);
  const [isImportLoading, setIsImportLoading] = useState(false);
  
  const audioRef = React.useRef(null);
  const fileInputRef = React.useRef(null);

  useEffect(() => {
    fetchDecks();
    fetchAdminSettings();
    fetchUserPrompts();
    const params = new URLSearchParams(window.location.search);
    if (params.get('admin') === '1' || USER_ID === 642478257) setIsAdmin(true);
  }, []);

  useEffect(() => {
    if (isSettingsOpen && isAdmin) {
      fetchPresets();
    }
  }, [isSettingsOpen, isAdmin]);

  // Сброс модального окна при открытии
  useEffect(() => {
    if (isNewDeckModalOpen) {
      setDeckModalMode('choice');
      setIsImportLoading(false);
    }
  }, [isNewDeckModalOpen]);

  // Save settings to localStorage
  useEffect(() => {
    storage.set('lerne_autoplay', autoPlay);
  }, [autoPlay]);

  useEffect(() => {
    storage.set('lerne_autoshow', autoShow);
  }, [autoShow]);

  // Auto-play when card changes
  useEffect(() => {
    if (card && card.audio_url && autoPlay) {
      // Small delay to ensure card content is rendered and feel smoother
      const timer = setTimeout(() => playAudio(card.audio_url), 300);
      return () => clearTimeout(timer);
    }
  }, [card?.id, autoPlay]);

  // Auto-flip when autoShow is on
  useEffect(() => {
    if (card && autoShow && !isFlipped) {
      // Delay: 3s if audio is playing, 2s otherwise
      const delay = card.audio_url && autoPlay ? 3000 : 2000;
      const timer = setTimeout(() => {
        setIsFlipped(true);
      }, delay);
      return () => clearTimeout(timer);
    }
  }, [card?.id, autoShow, isFlipped, autoPlay]);

  const fetchDecks = async (force = false) => {
    if (!force && decks.length > 0) return; // Use cache if not forced
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/decks`, { headers: { 'X-User-ID': USER_ID } });
      setDecks(res.data);
    } catch (err) { 
      console.error("Fetch Decks Error:", err);
      showToast("Не удалось загрузить колоды. Проверьте соединение.");
    }
    setLoading(false);
  };

  const handleResetProgress = async (deckId) => {
    if (!window.confirm("Это сбросит весь прогресс обучения по этой колоде. Вы уверены?")) return;
    setLoading(true);
    try {
      await axios.post(`${API_BASE}/decks/${deckId}/reset`, {}, { headers: { 'X-User-ID': USER_ID } });
      showToast("Прогресс сброшен", "success");
      fetchDecks(true);
      if (view === 'study') startStudy(currentDeck);
    } catch (err) {
      showToast("Ошибка при сбросе");
    }
    setLoading(false);
  };

  const handleSyncDeck = async (deckId) => {
    setLoading(true);
    showToast("Синхронизация...");
    try {
      await axios.post(`${API_BASE}/decks/${deckId}/sync`, {}, { headers: { 'X-User-ID': USER_ID } });
      showToast("Колода обновлена", "success");
      fetchDecks(true);
    } catch (err) {
      showToast("Ошибка при синхронизации");
    }
    setLoading(false);
  };

  const startStudy = async (deck) => {
    setIsOpeningDeck(true);
    try {
      setCurrentDeck(deck);
      setView('study'); 
      setCard(null); 
      setIsFlipped(false);
      setStudyHistory([]);
      setHistoryIndex(-1);
      await fetchNextCard(deck.id, true);
    } finally {
      setIsOpeningDeck(false);
    }
  };

  const fetchNextCard = async (deckId, isFirst = false, excludeIds = []) => {
    setLoading(true);
    setApiError(null);
    try {
      const excludeParam = excludeIds.length > 0 ? `?exclude_ids=${excludeIds.join(',')}` : '';
      const res = await axios.get(`${API_BASE}/decks/${deckId}/next${excludeParam}`, { headers: { 'X-User-ID': USER_ID } });
      console.log("Next Card Response:", res.data);
      
      if (res.data.error) {
        setApiError(res.data.error);
        setCard(null);
      } else if (res.data.finished) {
        setCard(null);
      } else {
        const newCard = res.data;
        setCard(newCard);
        setStudyHistory(prev => [...prev, newCard]);
        setHistoryIndex(prev => prev + 1);
        prefetchMedia(newCard.image_url);
      }
    } catch (err) { 
      console.error("fetchNextCard Error:", err);
      setApiError(err.response?.data?.detail || err.message);
    }
    setLoading(false);
  };

  const prefetchMedia = (url) => {
    if (!url) return;
    const img = new Image();
    img.src = url;
  };

  const submitGrade = async (grade) => {
    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/study/grade`, {
        card_id: card.id,
        deck_id: currentDeck.id,
        grade
      }, { headers: { 'X-User-ID': USER_ID } });
      
      console.log("Submit Grade Response (Next Card):", res.data);
      setIsFlipped(false);
      
      if (res.data.finished) {
        setCard(null);
      } else {
        const nextCard = res.data;
        // При оценке мы фактически начинаем новую ветку истории или просто добавляем в конец
        setStudyHistory(prev => [...prev, nextCard]);
        setHistoryIndex(prev => prev + 1);
        setCard(nextCard);
        prefetchMedia(nextCard.image_url);
      }
    } catch (err) { 
      console.error("SubmitGrade Error:", err);
      showToast("Ошибка при сохранении оценки");
    }
    setLoading(false);
  };

  const goBack = () => {
    if (historyIndex > 0) {
      const prevIndex = historyIndex - 1;
      setIsFlipped(false);
      // Небольшая задержка чтобы сброс isFlipped применился до смены карточки
      setTimeout(() => {
        setHistoryIndex(prevIndex);
        setCard(studyHistory[prevIndex]);
      }, 50);
    }
  };

  const goNext = () => {
    setIsFlipped(false);
    if (historyIndex < studyHistory.length - 1) {
      const nextIndex = historyIndex + 1;
      setTimeout(() => {
        setHistoryIndex(nextIndex);
        setCard(studyHistory[nextIndex]);
      }, 50);
    } else {
      // "Skip" logic - fetch next but don't grade
      // Exclude cards already in history to get a fresh one
      const excludeIds = studyHistory.map(c => c.id);
      setTimeout(() => fetchNextCard(currentDeck.id, false, excludeIds), 50);
    }
  };

  const playAudio = (url) => {
    if (!url) return;
    
    // Stop previous audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    console.log("Playing audio:", url);
    const audio = new Audio(url);
    audioRef.current = audio;
    
    audio.onerror = () => {
      showToast("Ошибка аудио: файл не найден или поврежден");
    };

    audio.play().catch(err => {
      console.error("Audio play failed:", err);
      if (err.name === "NotSupportedError" || err.name === "NotAllowedError") {
         // Silently fail on autoplay blocking, but show toast for manual clicks
         if (!autoPlay) showToast("Браузер заблокировал звук");
      }
    });
  };

  const fetchDeckCards = async (deckId) => {
    setIsOpeningDeck(true);
    try {
      const res = await axios.get(`${API_BASE}/decks/${deckId}/cards`);
      setDeckCards(res.data);
      setView('cards');
    } catch (err) {
      console.error(err);
      showToast("Ошибка загрузки карточек");
    } finally {
      setIsOpeningDeck(false);
    }
  };

  const openEditor = (deckId, cardToEdit = null, source = 'cards') => {
    const cleanMedia = (p) => {
      if (!p) return '';
      if (p.startsWith('/api/media/')) {
        // Убираем префикс /api/media/ и тип (audio/images)
        const parts = p.split('/');
        return parts.slice(3).join('/'); // Оставляем всё после /api/media/type/
      }
      return p;
    };

    if (cardToEdit) {
      setEditingCard({
        id: cardToEdit.id,
        front: cardToEdit.front || '',
        back: cardToEdit.back || '',
        context: cardToEdit.context || '',
        image_path: cleanMedia(cardToEdit.image_path || cardToEdit.image_url),
        audio_path: cleanMedia(cardToEdit.audio_path || cardToEdit.audio_url),
        deck_id: deckId
      });
    } else {
      setEditingCard({ front: '', back: '', context: '', deck_id: deckId });
    }
    setEditorSourceView(source);
    setIsAiWizardOpen(false);
    setView('editor');
  };

  const handleQuickAudio = async (c) => {
    if (!c || !c.front) return;
    setLoading(true);
    const voice = adminSettings.TTS_VOICE || 'de-DE-KatjaNeural';
    const rate = adminSettings.TTS_SPEED || '+0%';
    // Если на фронте русский - озвучиваем бэк (немецкий)
    const hasRussian = /[а-яА-Я]/.test(c.front);
    const textToSpeak = hasRussian ? c.back : c.front;
    
    if (!textToSpeak) {
      showToast("Нет текста для озвучки");
      setLoading(false);
      return;
    }

    try {
      const res = await axios.post(`${API_BASE}/media/generate-audio`, {
        text: textToSpeak,
        lang: 'de',
        voice: voice,
        rate: rate
      }, { headers: { 'X-User-ID': USER_ID } });
      const newAudioPath = res.data.path;
      
      await axios.post(`${API_BASE}/cards/save`, {
        card_id: c.id,
        deck_id: c.deck_id,
        front: c.front,
        back: c.back,
        context: c.context,
        image_path: c.image_url || c.image_path || '',
        audio_path: newAudioPath
      }, { headers: { 'X-User-ID': USER_ID } });
      
      setCard({ ...c, audio_url: res.data.url, audio_path: res.data.path });
      showToast("Озвучка добавлена!", "success");
      playAudio(res.data.url);
    } catch (err) {
      console.error(err);
      showToast(`Ошибка генерации: ${err.response?.data?.detail || err.message}`, "error");
    }
    setLoading(false);
  };

  const saveCard = async () => {
    if (!editingCard.front || !editingCard.back) {
      showToast("Заполните текст и перевод");
      return;
    }

    setLoading(true);
    try {
      const reqData = {
        card_id: editingCard.id || null,
        deck_id: editingCard.deck_id || currentDeck?.id || null,
        front: editingCard.front,
        back: editingCard.back,
        context: editingCard.context,
        image_path: editingCard.image_path,
        audio_path: editingCard.audio_path
      };

      await axios.post(`${API_BASE}/cards/save`, reqData, { headers: { 'X-User-ID': USER_ID } });
      showToast("Сохранено", "success");
      
      if (editorSourceView === 'study') {
        // Локально обновляем текущую карточку, чтобы изменения были видны сразу
        if (card && card.id === editingCard.id) {
          const resolvedAudio = editingCard.audio_path?.includes('/') 
            ? `/api/media/${editingCard.audio_path}` 
            : card.audio_url;
            
          setCard({ 
            ...card, 
            ...editingCard,
            image_url: editingCard.image_path?.includes('/') ? `/api/media/images/${editingCard.image_path.split('/').pop()}` : card.image_url,
            audio_url: resolvedAudio
          });
        }
        setView('study');
      } else if (editorSourceView === 'cards') {
        fetchDeckCards(editingCard.deck_id || currentDeck?.id);
        setView('cards');
      } else {
        fetchDecks(true);
        setView('decks');
      }
    } catch (err) {
      console.error(err);
      showToast("Ошибка сохранения");
    }
    setLoading(false);
  };

  const generateAudio = async () => {
    if (!editingCard.front) return;
    setLoading(true);
    const voice = adminSettings.TTS_VOICE || 'de-DE-KatjaNeural';
    const rate = adminSettings.TTS_SPEED || '+0%';
    // Если на фронте русский - озвучиваем бэк
    const hasRussian = /[а-яА-Я]/.test(editingCard.front);
    const textToSpeak = hasRussian ? editingCard.back : editingCard.front;

    if (!textToSpeak) {
      showToast("Заполните текст для озвучки");
      setLoading(false);
      return;
    }

    try {
      const res = await axios.post(`${API_BASE}/media/generate-audio`, {
        text: textToSpeak,
        lang: 'de',
        voice: voice,
        rate: rate
      }, { headers: { 'X-User-ID': USER_ID } });
      setEditingCard({ 
        ...editingCard, 
        audio_path: res.data.path,
        audio_url: res.data.url // Временное поле для предпросмотра в редакторе
      });
      showToast("Аудио сгенерировано", "success");
      // Авто-воспроизведение для проверки
      playAudio(res.data.url);
    } catch (err) {
      console.error(err);
      showToast(`Ошибка генерации аудио: ${err.response?.data?.detail || err.message}`);
    }
    setLoading(false);
  };

  const handleImageUpload = (e) => {
    showToast("Загрузка временно недоступна");
  };

  const fetchUserPrompts = async () => {
    try {
      const res = await axios.get(`${API_BASE}/user/prompts`, { headers: { 'X-User-ID': USER_ID } });
      setUserPrompts(res.data);
    } catch (err) { console.error(err); }
  };

  const saveUserPrompts = async () => {
    try {
      await axios.post(`${API_BASE}/user/prompts`, userPrompts, { headers: { 'X-User-ID': USER_ID } });
      showToast("Промпты сохранены", "success");
    } catch (err) { showToast("Ошибка сохранения", "error"); }
  };

  const fetchAdminSettings = async () => {
    try {
      const res = await axios.get(`${API_BASE}/admin/settings?admin_key=1`);
      setAdminSettings(res.data);
    } catch (err) { console.error(err); }
  };

  const saveAdminSettings = async () => {
    try {
      // Приводим ключи к нижнему регистру для Pydantic
      const mappedSettings = {};
      Object.keys(adminSettings).forEach(key => {
        let mappedKey = key.toLowerCase();
        // Специальный маппинг для AI_PROVIDER
        if (mappedKey === 'ai_provider') mappedKey = 'provider';
        mappedSettings[mappedKey] = adminSettings[key];
      });
      
      const res = await axios.post(`${API_BASE}/admin/settings?admin_key=1`, mappedSettings);
      if (res.data.status === 'ok') {
        showToast("Настройки сохранены", "success");
        fetchAdminSettings();
      } else {
        showToast("Ошибка сервера при сохранении", "error");
      }
    } catch (err) { 
      console.error(err);
      const detail = err.response?.data?.detail;
      showToast(`Ошибка сохранения: ${detail || err.message}`, "error"); 
    }
  };

  const fetchModels = async () => {
    const provider = adminSettings.AI_PROVIDER;
    if (!provider) return;
    
    setIsFetchingModels(true);
    try {
      let url = `${API_BASE}/admin/models/${provider}`;
      if (provider === 'ollama') {
        url += `?url=${encodeURIComponent(adminSettings.OLLAMA_URL || 'http://localhost:11434')}`;
      }
      const res = await axios.get(url);
      setAvailableModels(res.data);
      if (res.data.length > 0 && !adminSettings.DEFAULT_MODEL) {
        setAdminSettings({...adminSettings, DEFAULT_MODEL: res.data[0]});
      }
    } catch (err) {
      showToast("Ошибка загрузки моделей");
    }
    setIsFetchingModels(false);
  };

  const fetchPresets = async () => {
    try {
      const res = await axios.get(`${API_BASE}/admin/presets`);
      setPresets(res.data);
    } catch (err) { console.error(err); }
  };

  const saveCurrentAsPreset = async () => {
    if (!newPresetName) {
      showToast("Введите имя пресета");
      return;
    }
    const newPresets = [...presets, { name: newPresetName, settings: { ...adminSettings } }];
    try {
      await axios.post(`${API_BASE}/admin/presets`, newPresets);
      setPresets(newPresets);
      setNewPresetName('');
      showToast("Preset сохранен");
    } catch (err) { showToast("Ошибка сохранения пресета"); }
  };

  const applyPreset = (preset) => {
    setAdminSettings({ ...adminSettings, ...preset.settings });
    showToast(`Применен пресет: ${preset.name}`);
  };

  const deletePreset = async (index) => {
    const newPresets = presets.filter((_, i) => i !== index);
    try {
      await axios.post(`${API_BASE}/admin/presets`, newPresets);
      setPresets(newPresets);
    } catch (err) { showToast("Ошибка удаления"); }
  };

  const createDeck = async () => {
    if (!newDeckName) return;
    setLoading(true);
    try {
      await axios.post(`${API_BASE}/decks`, { name: newDeckName }, { headers: { 'X-User-ID': USER_ID } });
      setNewDeckName('');
      setIsNewDeckModalOpen(false);
      setDeckModalMode('choice');
      fetchDecks(true);
      showToast("Колода создана");
    } catch (err) { showToast("Ошибка создания"); }
    setLoading(false);
  };

  const handleDeleteDeck = (e, deckId) => {
    e.stopPropagation();
    if (!window.confirm("Вы уверены, что хотите полностью удалить эту колоду и весь прогресс?")) return;
    
    setLoading(true);
    axios.delete(`${API_BASE}/decks/${deckId}`)
      .then(() => {
        showToast("Колода удалена");
        fetchDecks(true);
      })
      .catch(err => {
        console.error(err);
        showToast("Ошибка при удалении");
      })
      .finally(() => setLoading(false));
  };

  const handleDeleteCard = (e, cardId) => {
    e.stopPropagation();
    if (!window.confirm("Удалить эту карточку?")) return;

    setLoading(true);
    axios.delete(`${API_BASE}/cards/${cardId}`)
      .then(() => {
        showToast("Карточка удалена");
        fetchDeckCards(currentDeck.id);
      })
      .catch(err => {
        console.error(err);
        showToast("Ошибка при удалении");
      })
      .finally(() => setLoading(false));
  };

  const fetchExternalDecks = async () => {
    setIsImportLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/external/decks`);
      setExternalDecks(res.data);
      if (isNewDeckModalOpen) {
        setDeckModalMode('import');
      }
    } catch (err) {
      showToast("Ошибка загрузки внешних колод");
    }
    setIsImportLoading(false);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const jsonData = JSON.parse(event.target.result);
        setLoading(true);
        showToast("Импорт из файла...", "success");
        
        await axios.post(`${API_BASE}/decks/import-json`, jsonData, { 
          headers: { 'X-User-ID': USER_ID } 
        });
        
        setIsNewDeckModalOpen(false);
        fetchDecks(true);
        showToast("Колода импортирована!", "success");
      } catch (err) {
        console.error("File import error:", err);
        showToast("Ошибка импорта: неверный формат файла");
      }
      setLoading(false);
      // Сброс инпута
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  const importDeck = async (deckId) => {
    setIsOpeningDeck(true);
    try {
      await axios.post(`${API_BASE}/external/import/${deckId}`, {}, { headers: { 'X-User-ID': USER_ID } });
      
      setIsNewDeckModalOpen(false);
      setDeckModalMode('choice');
      
      // Сразу обновляем список, не дожидаясь таймаута
      await fetchDecks(true);
      showToast("Колода успешно импортирована!", "success");
      
      // На всякий случай обновляем еще раз через секунду, если Supabase тормозит
      setTimeout(() => fetchDecks(true), 1500);
    } catch (err) {
      console.error("Import error:", err);
      showToast(`Ошибка импорта: ${err.response?.data?.detail || err.message}`);
    } finally {
      setIsOpeningDeck(false);
    }
  };

  const fetchCommunityDecks = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/admin/community/decks`, { headers: { 'X-User-ID': USER_ID } });
      setCommunityDecks(res.data);
      setActiveSettingsTab('community');
    } catch (err) {
      showToast("Ошибка загрузки сообщества");
    }
    setLoading(false);
  };

  const promoteDeck = async (deckId) => {
    if (!window.confirm("Добавить эту пользовательскую колоду в общую библиотеку?")) return;
    setLoading(true);
    try {
      await axios.post(`${API_BASE}/admin/community/promote/${deckId}`);
      showToast("Колода добавлена в библиотеку!", "success");
      fetchCommunityDecks();
    } catch (err) {
      showToast("Ошибка при вливании колоды");
    }
    setLoading(false);
  };

  const runAiGenerator = async () => {
    if (!aiInputPhrase) return;
    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/cards/ai-generate`, { phrase: aiInputPhrase }, { headers: { 'X-User-ID': USER_ID } });
      setEditingCard({
        ...editingCard,
        front: res.data.front,
        back: res.data.back,
        context: res.data.context
      });
      setIsAiWizardOpen(false);
      showToast("Готово! Проверьте поля.");
    } catch (err) { showToast("Ошибка ИИ"); }
    setLoading(false);
  };

  const showToast = (message, type = "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  return (
    <div className="app-container">
      <div className="view-decks" style={{ display: view === 'decks' ? 'block' : 'none' }}>
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: view === 'decks' ? 1 : 0, y: view === 'decks' ? 0 : 20 }}
          className="view"
        >
          <div className="header">
            <div className="header-title-row">
              <h1>Lerne TMA</h1>
              <div style={{fontSize: '10px', opacity: 0.5, marginLeft: '10px'}}>ID: {USER_ID}</div>
              <div className="header-actions">
                <button className="add-deck-btn" onClick={() => setIsNewDeckModalOpen(true)}>
                  <Plus size={20} />
                </button>
                <button className="settings-btn" onClick={() => setIsSettingsOpen(true)}>
                  <Settings size={20} />
                </button>
                <button className="refresh-btn" onClick={() => fetchDecks(true)} disabled={loading}>
                  <RefreshCw size={20} className={loading ? 'spin' : ''} />
                </button>
              </div>
            </div>
            <p>Выбирайте колоду и начните обучение</p>
            <div className="commercial-info glass">
              <Info size={16} />
              <div className="web-link-container">
                <span>Персональная ссылка: </span>
                <code className="web-link">{window.location.origin}/?user_id={USER_ID}</code>
                <button 
                  className="copy-link-btn" 
                  onClick={() => {
                    const link = `${window.location.origin}/?user_id=${USER_ID}`;
                    navigator.clipboard.writeText(link);
                    showToast("Ссылка скопирована!", "success");
                  }}
                  title="Копировать ссылку"
                >
                  <Copy size={14} />
                </button>
              </div>
            </div>
          </div>

          <div className="deck-grid">
            {loading && decks.length === 0 ? (
              <div className="empty-decks-state glass">
                <RefreshCw size={48} className="spin" color="#a855f7" />
                <h3>Идет загрузка колод...</h3>
                <p>Пожалуйста, подождите немного.</p>
              </div>
            ) : decks.length === 0 ? (
              <div className="empty-decks-state glass">
                <Layers size={48} opacity={0.3} />
                <h3>У вас пока нет колод</h3>
                <p>Нажмите "+", чтобы создать свою или импортировать из библиотеки.</p>
                <button className="btn btn-primary" onClick={() => setIsNewDeckModalOpen(true)}>Добавить первую колоду</button>
              </div>
            ) : (
              decks.map(deck => (
                <div key={deck.id} className="deck-card glass">
                  <div className="deck-main-action" onClick={() => startStudy(deck)}>
                    <div className="deck-icon"><Layers size={24} /></div>
                    <h3>{deck.name}</h3>
                    <div className="deck-stats">
                      <span className="stat new">{deck.stats.new}</span>
                      <span className="stat learning">{deck.stats.learning}</span>
                      <span className="stat due">{deck.stats.due}</span>
                    </div>
                  </div>
                  <div className="deck-footer-actions">
                    <button className="deck-action-btn" onClick={() => { setCurrentDeck(deck); fetchDeckCards(deck.id); }}>
                      <Layers size={16} /> Карточки
                    </button>
                    <button className="deck-action-btn" onClick={() => handleSyncDeck(deck.id)} title="Синхронизировать с библиотекой">
                      <RefreshCw size={16} /> Обновить
                    </button>
                    <button className="deck-action-btn" onClick={(e) => { e.stopPropagation(); handleResetProgress(deck.id); }} title="Сбросить прогресс обучения">
                      <RefreshCw size={16} style={{ color: '#ef4444' }} /> Сбросить
                    </button>
                    <button className="deck-action-btn delete-btn-minimal" onClick={(e) => handleDeleteDeck(e, deck.id)} title="Удалить колоду">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          
          <div className="debug-footer glass" style={{marginTop: '20px', padding: '10px', fontSize: '10px', opacity: 0.5}}>
             DEBUG: UserID={USER_ID} | Decks={decks.length} | 
             Stats: {decks.map(d => `${d.name}:${d.stats.total}`).join(', ')}
          </div>
        </motion.div>
      </div>

      <div className="view-study" style={{ display: view === 'study' ? 'block' : 'none' }}>
        {view === 'study' && (
            <motion.div 
              key="study"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              className="view"
            >
              <div className="header-compact">
                <button className="back-btn" onClick={() => { setView('decks'); setCard(null); }}>
                  <ChevronLeft size={24} />
                </button>
                <div className="header-study-info">
                  <h2>{currentDeck?.name}</h2>
                </div>
                <div className="header-actions">
                  <a 
                    href={`https://www.google.com/search?q=${encodeURIComponent(card?.front || '')}&tbm=isch`} 
                    target="_blank" 
                    rel="noreferrer" 
                    className="edit-btn-study"
                    title="Найти картинку"
                  >
                    <ImageIcon size={20} />
                  </a>
                  <button 
                    className="edit-btn-study" 
                    onClick={() => handleQuickAudio(card)} 
                    disabled={loading}
                    title="Добавить озвучку"
                  >
                    <Volume2 size={20} />
                  </button>
                  <button className="edit-btn-study" onClick={() => openEditor(currentDeck.id, card, 'study')} title="Редактировать">
                    <Edit2 size={20} />
                  </button>
                  <button className="settings-btn" onClick={() => setIsSettingsOpen(true)}>
                    <Settings size={22} />
                  </button>
                </div>
              </div>

              <AnimatePresence>
                {toast && (
                  <motion.div 
                    initial={{ opacity: 0, y: -20, x: "-50%" }}
                    animate={{ opacity: 1, y: 0, x: "-50%" }}
                    exit={{ opacity: 0 }}
                    className={`toast glass ${toast.type}`}
                  >
                    {toast.message}
                  </motion.div>
                )}
              </AnimatePresence>

              {loading && !card ? (
                <div className="finished-view glass">
                  <RefreshCw size={48} className="spin" color="#a855f7" />
                  <h3>Загрузка карточек...</h3>
                </div>
              ) : card ? (
                <div className="study-flow">
                  <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={card.id}
                    initial={{ opacity: 0, x: 30 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -30 }}
                    transition={{ duration: 0.2 }}
                    className={`card-container ${loading ? 'loading-card' : ''}`}
                    onClick={() => !loading && setIsFlipped(!isFlipped)}
                  >
                    {!isFlipped ? (
                      <div className="card-inner card-front glass">
                        <div className="card-face">
                          <div className="card-q">❓</div>
                          <div className="text-front">{stripMarkdown(card.front)}</div>
                          {card.audio_url && (
                            <button 
                              className="audio-btn" 
                              disabled={loading}
                              onClick={(e) => { e.stopPropagation(); playAudio(card.audio_url); }}
                            >
                              <Volume2 size={20} />
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="card-inner card-back glass">
                        <div className="card-face">
                          <div className="text-front-mini">{stripMarkdown(card.front)}</div>
                          <div className="text-back">{stripMarkdown(card.back)}</div>
                          {card.image_url && (
                            <img 
                              src={card.image_url} 
                              className="card-img" 
                              alt="Card"
                              onError={(e) => { console.warn('Image load error:', card.image_url); e.target.style.display='none'; }}
                            />
                          )}
                          {card.context && <div className="text-context">{stripMarkdown(card.context)}</div>}
                          {card.audio_url && (
                            <button 
                              className="audio-btn bg-audio-btn" 
                              disabled={loading}
                              onClick={(e) => { e.stopPropagation(); playAudio(card.audio_url); }}
                            >
                              <Volume2 size={24} />
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {loading && (
                      <div className="card-loading-overlay">
                        <RefreshCw size={40} className="spin" />
                      </div>
                    )}
                  </motion.div>
                  </AnimatePresence>

                  {isFlipped && (
                    <div className="grade-buttons">
                      <button disabled={loading} title="Again" className="btn btn-grade grade-0" onClick={() => submitGrade(0)}>{card.intervals?.[0] || 'Снова'}</button>
                      <button disabled={loading} title="Hard" className="btn btn-grade grade-1" onClick={() => submitGrade(1)}>{card.intervals?.[1] || 'Трудно'}</button>
                      <button disabled={loading} title="Good" className="btn btn-grade grade-2" onClick={() => submitGrade(2)}>{card.intervals?.[2] || 'Хорошо'}</button>
                      <button disabled={loading} title="Easy" className="btn btn-grade grade-3" onClick={() => submitGrade(3)}>{card.intervals?.[3] || 'Легко'}</button>
                    </div>
                  )}
                  
                  {!isFlipped && (
                    <p className="hint">Нажмите на карточку, чтобы увидеть ответ</p>
                  )}

                  <div className="study-navigation">
                    <div className="nav-counter nav-counter-current" title="Текущая позиция">
                      {historyIndex + 1}
                    </div>
                    <div className="nav-buttons-group">
                      <button 
                        className="nav-arrow-btn" 
                        onClick={goBack} 
                        disabled={historyIndex <= 0 || loading}
                        title="Назад"
                      >
                        <ChevronLeft size={28} />
                      </button>
                      <button 
                        className="nav-arrow-btn" 
                        onClick={goNext} 
                        disabled={loading}
                        title="Вперед (пропустить)"
                      >
                        <ChevronRight size={28} />
                      </button>
                    </div>
                    <div className="nav-counter nav-counter-total" title="Всего в колоде">
                      {currentDeck?.stats?.total || 0}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="finished-view glass">
                  <CheckCircle size={48} color="#22c55e" />
                  <h3>Колода пройдена!</h3>
                  <p>На сегодня больше нет карточек для повторения.</p>
                  {apiError && (
                    <div className="api-error-box glass" style={{color: '#f87171', padding: '10px', margin: '10px 0', border: '1px solid #ef4444'}}>
                       Ошибка сервера: {apiError}
                    </div>
                  )}
                  <div className="finished-actions">
                    <button className="btn btn-primary" onClick={() => setView('decks')}>В меню</button>
                    <button className="btn btn-secondary" onClick={() => handleSyncDeck(currentDeck.id)}>Обновить данные</button>
                    <button className="btn btn-secondary" onClick={() => handleResetProgress(currentDeck.id)}>Учить заново</button>
                  </div>
                </div>
              )}
            </motion.div>
        )}
      </div>

      <AnimatePresence>
        {isNewDeckModalOpen && (
          <div className="settings-overlay" onClick={() => { setIsNewDeckModalOpen(false); setDeckModalMode('choice'); }}>
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="settings-modal" onClick={e => e.stopPropagation()}>
              <div className="settings-header">
                <h2>
                  {deckModalMode === 'choice' ? 'Добавить колоду' : 
                   deckModalMode === 'create' ? 'Новая колода' : 'Импорт из Lerne'}
                </h2>
                <button className="close-btn" onClick={() => { setIsNewDeckModalOpen(false); setDeckModalMode('choice'); setNewDeckName(''); }}><X size={24} /></button>
              </div>
              
              <div className="settings-content">
                {deckModalMode === 'choice' && (
                  <div className="choice-grid">
                    <button className="btn btn-primary btn-full choice-btn" onClick={() => setDeckModalMode('create')}>
                      <Plus size={20} /> Создать пустую
                    </button>
                    <button className="btn-secondary btn-full choice-btn" onClick={fetchExternalDecks} disabled={isImportLoading}>
                      {isImportLoading ? <RefreshCw size={20} className="spin" /> : <Layers size={20} />} 
                      {isImportLoading ? ' Загрузка...' : ' Из Библиотеки'}
                    </button>
                    <button className="btn-secondary btn-full choice-btn" onClick={() => fileInputRef.current?.click()}>
                      <Plus size={20} style={{ transform: 'rotate(45deg)' }} /> Загрузить JSON
                    </button>
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      style={{ display: 'none' }} 
                      accept=".json" 
                      onChange={handleFileUpload} 
                    />
                  </div>
                )}

                {deckModalMode === 'create' && (
                  <>
                    <div className="form-group">
                      <label>Название колоды</label>
                      <input autoFocus placeholder="Введите название..." value={newDeckName} onChange={e => setNewDeckName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createDeck()} />
                    </div>
                    <div className="modal-footer-actions">
                      <button className="btn btn-primary btn-full" onClick={createDeck} disabled={loading}>Создать</button>
                      <button className="btn-secondary btn-full" onClick={() => setDeckModalMode('choice')}>Назад</button>
                    </div>
                  </>
                )}

                {deckModalMode === 'import' && (
                  <div className="import-list scrollable">
                    {externalDecks.length === 0 ? <p>Колоды не найдены</p> : 
                      externalDecks.map(d => (
                        <div key={d.id} className="import-item glass" onClick={() => importDeck(d.id)}>
                           <div className="import-item-info">
                              <strong>{d.name}</strong>
                              <span>{d.topic}</span>
                           </div>
                           <Plus size={16} />
                        </div>
                      ))
                    }
                    <button className="btn-secondary btn-full mt-2" onClick={() => setDeckModalMode('choice')}>Назад</button>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="view-cards" style={{ display: view === 'cards' ? 'block' : 'none' }}>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: view === 'cards' ? 1 : 0 }} className="view">
          <div className="header-compact">
            <button className="back-btn" onClick={() => setView('decks')}><ChevronLeft size={24} /></button>
            <h2>{currentDeck?.name}</h2>
            <button className="add-card-btn" onClick={() => openEditor(currentDeck?.id, null, 'cards')}>+</button>
          </div>
          <div className="card-list">
            {deckCards.map(c => (
              <div key={c.id} className="card-item glass" onClick={() => openEditor(currentDeck.id, c, 'cards')}>
                <div className="card-item-text">
                  <div className="front-min">{c.front}</div>
                  <div className="back-min">{c.back}</div>
                </div>
                <div className="card-item-actions">
                  <div className="card-item-edit" onClick={() => openEditor(currentDeck.id, c, 'cards')}>✎</div>
                  <div className="card-item-delete" onClick={(e) => handleDeleteCard(e, c.id)}><Trash2 size={16} /></div>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      <div className="view-editor" style={{ display: view === 'editor' ? 'block' : 'none' }}>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: view === 'editor' ? 1 : 0 }} className="view">
          <div className="header-compact">
            <button className="back-btn" onClick={() => setView(editorSourceView)}><ChevronLeft size={24} /></button>
            <h2>{editingCard?.id ? 'Правка карточки' : 'Новая карточка'}</h2>
          </div>
          
          <div className="editor-form glass">
            {!isAiWizardOpen ? (
              <button className="btn-secondary btn-full ai-magic-btn" onClick={() => setIsAiWizardOpen(true)}>
                ✨ AI Мастер карточек
              </button>
            ) : (
              <div className="ai-wizard-panel glass">
                <label>Введите фразу для генерации</label>
                <textarea autoFocus placeholder="Например: Ich habe am Wochenende viel gearbeitet" value={aiInputPhrase} onChange={e => setAiInputPhrase(e.target.value)} />
                <div className="ai-wizard-actions">
                  <button className="btn btn-primary" onClick={runAiGenerator} disabled={loading}>
                    {loading ? "Думаю..." : "Сгенерировать"}
                  </button>
                  <button className="btn-secondary" onClick={() => setIsAiWizardOpen(false)}>Отмена</button>
                </div>
              </div>
            )}
            
            <div className="form-group">
              <label>Текст (Front)</label>
              <textarea 
                value={editingCard?.front || ''} 
                onChange={e => setEditingCard({...editingCard, front: e.target.value})}
              />
              <div className="editor-audio-actions">
                <button 
                  className="btn-secondary btn-small" 
                  onClick={generateAudio}
                  disabled={loading || !editingCard?.front}
                >
                  <Volume2 size={16} /> Озвучить
                </button>
                {(editingCard?.audio_path || editingCard?.audio_url) && (
                  <button 
                    className="btn-secondary btn-small play-preview-btn" 
                    onClick={() => playAudio(editingCard.audio_url || `/api/media/${editingCard.audio_path}`)}
                  >
                    <RefreshCw size={14} /> Прослушать
                  </button>
                )}
              </div>
            </div>

            <div className="form-group">
              <label>Перевод (Back)</label>
              <textarea 
                value={editingCard?.back || ''} 
                onChange={e => setEditingCard({...editingCard, back: e.target.value})}
              />
            </div>

            <div className="form-group">
              <label>Контекст</label>
              <textarea 
                value={editingCard?.context || ''} 
                onChange={e => setEditingCard({...editingCard, context: e.target.value})}
              />
            </div>

            <div className="form-group">
              <label>Изображение</label>
              <div className="image-edit-tools">
                <a 
                  href={`https://www.google.com/search?q=${encodeURIComponent(editingCard?.front || '')}&tbm=isch`} 
                  target="_blank" 
                  rel="noreferrer"
                  className="btn-secondary btn-small"
                >
                  🔍 Поиск в Google
                </a>
                <input 
                  type="text" 
                  placeholder="URL картинки..." 
                  value={editingCard?.image_path || ''}
                  onChange={e => setEditingCard({...editingCard, image_path: e.target.value})}
                />
              </div>
            </div>

            <button className="btn btn-primary btn-full" onClick={saveCard} disabled={loading}>
              {loading ? <RefreshCw className="spin" /> : 'Сохранить'}
            </button>
          </div>
        </motion.div>
      </div>

      <AnimatePresence>
        {isSettingsOpen && (
          <div className="settings-overlay" onClick={() => setIsSettingsOpen(false)}>
            <motion.div initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 50 }} className="settings-modal wide-modal" onClick={e => e.stopPropagation()}>
              <div className="settings-header">
                <h2>Настройки</h2>
                <button className="close-btn" onClick={() => setIsSettingsOpen(false)}><X size={24} /></button>
              </div>

              <div className="settings-tabs">
                <button className={`tab-btn ${activeSettingsTab === 'general' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('general')}>Общие</button>
                <button className={`tab-btn ${activeSettingsTab === 'voice' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('voice')}>Озвучка</button>
                <button className={`tab-btn ${activeSettingsTab === 'ai' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('ai')}>Провайдеры</button>
                <button className={`tab-btn ${activeSettingsTab === 'prompts' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('prompts')}>Промпты</button>
                <button className={`tab-btn ${activeSettingsTab === 'presets' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('presets')}>Пресеты</button>
                {isAdmin && <button className={`tab-btn ${activeSettingsTab === 'community' ? 'active' : ''}`} onClick={fetchCommunityDecks}>Сообщество</button>}
              </div>

              <div className="settings-content scrollable">
                <AnimatePresence mode="wait">
                  {activeSettingsTab === 'general' && (
                    <motion.div key="general" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="settings-section">
                      <h3>Обучение</h3>
                      <div className="settings-row">
                        <span>Авто-звук</span>
                        <label className="switch"><input type="checkbox" checked={autoPlay} onChange={e => setAutoPlay(e.target.checked)} /><span className="slider"></span></label>
                      </div>
                      <div className="settings-row">
                        <span>Авто-показ</span>
                        <label className="switch"><input type="checkbox" checked={autoShow} onChange={e => setAutoShow(e.target.checked)} /><span className="slider"></span></label>
                      </div>
                      <div className="settings-debug-info">
                        <p>User ID: <code>{USER_ID}</code></p>
                        <p>Platform: <code>{window.Telegram?.WebApp?.platform || 'Web'}</code></p>
                      </div>
                    </motion.div>
                  )}

                  {activeSettingsTab === 'voice' && (
                    <motion.div key="voice" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="settings-section">
                      <h3>Синтез речи</h3>
                      <div className="form-group">
                        <label>Голос (Edge TTS)</label>
                        <select value={adminSettings.TTS_VOICE} onChange={e => setAdminSettings({...adminSettings, TTS_VOICE: e.target.value})}>
                          {VOICE_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <div className="label-with-value">
                          <label>Скорость</label>
                          <span className="value-badge">{adminSettings.TTS_SPEED || "+0%"}</span>
                        </div>
                        <input 
                          type="range" 
                          min="-50" 
                          max="100" 
                          step="5"
                          value={parseInt((adminSettings.TTS_SPEED || "+0%").replace('%', ''))} 
                          onChange={e => {
                            const val = parseInt(e.target.value);
                            const speed = val >= 0 ? `+${val}%` : `${val}%`;
                            setAdminSettings({...adminSettings, TTS_SPEED: speed});
                          }} 
                        />
                        <div className="range-labels">
                          <span>Медленно</span>
                          <span>Норм</span>
                          <span>Быстро</span>
                        </div>
                      </div>
                      <button className="btn btn-primary btn-small" onClick={saveAdminSettings}>Сохранить настройки голоса</button>
                    </motion.div>
                  )}

                  {activeSettingsTab === 'ai' && (
                    <motion.div key="ai" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="settings-section admin-section">
                      <h3>Настройки ИИ</h3>
                      <div className="form-group">
                        <label>Провайдер</label>
                        <select value={adminSettings.AI_PROVIDER} onChange={e => {
                          setAdminSettings({...adminSettings, AI_PROVIDER: e.target.value, DEFAULT_MODEL: ''});
                          setAvailableModels([]);
                        }}>
                          <option value="ollama">Ollama (Локально)</option>
                          <option value="openrouter">OpenRouter (Облако)</option>
                        </select>
                      </div>
                      {adminSettings.AI_PROVIDER === 'ollama' ? (
                        <div className="form-group">
                          <label>Ollama URL</label>
                          <input value={adminSettings.OLLAMA_URL} onChange={e => setAdminSettings({...adminSettings, OLLAMA_URL: e.target.value})} placeholder="http://localhost:11434" />
                        </div>
                      ) : (
                        <div className="form-group">
                          <label>OpenRouter API Key</label>
                          <input type="password" value={adminSettings.API_KEY || adminSettings.OPENROUTER_KEY} onChange={e => setAdminSettings({...adminSettings, API_KEY: e.target.value})} placeholder="sk-or-..." />
                        </div>
                      )}
                      
                      <div className="form-group">
                        <div className="label-with-value">
                          <label>Модель</label>
                          <button className="btn-secondary btn-tiny" onClick={fetchModels} disabled={isFetchingModels}>
                            {isFetchingModels ? '...' : <RefreshCw size={12} />}
                          </button>
                        </div>
                        <div className="model-select-group">
                          <select 
                            value={availableModels.includes(adminSettings.DEFAULT_MODEL) ? adminSettings.DEFAULT_MODEL : 'custom'} 
                            onChange={e => {
                              if (e.target.value !== 'custom') {
                                setAdminSettings({...adminSettings, DEFAULT_MODEL: e.target.value});
                              }
                            }}
                          >
                            <option value="">Выберите модель...</option>
                            {availableModels.map(m => <option key={m} value={m}>{m}</option>)}
                            <option value="custom">-- Ввести вручную --</option>
                          </select>
                          {( !availableModels.includes(adminSettings.DEFAULT_MODEL) || adminSettings.DEFAULT_MODEL === '' ) && (
                            <input 
                              style={{marginTop: '8px'}}
                              value={adminSettings.DEFAULT_MODEL} 
                              onChange={e => setAdminSettings({...adminSettings, DEFAULT_MODEL: e.target.value})} 
                              placeholder="Название модели вручную..." 
                            />
                          )}
                        </div>
                      </div>
                      <button className="btn btn-primary btn-small" onClick={saveAdminSettings}>Сохранить конфиг ИИ</button>
                    </motion.div>
                  )}

                  {activeSettingsTab === 'prompts' && (
                    <motion.div key="prompts" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="settings-section">
                      <h3>Промпты генерации</h3>
                      <div className="form-group">
                        <label>Системные инструкции</label>
                        <p className="field-hint">Определяют стиль перевода и глубину анализа</p>
                        <textarea 
                          value={userPrompts.translation_prompt} 
                          onChange={e => setUserPrompts({...userPrompts, translation_prompt: e.target.value})} 
                          rows={8} 
                          placeholder="You are a language teacher..."
                        />
                      </div>
                      <button className="btn btn-primary btn-small" onClick={saveUserPrompts}>Сохранить промпты</button>
                    </motion.div>
                  )}

                  {activeSettingsTab === 'presets' && (
                    <motion.div key="presets" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="settings-section">
                      <h3>Управление пресетами</h3>
                      <div className="preset-save-box glass">
                        <input 
                          placeholder="Имя нового пресета..." 
                          value={newPresetName} 
                          onChange={e => setNewPresetName(e.target.value)} 
                        />
                        <button className="btn btn-primary btn-small" onClick={saveCurrentAsPreset}>Сохранить текущие</button>
                      </div>
                      
                      <div className="presets-list scrollable">
                        {presets.length === 0 ? <p className="hint">Нет сохраненных пресетов</p> : 
                          presets.map((p, idx) => (
                            <div key={idx} className="preset-item glass">
                              <div className="preset-info">
                                <strong>{p.name}</strong>
                                <span>{p.settings?.AI_PROVIDER} | {p.settings?.DEFAULT_MODEL?.split('/').pop()}</span>
                              </div>
                              <div className="preset-actions">
                                <button className="apply-btn" onClick={() => applyPreset(p)}>Применить</button>
                                <button className="delete-btn-minimal" onClick={() => deletePreset(idx)}><Trash2 size={14} /></button>
                              </div>
                            </div>
                          ))
                        }
                      </div>
                    </motion.div>
                  )}

                  {activeSettingsTab === 'community' && (
                    <motion.div key="community" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="settings-section">
                      <h3>Колоды пользователей</h3>
                      <p className="field-hint">Одобряйте колоды, чтобы добавить их в общую библиотеку Lerne</p>
                      
                      <div className="community-list scrollable">
                        {communityDecks.length === 0 ? <p className="hint">Новых колод пока нет</p> : 
                          communityDecks.map((d) => (
                            <div key={d.id} className="community-item glass">
                              <div className="community-info">
                                <strong>{d.name}</strong>
                                <span>Пользователь: {d.user_id} | Карточек: {d.card_count}</span>
                                {d.topic && <span className="tag">{d.topic}</span>}
                              </div>
                              <button className="btn btn-primary btn-small" onClick={() => promoteDeck(d.id)}>
                                В Библиотеку
                              </button>
                            </div>
                          ))
                        }
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isOpeningDeck && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="loading-overlay-global"
          >
            <div className="loading-content">
              <RefreshCw size={48} className="spin" color="#a855f7" />
              <p>Загрузка данных...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
