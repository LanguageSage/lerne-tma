import React, { useRef, useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import './App.css';

// Utils & Services
import { getUserId, storage } from './utils/auth';
import api from './services/api';
import { useAudio } from './hooks/useAudio';

// Components
import { Toast } from './components/common/Toast';
import { GlobalLoader } from './components/common/Loader';
import { DeckGrid } from './components/DeckGrid';
import { StudyView } from './components/StudyView';
import { CardList } from './components/CardList';
import { CardEditor } from './components/CardEditor';
import { CardCreator } from './components/CardCreator';
import { DeckModals } from './components/DeckModals';
import { SettingsModal } from './components/SettingsModal';
import { SyncModal } from './components/SyncModal';
import { TutorialOverlay } from './components/TutorialOverlay';
import { TUTORIAL_STEPS, DESIGN_PRESETS } from './constants/appConstants';
import { useSettingsStore } from './store/useSettingsStore';


const USER_ID = getUserId();
const SETTINGS_VERSION = 'v3';

function App() {
  const [view, setView] = useState('decks'); // 'decks' | 'study' | 'cards' | 'editor'
  const [decks, setDecks] = useState([]);
  const [currentDeck, setCurrentDeck] = useState(null);
  const [card, setCard] = useState(null);
  const [deckCards, setDeckCards] = useState([]);
  const [editingCard, setEditingCard] = useState(null);

  const [isFlipped, setIsFlipped] = useState(false);
  const [studyHistory, setStudyHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [apiError, setApiError] = useState(null);

  const {
    autoPlay, setAutoPlay,
    autoShow, setAutoShow,
    cardBgFront, setCardBgFront,
    cardBgBack, setCardBgBack,
    cardFont, setCardFont,
    cardTextColor, setCardTextColor,
    cardFontSize, setCardFontSize,
    contextFont, setContextFont,
    contextTextColor, setContextTextColor,
    contextFontSize, setContextFontSize,
    cardTextShadow, setCardTextShadow,
    contextTextShadow, setContextTextShadow,
    cardFontWeight, setCardFontWeight,
    cardFontStyle, setCardFontStyle,
    contextFontWeight, setContextFontWeight,
    contextFontStyle, setContextFontStyle,
    adminSettings, setAdminSettings,
    userPrompts, setUserPrompts,
    applyDesignPreset,
  } = useSettingsStore();

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isNewDeckModalOpen, setIsNewDeckModalOpen] = useState(false);
  const [deckModalMode, setDeckModalMode] = useState('choice'); 
  const [isOpeningDeck, setIsOpeningDeck] = useState(false);
  const [newDeckName, setNewDeckName] = useState('');
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [deckToSync, setDeckToSync] = useState(null);
  
  const [aiInputPhrase, setAiInputPhrase] = useState('');
  const [isAiWizardOpen, setIsAiWizardOpen] = useState(false);
  const [editorSourceView, setEditorSourceView] = useState('cards');
  const [activeSettingsTab, setActiveSettingsTab] = useState('general');
  const [availableModels, setAvailableModels] = useState([]);
  const [presets, setPresets] = useState([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [customBackgrounds, setCustomBackgrounds] = useState([]);
  
  const [activeTutorial, setActiveTutorial] = useState(null);
  
  const [externalDecks, setExternalDecks] = useState([]);
  const [communityDecks, setCommunityDecks] = useState([]);
  const [isImportLoading, setIsImportLoading] = useState(false);
  const gradingRef = useRef(false);

  const showToast = React.useCallback((message, type = "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const { playAudio, preloadAudio } = useAudio(autoPlay, showToast);

  useEffect(() => {
    fetchInitData();
    const params = new URLSearchParams(window.location.search);
    if (params.get('admin') === '1' || USER_ID === 642478257) setIsAdmin(true);
    
    // Migration to v4 (Comfortaa + Yellow + Glow + Liquid Morning)
    const currentVersion = storage.get('lerne_settings_version');
    if (currentVersion !== '4') {
      console.log("Migrating settings to v4...");
      const defaultSettings = DESIGN_PRESETS.find(p => p.id === 'lerne_2026')?.settings;
      if (defaultSettings) {
        applyDesignPreset({ name: 'Lerne 2026', settings: defaultSettings });
      }
      storage.set('lerne_settings_version', '4');
    }
  }, []);

  useEffect(() => {
    if (isSettingsOpen && isAdmin) {
      fetchPresets();
    }
  }, [isSettingsOpen, isAdmin]);

  useEffect(() => {
    if (isNewDeckModalOpen) {
      setDeckModalMode('choice');
      setIsImportLoading(false);
    }
  }, [isNewDeckModalOpen]);

  useEffect(() => {
    if (card?.audio_url) {
      preloadAudio(card.audio_url);
    }
  }, [card?.id, card?.audio_url, preloadAudio]);

  useEffect(() => {
    if (card && card.audio_url && autoPlay) {
      const timer = setTimeout(() => playAudio(card.audio_url), 150);
      return () => clearTimeout(timer);
    }
  }, [card?.id, autoPlay, playAudio]);

  useEffect(() => {
    if (card && autoShow && !isFlipped) {
      const delay = card.audio_url && autoPlay ? 3000 : 2000;
      const timer = setTimeout(() => {
        setIsFlipped(true);
      }, delay);
      return () => clearTimeout(timer);
    }
  }, [card?.id, autoShow, isFlipped, autoPlay]);

  useEffect(() => {
    let context = view;
    if (isSettingsOpen) context = 'settings';
    
    // Специальная логика для обучения (лицо / оборот)
    if (context === 'study' && card) {
      if (isFlipped) {
        context = 'study_back';
      }
      // Если карточка не перевернута, оставляем context = 'study'
    }

    if (context === 'decks' || context === 'settings' || context === 'study' || context === 'study_back') {
      const seen = storage.get(`lerne_tut_seen_${context}`);
      if (!seen) {
        // Небольшая задержка, чтобы UI успел отрисоваться
        const timer = setTimeout(() => setActiveTutorial(context), 500);
        return () => clearTimeout(timer);
      }
    }
  }, [view, isSettingsOpen, !!card, isFlipped]);

  const finishTutorial = (context) => {
    console.log("Finishing tutorial for:", context);
    storage.set(`lerne_tut_seen_${context}`, 'true');
    setActiveTutorial(null);
  };

  const startTutorial = (context) => {
    console.log("Starting tutorial for:", context);
    // window.alert("Запуск туториала для: " + context); // Раскомментируй если хочешь проверить вызов
    storage.remove(`lerne_tut_seen_${context}`);
    setActiveTutorial(null);
    setTimeout(() => {
      setActiveTutorial(context);
    }, 100);
  };

  // --- API Functions ---
  const fetchInitData = async () => {
    setLoading(true);
    try {
      const res = await api.get('/init');
      setDecks(res.data.decks);
      setAdminSettings(res.data.settings);
      setUserPrompts(res.data.prompts);
      fetchCustomBackgrounds();
    } catch (err) {
      console.error("Init Data Error:", err);
      showToast("Ошибка загрузки данных.");
    }
    setLoading(false);
  };

  const fetchDecks = async (force = false) => {
    if (!force && decks.length > 0) return;
    setLoading(true);
    try {
      const res = await api.get('/decks');
      setDecks(res.data);
    } catch (err) { 
      console.error("Fetch Decks Error:", err);
      showToast("Не удалось загрузить колоды.");
    }
    setLoading(false);
  };

  const handleResetProgress = async (deckId) => {
    if (!window.confirm("Это сбросит весь прогресс обучения по этой колоде. Вы уверены?")) return;
    setLoading(true);
    try {
      await api.post(`/decks/${deckId}/reset`);
      showToast("Прогресс сброшен", "success");
      fetchDecks(true);
      if (view === 'study') startStudy(currentDeck);
    } catch (err) {
      showToast("Ошибка при сбросе");
    }
    setLoading(false);
  };

  const openSyncModal = (deck) => {
    setDeckToSync(deck);
    setSyncModalOpen(true);
  };

  const handleSyncDeck = async (deckId, mode = 'merge') => {
    setLoading(true);
    showToast("Синхронизация...");
    try {
      await api.post(`/decks/${deckId}/sync`, { mode });
      showToast("Колода обновлена", "success");
      setSyncModalOpen(false);
      setDeckToSync(null);
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

  const prefetchMedia = (url) => {
    if (!url) return;
    const img = new Image();
    img.src = url;
  };

  const fetchNextCard = async (deckId, isFirst = false, excludeIds = []) => {
    setLoading(true);
    setApiError(null);
    try {
      const excludeParam = excludeIds.length > 0 ? `?exclude_ids=${excludeIds.join(',')}` : '';
      const res = await api.get(`/decks/${deckId}/next${excludeParam}`);
      
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

  const submitGrade = async (grade) => {
    if (!card || gradingRef.current) return;
    gradingRef.current = true;
    
    // Оптимистичное обновление: сразу убираем ответ, показываем загрузку
    setIsFlipped(false);
    setLoading(true);
    
    try {
      const gradedCardId = card.id;
      const res = await api.post('/study/grade', {
        card_id: gradedCardId,
        deck_id: currentDeck.id,
        grade
      });
      
      if (res.data.finished) {
        setCard(null);
      } else {
        const nextCard = res.data;
        setStudyHistory(prev => [...prev, nextCard]);
        setHistoryIndex(prev => prev + 1);
        setCard(nextCard);
        prefetchMedia(nextCard.image_url);
      }
    } catch (err) { 
      console.error("SubmitGrade Error:", err);
      showToast(`Ошибка при сохранении оценки: ${err.response?.data?.detail || err.message}`);
    } finally {
      gradingRef.current = false;
      setLoading(false);
    }
  };

  const goBack = () => {
    if (historyIndex > 0) {
      const prevIndex = historyIndex - 1;
      setHistoryIndex(prevIndex);
      setCard(studyHistory[prevIndex]);
      setIsFlipped(false);
    }
  };

  const goNext = () => {
    if (historyIndex < studyHistory.length - 1) {
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
      setCard(studyHistory[nextIndex]);
      setIsFlipped(false);
    } else {
      const excludeIds = studyHistory.map(c => c.id);
      setTimeout(() => fetchNextCard(currentDeck.id, false, excludeIds), 50);
    }
  };

  const fetchDeckCards = async (deckId) => {
    setIsOpeningDeck(true);
    try {
      const res = await api.get(`/decks/${deckId}/cards`);
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
        const parts = p.split('/');
        return parts.slice(3).join('/');
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
    const hasRussian = /[а-яА-Я]/.test(c.front);
    const textToSpeak = hasRussian ? c.back : c.front;
    
    if (!textToSpeak) {
      showToast("Нет текста для озвучки");
      setLoading(false);
      return;
    }

    try {
      const res = await api.post('/media/generate-audio', {
        text: textToSpeak,
        lang: 'de',
        voice: voice,
        rate: rate
      });
      const newAudioPath = res.data.path;
      
      await api.post('/cards/save', {
        card_id: c.id,
        deck_id: c.deck_id,
        front: c.front,
        back: c.back,
        context: c.context,
        image_path: c.image_url || c.image_path || '',
        audio_path: newAudioPath
      });
      
      setCard({ ...c, audio_url: res.data.url, audio_path: res.data.path });
      showToast("Озвучка добавлена!", "success");
      playAudio(res.data.url);
    } catch (err) {
      console.error(err);
      showToast(`Ошибка генерации: ${err.response?.data?.detail || err.message}`, "error");
    }
    setLoading(false);
  };

  const saveCard = async (manualCardData = null) => {
    const data = manualCardData || editingCard;
    if (!data || !data.front || !data.back) {
      showToast("Заполните текст и перевод");
      return;
    }

    setLoading(true);
    try {
      const reqData = {
        card_id: data.id || null,
        deck_id: data.deck_id || currentDeck?.id || null,
        front: data.front,
        back: data.back,
        context: data.context || '',
        image_path: data.image_path || '',
        audio_path: data.audio_path || ''
      };

      await api.post('/cards/save', reqData);
      showToast("Сохранено", "success");
      
      if (view === 'creator') {
        fetchDeckCards(currentDeck.id);
        setView('cards');
        return;
      }

      if (editorSourceView === 'study') {
        if (card && card.id === data.id) {
          const resolvedAudio = data.audio_path?.includes('/') 
            ? `/api/media/${data.audio_path}` 
            : card.audio_url;
            
          setCard({ 
            ...card, 
            ...data,
            image_url: data.image_path?.includes('/') ? `/api/media/images/${data.image_path.split('/').pop()}` : card.image_url,
            audio_url: resolvedAudio
          });
        }
        setView('study');
      } else if (editorSourceView === 'cards') {
        fetchDeckCards(data.deck_id || currentDeck?.id);
        setView('cards');
      } else {
        fetchDecks(true);
        setView('decks');
      }
    } catch (err) {
      console.error(err);
      showToast("Ошибка сохранения");
    } finally {
      setLoading(false);
    }
  };

  const generateAudio = async () => {
    if (!editingCard.front) return;
    setLoading(true);
    const voice = adminSettings.TTS_VOICE || 'de-DE-KatjaNeural';
    const rate = adminSettings.TTS_SPEED || '+0%';
    const hasRussian = /[а-яА-Я]/.test(editingCard.front);
    const textToSpeak = hasRussian ? editingCard.back : editingCard.front;

    if (!textToSpeak) {
      showToast("Заполните текст для озвучки");
      setLoading(false);
      return;
    }

    try {
      const res = await api.post('/media/generate-audio', {
        text: textToSpeak,
        lang: 'de',
        voice: voice,
        rate: rate
      });
      setEditingCard({ 
        ...editingCard, 
        audio_path: res.data.path,
        audio_url: res.data.url 
      });
      showToast("Аудио сгенерировано", "success");
      playAudio(res.data.url);
    } catch (err) {
      console.error(err);
      showToast(`Ошибка генерации аудио: ${err.response?.data?.detail || err.message}`);
    }
    setLoading(false);
  };

  const uploadImageFile = async (file) => {
    if (!file) return;
    if (!file.type?.startsWith('image/')) {
      showToast("Выберите файл изображения");
      return null;
    }

    const formData = new FormData();
    formData.append('file', file);
    const res = await api.post('/media/upload-image', formData);
    return res.data;
  };

  const uploadImage = async (file) => {
    if (!file) return;
    setLoading(true);
    try {
      const uploaded = await uploadImageFile(file);
      if (uploaded) {
        setEditingCard({
          ...editingCard,
          image_path: uploaded.path,
          image_url: uploaded.url
        });
        showToast("Картинка добавлена", "success");
      }
    } catch (err) {
      console.error(err);
      showToast(`Ошибка загрузки картинки: ${err.response?.data?.detail || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const uploadStudyImage = async (file, targetCard) => {
    if (!file || !targetCard || !currentDeck?.id) return;
    setLoading(true);
    try {
      const uploaded = await uploadImageFile(file);
      if (uploaded) {
        await api.post('/cards/save', {
          card_id: targetCard.id,
          deck_id: currentDeck.id,
          front: targetCard.front,
          back: targetCard.back,
          context: targetCard.context,
          image_path: uploaded.path,
          audio_path: targetCard.audio_path || ''
        });

        setCard({
          ...targetCard,
          image_path: uploaded.path,
          image_url: uploaded.url
        });
        prefetchMedia(uploaded.url);
        showToast("Картинка добавлена", "success");
      }
    } catch (err) {
      console.error(err);
      showToast(`Ошибка загрузки картинки: ${err.response?.data?.detail || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchUserPrompts = async () => {
    try {
      const res = await api.get('/user/prompts');
      setUserPrompts(res.data);
    } catch (err) { console.error(err); }
  };

  const saveUserPrompts = async () => {
    try {
      await api.post('/user/prompts', userPrompts);
      showToast("Промпты сохранены", "success");
    } catch (err) { console.error(err); showToast("Ошибка сохранения", "error"); }
  };

  const fetchAdminSettings = async () => {
    try {
      const res = await api.get('/admin/settings?admin_key=1');
      setAdminSettings(res.data);
    } catch (err) { console.error(err); }
  };

  const saveAdminSettings = async () => {
    try {
      // Отправляем настройки как есть, без лишнего маппинга
      const res = await api.post('/admin/settings?admin_key=1', adminSettings);
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

  const fetchCustomBackgrounds = async () => {
    try {
      const res = await api.get('/media/backgrounds');
      setCustomBackgrounds(res.data);
    } catch (err) { console.error("Error fetching backgrounds:", err); }
  };

  const uploadCustomBackground = async (file) => {
    if (!file) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post('/media/upload-background', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      showToast("Фон загружен", "success");
      fetchCustomBackgrounds();
      return res.data;
    } catch (err) {
      console.error(err);
      showToast(`Ошибка загрузки фона: ${err.response?.data?.detail || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const uploadCardVideo = async (file, targetCard, side = 'back') => {
    if (!file || !targetCard || !currentDeck?.id) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const uploaded = await api.post('/media/upload-video', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      if (uploaded.data) {
        const fieldName = side === 'front' ? 'video_front_path' : 'video_back_path';
        const urlName = side === 'front' ? 'video_front_url' : 'video_back_url';
        
        await api.post('/cards/save', {
          card_id: targetCard.id,
          deck_id: currentDeck.id,
          front: targetCard.front,
          back: targetCard.back,
          context: targetCard.context,
          image_path: targetCard.image_path || '',
          audio_path: targetCard.audio_path || '',
          video_front_path: side === 'front' ? uploaded.data.path : (targetCard.video_front_path || ''),
          video_back_path: side === 'back' ? uploaded.data.path : (targetCard.video_back_path || '')
        });

        setCard({
          ...targetCard,
          [fieldName]: uploaded.data.path,
          [urlName]: uploaded.data.url
        });
        showToast(`Видео (${side === 'front' ? 'лицо' : 'оборот'}) добавлено`, "success");
      }
    } catch (err) {
      console.error(err);
      showToast(`Ошибка загрузки видео: ${err.response?.data?.detail || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchModels = async () => {
    const provider = adminSettings.AI_PROVIDER;
    if (!provider) return;
    
    setIsFetchingModels(true);
    try {
      let url = `/admin/models/${provider}`;
      if (provider === 'ollama') {
        url += `?url=${encodeURIComponent(adminSettings.OLLAMA_URL || 'http://localhost:11434')}`;
      }
      const res = await api.get(url);
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
      const res = await api.get('/admin/presets');
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
      await api.post('/admin/presets', newPresets);
      setPresets(newPresets);
      setNewPresetName('');
      showToast("Preset сохранен");
    } catch (err) { console.error(err); showToast("Ошибка сохранения пресета"); }
  };

  const applyPreset = (preset) => {
    setAdminSettings({ ...adminSettings, ...preset.settings });
    showToast(`Применен пресет: ${preset.name}`);
  };

  const deletePreset = async (index) => {
    const newPresets = presets.filter((_, i) => i !== index);
    try {
      await api.post('/admin/presets', newPresets);
      setPresets(newPresets);
    } catch (err) { console.error(err); showToast("Ошибка удаления"); }
  };

  const createDeck = async () => {
    if (!newDeckName) return;
    setLoading(true);
    try {
      await api.post('/decks', { name: newDeckName });
      setNewDeckName('');
      setIsNewDeckModalOpen(false);
      setDeckModalMode('choice');
      fetchDecks(true);
      showToast("Колода создана");
    } catch (err) { console.error(err); showToast("Ошибка создания"); }
    setLoading(false);
  };

  const resetDesign = () => {
    const defaultSettings = DESIGN_PRESETS.find(p => p.id === 'lerne_2026')?.settings;
    if (defaultSettings) {
      applyDesignPreset({ name: 'Lerne 2026', settings: defaultSettings });
      showToast("Дизайн сброшен к стандарту", "success");
    }
  };

  const handleDeleteDeck = (e, deckId) => {
    e.stopPropagation();
    if (!window.confirm("Вы уверены, что хотите полностью удалить эту колоду и весь прогресс?")) return;
    
    setLoading(true);
    api.delete(`/decks/${deckId}`)
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
    api.delete(`/cards/${cardId}`)
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
      const res = await api.get('/decks/external');
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
        
        await api.post('/decks/import-json', jsonData);
        
        setIsNewDeckModalOpen(false);
        fetchDecks(true);
        showToast("Колода импортирована!", "success");
      } catch (err) {
        console.error("File import error:", err);
        showToast("Ошибка импорта: неверный формат файла");
      }
      setLoading(false);
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  const importDeck = async (deckId) => {
    setIsOpeningDeck(true);
    try {
      await api.post(`/decks/external/import/${deckId}`);
      
      setIsNewDeckModalOpen(false);
      setDeckModalMode('choice');
      
      await fetchDecks(true);
      showToast("Колода успешно импортирована!", "success");
      
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
      const res = await api.get('/admin/community/decks');
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
      await api.post(`/admin/community/promote/${deckId}`);
      showToast("Колода добавлена в библиотеку!", "success");
      fetchCommunityDecks();
    } catch (err) {
      showToast("Ошибка при вливании колоды");
    }
    setLoading(false);
  };

  const openCreator = (deckId) => {
    const deck = decks.find(d => d.id === deckId);
    if (deck) {
      setCurrentDeck(deck);
      setView('creator');
    }
  };

  const runAiGenerator = async (overridePhrase = null, returnResult = false) => {
    const phrase = overridePhrase || aiInputPhrase;
    if (!phrase) return;
    
    setLoading(true);
    try {
      const res = await api.post('/cards/ai-generate', { phrase });
      
      if (res.data.error) {
        showToast(`Ошибка ИИ: ${res.data.error}`);
        setLoading(false);
        return null;
      }
      
      if (returnResult) {
        setLoading(false);
        return res.data;
      }

      setEditingCard({
        ...editingCard,
        front: res.data.front || editingCard.front,
        back: res.data.back || editingCard.back,
        context: res.data.context || editingCard.context
      });
      setIsAiWizardOpen(false);
      showToast("Готово! Проверьте поля.", "success");
      
    } catch (err) { 
      console.error(err); 
      showToast(`Ошибка ИИ: ${err.response?.data?.detail || err.message}`); 
    }
    setLoading(false);
    return null;
  };

  return (
    <div className="app-container">
      <DeckGrid
        view={view}
        decks={decks}
        loading={loading}
        userId={USER_ID}
        setIsNewDeckModalOpen={setIsNewDeckModalOpen}
        setIsSettingsOpen={setIsSettingsOpen}
        fetchDecks={fetchDecks}
        startStudy={startStudy}
        setCurrentDeck={setCurrentDeck}
        fetchDeckCards={fetchDeckCards}
        handleSyncDeck={handleSyncDeck}
        handleResetProgress={handleResetProgress}
        handleDeleteDeck={handleDeleteDeck}
        showToast={showToast}
        openSyncModal={openSyncModal}
        startTutorial={startTutorial}
      />

      <StudyView
        view={view}
        currentDeck={currentDeck}
        card={card}
        loading={loading}
        isFlipped={isFlipped}
        setIsFlipped={setIsFlipped}
        studyHistory={studyHistory}
        historyIndex={historyIndex}
        apiError={apiError}
        setView={setView}
        setCard={setCard}
        openEditor={openEditor}
        openCreator={openCreator}
        uploadStudyImage={uploadStudyImage}
        uploadCardVideo={uploadCardVideo}
        handleQuickAudio={handleQuickAudio}
        playAudio={playAudio}
        submitGrade={submitGrade}
        goBack={goBack}
        goNext={goNext}
        handleSyncDeck={handleSyncDeck}
        handleResetProgress={handleResetProgress}
        setIsSettingsOpen={setIsSettingsOpen}
        startTutorial={startTutorial}
        cardBgFront={cardBgFront}
        cardBgBack={cardBgBack}
        cardFont={cardFont}
        cardTextColor={cardTextColor}
        cardFontSize={cardFontSize}
        contextFont={contextFont}
        contextTextColor={contextTextColor}
        contextFontSize={contextFontSize}
        cardTextShadow={cardTextShadow}
        contextTextShadow={contextTextShadow}
        cardFontWeight={cardFontWeight}
        cardFontStyle={cardFontStyle}
        contextFontWeight={contextFontWeight}
        contextFontStyle={contextFontStyle}
      />

      <DeckModals
        isNewDeckModalOpen={isNewDeckModalOpen}
        setIsNewDeckModalOpen={setIsNewDeckModalOpen}
        deckModalMode={deckModalMode}
        setDeckModalMode={setDeckModalMode}
        newDeckName={newDeckName}
        setNewDeckName={setNewDeckName}
        createDeck={createDeck}
        loading={loading}
        fetchExternalDecks={fetchExternalDecks}
        isImportLoading={isImportLoading}
        handleFileUpload={handleFileUpload}
        externalDecks={externalDecks}
        importDeck={importDeck}
      />

      <CardList
        view={view}
        currentDeck={currentDeck}
        deckCards={deckCards}
        setView={setView}
        openEditor={openEditor}
        openCreator={openCreator}
        handleDeleteCard={handleDeleteCard}
      />

      <CardCreator
        view={view}
        setView={setView}
        currentDeck={currentDeck}
        runAiGenerator={runAiGenerator}
        saveCard={saveCard}
        loading={loading}
        cardFont={cardFont}
        cardTextColor={cardTextColor}
        cardFontWeight={cardFontWeight}
        cardFontStyle={cardFontStyle}
      />

      <CardEditor
        view={view}
        editorSourceView={editorSourceView}
        setView={setView}
        editingCard={editingCard}
        setEditingCard={setEditingCard}
        isAiWizardOpen={isAiWizardOpen}
        setIsAiWizardOpen={setIsAiWizardOpen}
        aiInputPhrase={aiInputPhrase}
        setAiInputPhrase={setAiInputPhrase}
        runAiGenerator={runAiGenerator}
        generateAudio={generateAudio}
        uploadImage={uploadImage}
        uploadCardVideo={uploadCardVideo}
        playAudio={playAudio}
        saveCard={saveCard}
        loading={loading}
        cardFont={cardFont}
        cardTextColor={cardTextColor}
        cardFontWeight={cardFontWeight}
        cardFontStyle={cardFontStyle}
        contextFont={contextFont}
        contextTextColor={contextTextColor}
        contextFontWeight={contextFontWeight}
        contextFontStyle={contextFontStyle}
      />

      <SettingsModal
        isSettingsOpen={isSettingsOpen}
        setIsSettingsOpen={setIsSettingsOpen}
        activeSettingsTab={activeSettingsTab}
        setActiveSettingsTab={setActiveSettingsTab}
        isAdmin={isAdmin}
        userId={USER_ID}
        saveAdminSettings={saveAdminSettings}
        availableModels={availableModels}
        fetchModels={fetchModels}
        isFetchingModels={isFetchingModels}
        saveUserPrompts={saveUserPrompts}
        newPresetName={newPresetName}
        setNewPresetName={setNewPresetName}
        saveCurrentAsPreset={saveCurrentAsPreset}
        presets={presets}
        applyPreset={applyPreset}
        deletePreset={deletePreset}
        communityDecks={communityDecks}
        fetchCommunityDecks={fetchCommunityDecks}
        promoteDeck={promoteDeck}
        customBackgrounds={customBackgrounds}
        uploadCustomBackground={uploadCustomBackground}
        startTutorial={startTutorial}
      />

      <SyncModal
        isOpen={syncModalOpen}
        onClose={() => setSyncModalOpen(false)}
        deck={deckToSync}
        onSync={(mode) => handleSyncDeck(deckToSync.id, mode)}
        loading={loading}
      />

      <TutorialOverlay 
        isOpen={!!activeTutorial}
        steps={TUTORIAL_STEPS[activeTutorial] || []}
        onFinish={() => finishTutorial(activeTutorial)}
        onSkip={() => finishTutorial(activeTutorial)}
        isFlipped={isFlipped}
      />

      <Toast toast={toast} />
      <GlobalLoader isVisible={isOpeningDeck} />
    </div>
  );
}

export default App;
