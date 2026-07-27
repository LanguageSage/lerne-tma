import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Heart, Trash2, Folder, Music, ChevronDown, ChevronUp, Pause, Play as PlayIcon } from 'lucide-react';
import DeckAudioPlayer from './common/DeckAudioPlayer';
import api from '../services/api';
import { useUiStore } from '../store/useUiStore';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useLanguageStore } from '../store/useLanguageStore';
import { getTtsVoiceForLang } from '../constants/languageConstants';
import { useCardActions } from '../hooks/useCardActions';
import { useMediaUpload } from '../hooks/useMediaUpload';
import { CardActionButton } from './CardActionModal';
import { useAudio } from '../hooks/useAudio';
import { useAutoplay } from '../hooks/useAutoplay';
import { useCardNavigation } from '../hooks/useCardNavigation';
import { MediaPicker } from './common/MediaPicker';

// Sub-components
import { StudyHeader } from './study/StudyHeader';
import { StudyNavigation } from './study/StudyNavigation';
import { GradeButtons } from './study/GradeButtons';
import { StudyFinished } from './study/StudyFinished';
import { TrainerFinished } from './study/TrainerFinished';
import { StudyCard } from './study/StudyCard';

const OPEN_PICKER_AFTER_GOOGLE = 'lerne_open_picker_after_google';

export const StudyView = ({ startTutorial }) => {
  const { view, setView, loading, setIsSettingsOpen, setActionCard, setIsCardActionModalOpen, showToast } = useUiStore();
  const { currentDeck, handleSyncDeck, handleResetProgress, fetchDuplicates, duplicateCards, deckCards, favoriteCards } = useDeckStore();
  const { card, setCard, isFlipped, setIsFlipped, historyIndex, apiError, setIsLearningMore, autoplayState, favoritesQueue } = useSessionStore();
  const { submitGrade, goBack, goNext, handleQuickAudio, fetchNextCard, handleDeleteCard, handleToggleLearn } = useCardActions();
  const { openEditor, openCreator } = useCardNavigation();
  const { uploadStudyImage } = useMediaUpload();

  const autoPlay = useSettingsStore(s => s.autoPlay);
  const cardBgFront = useSettingsStore(s => s.cardBgFront);
  const cardBgBack = useSettingsStore(s => s.cardBgBack);
  const studyMode = useSettingsStore(s => s.studyMode);
  const setStudyMode = useSettingsStore(s => s.setStudyMode);
  const randomEnabledModes = useSettingsStore(s => s.randomEnabledModes);
  const setRandomEnabledModes = useSettingsStore(s => s.setRandomEnabledModes);
  const autoplayLoop = useSettingsStore(s => s.autoplayLoop);
  const ttsSpeedRu = useSettingsStore(s => s.ttsSpeedRu);
  const adminSettings = useSettingsStore(s => s.adminSettings);
  const cardFont = useSettingsStore(s => s.cardFont);
  const cardTextColor = useSettingsStore(s => s.cardTextColor);
  const cardFontSize = useSettingsStore(s => s.cardFontSize);
  const cardFontWeight = useSettingsStore(s => s.cardFontWeight);
  const cardFontStyle = useSettingsStore(s => s.cardFontStyle);
  const cardTextShadow = useSettingsStore(s => s.cardTextShadow);
  const contextFont = useSettingsStore(s => s.contextFont);
  const contextTextColor = useSettingsStore(s => s.contextTextColor);
  const contextFontSize = useSettingsStore(s => s.contextFontSize);
  const contextFontWeight = useSettingsStore(s => s.contextFontWeight);
  const contextFontStyle = useSettingsStore(s => s.contextFontStyle);
  const contextTextShadow = useSettingsStore(s => s.contextTextShadow);
  const autoplayDelay = useSettingsStore(s => s.autoplayDelay);
  const autoplayScrollBg = useSettingsStore(s => s.autoplayScrollBg);

  const styleSettings = React.useMemo(() => ({
    cardFont, cardTextColor, cardFontSize, cardFontWeight, cardFontStyle, cardTextShadow,
    contextFont, contextTextColor, contextFontSize, contextFontWeight, contextFontStyle, contextTextShadow
  }), [cardFont, cardTextColor, cardFontSize, cardFontWeight, cardFontStyle, cardTextShadow, contextFont, contextTextColor, contextFontSize, contextFontWeight, contextFontStyle, contextTextShadow]);

  const autoplaySettingsObj = React.useMemo(() => ({
    autoplayDelay, autoplayLoop, autoplayScrollBg, autoPlay
  }), [autoplayDelay, autoplayLoop, autoplayScrollBg, autoPlay]);

  const { playAudio, stopAudio, isAudioLoading, startBackgroundLock, stopBackgroundLock } = useAudio(autoPlay, showToast);
  const autoplay = useAutoplay({ card, playAudio, stopAudio, showToast, startBackgroundLock, stopBackgroundLock });
  const isAutoplayActive = autoplayState === 'playing' || autoplayState === 'paused';

  const [isImagePickerOpen, setIsImagePickerOpen] = useState(false);
  const googleReturnTimerRef = useRef(null);
  const previousAutoplayStateRef = useRef(autoplayState);
  const suppressLegacyAutoplayCardRef = useRef(null);
  const lastAutoplayedCardRef = useRef(null);
  const [activeRandomMode, setActiveRandomMode] = useState(null);
  const lastCardKeyRef = useRef('');

  // State for Trainer mode
  const [trainerStartTime, setTrainerStartTime] = useState(null);
  const [trainerCorrectCount, setTrainerCorrectCount] = useState(0);
  const [trainerWrongCardIds, setTrainerWrongCardIds] = useState([]);
  const [trainerAnsweredIds, setTrainerAnsweredIds] = useState(new Set());

  useEffect(() => {
    if (currentDeck?.metadata?.deck_type === 'trainer' && studyMode !== 'trainer') {
      setStudyMode('trainer');
    }
  }, [currentDeck?.id, currentDeck?.metadata?.deck_type]);

  useEffect(() => {
    if (studyMode === 'trainer' && view === 'study') {
      if (!trainerStartTime) {
        setTrainerStartTime(Date.now());
      }
    }
  }, [studyMode, view, currentDeck?.id]);

  const handleTrainerAnswer = (cardId, isFirstTry) => {
    setTrainerAnsweredIds(prev => new Set(prev).add(cardId));
    if (isFirstTry) {
      setTrainerCorrectCount(prev => prev + 1);
    } else {
      setTrainerWrongCardIds(prev => prev.includes(cardId) ? prev : [...prev, cardId]);
    }
  };

  const openCardActions = (targetCard) => {
    setActionCard(targetCard);
    setIsCardActionModalOpen(true);
  };

  const onDeleteDuplicate = async (e) => {
    e.stopPropagation();
    if (window.confirm('Удалить этот дубликат?')) {
      try {
        await handleDeleteCard(card.id, true);
        fetchDuplicates(); // Update the list in background
      } catch (err) {
        showToast('Ошибка при удалении');
      }
    }
  };

  useEffect(() => {
    const wasAutoplayActive = previousAutoplayStateRef.current === 'playing' || previousAutoplayStateRef.current === 'paused';
    if (wasAutoplayActive && autoplayState === 'stopped') {
      suppressLegacyAutoplayCardRef.current = card?.id ?? null;
    }
    previousAutoplayStateRef.current = autoplayState;
  }, [autoplayState, card?.id]);

  useEffect(() => {
    if (suppressLegacyAutoplayCardRef.current && suppressLegacyAutoplayCardRef.current !== card?.id) {
      suppressLegacyAutoplayCardRef.current = null;
    }
  }, [card?.id]);

  useEffect(() => {
    const isSuppressedAfterAutoplay = suppressLegacyAutoplayCardRef.current === card?.id;
    const currentCardKey = `${card?.id}-${historyIndex}`;
    const isAutoplayEnabledMode = studyMode === 'classic' || (studyMode === 'random' && activeRandomMode === 'classic');
    if (view === 'study' && card?.audio_url && autoPlay && isAutoplayEnabledMode && !loading && !isAutoplayActive && !isSuppressedAfterAutoplay && lastAutoplayedCardRef.current !== currentCardKey) {
      lastAutoplayedCardRef.current = currentCardKey;
      const timer = setTimeout(() => {
        playAudio(card.audio_url);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [card?.id, card?.audio_url, historyIndex, autoPlay, view, loading, isAutoplayActive, playAudio, studyMode, activeRandomMode]);

  useEffect(() => {
    if (studyMode === 'random') {
      const currentCardKey = card ? `${card.id}-${historyIndex}` : '';
      const cardChanged = lastCardKeyRef.current !== currentCardKey;
      const enabled = randomEnabledModes || [];
      
      if (cardChanged || !activeRandomMode || !enabled.includes(activeRandomMode)) {
        lastCardKeyRef.current = currentCardKey;
        if (enabled.length > 0) {
          const randomIndex = Math.floor(Math.random() * enabled.length);
          setActiveRandomMode(enabled[randomIndex]);
        } else {
          setActiveRandomMode('classic');
        }
      }
    } else {
      setActiveRandomMode(null);
      lastCardKeyRef.current = '';
    }
  }, [card?.id, historyIndex, studyMode, randomEnabledModes, activeRandomMode]);

  useEffect(() => {
    if (view !== 'study' || !card) return;

    const openPickerAfterGoogle = () => {
      const googleOpenedAt = Number(sessionStorage.getItem(OPEN_PICKER_AFTER_GOOGLE) || 0);
      if (!googleOpenedAt) return;

      const elapsed = Date.now() - googleOpenedAt;
      if (elapsed < 1200) {
        clearTimeout(googleReturnTimerRef.current);
        googleReturnTimerRef.current = setTimeout(openPickerAfterGoogle, 1200 - elapsed);
        return;
      }

      sessionStorage.removeItem(OPEN_PICKER_AFTER_GOOGLE);
      setIsImagePickerOpen(true);
    };

    openPickerAfterGoogle();
    window.addEventListener('focus', openPickerAfterGoogle);
    document.addEventListener('visibilitychange', openPickerAfterGoogle);

    return () => {
      clearTimeout(googleReturnTimerRef.current);
      window.removeEventListener('focus', openPickerAfterGoogle);
      document.removeEventListener('visibilitychange', openPickerAfterGoogle);
    };
  }, [view, card?.id]);

  const availableStyles = ['mesh', 'aurora', 'holographic', 'liquid', 'liquid_sunset', 'liquid_ocean', 'liquid_cosmic', 'liquid_emerald', 'video_aquarium', 'video_space', 'video_nature'];
  const getResolvedStyle = (settingStyle, cardId) => {
    if (settingStyle !== 'auto') return settingStyle;
    if (!cardId) return 'standard';
    const sum = cardId.toString().split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    return availableStyles[sum % availableStyles.length];
  };

  const resolvedBgFront = getResolvedStyle(cardBgFront, card?.id);
  const resolvedBgBack = getResolvedStyle(cardBgBack, card?.id);

  const handleLearnMore = async () => {
    setIsLearningMore(true);
    await fetchNextCard(currentDeck?.id);
  };

  const handleAutoplayAwareBack = async () => {
    stopAudio();
    if (isAutoplayActive) {
      autoplay.cancelCurrent();
      const cards = currentDeck?.id === 'duplicates' ? duplicateCards : deckCards;
      const currentIndex = cards.findIndex(c => c.id === card?.id);
      if (currentIndex > 0) {
        setCard(cards[currentIndex - 1]);
      }
      return;
    }
    await goBack();
  };

  const handleAutoplayAwareNext = async () => {
    stopAudio();
    if (isAutoplayActive) {
      autoplay.cancelCurrent();
      const cards = currentDeck?.id === 'duplicates' ? duplicateCards : deckCards;
      const currentIndex = cards.findIndex(c => c.id === card?.id);
      if (currentIndex < cards.length - 1) {
        setCard(cards[currentIndex + 1]);
      } else if (autoplayLoop && cards.length > 0) {
        setCard(cards[0]);
      }
      return;
    }
    await goNext();
  };

  const formatRate = (value) => `${value >= 0 ? '+' : ''}${value}%`;

  const updateCurrentCardAudio = (cardId, patch) => {
    const session = useSessionStore.getState();
    session.setCard((current) => (
      current?.id === cardId ? { ...current, ...patch } : current
    ));
    session.setStudyHistory(session.studyHistory.map((item) => (
      item?.id === cardId ? { ...item, ...patch } : item
    )));
  };

  const handlePlayBackAudio = async (targetCard) => {
    if (!targetCard?.back) return;

    if (targetCard.audio_back_url) {
      playAudio(targetCard.audio_back_url);
      return;
    }

    try {
      const nativeLang = useLanguageStore.getState().nativeLanguage || 'ru';
      const generated = await api.post('/media/generate-audio', {
        text: targetCard.back,
        lang: nativeLang,
        rate: formatRate(ttsSpeedRu),
        voice: getTtsVoiceForLang(nativeLang, adminSettings)
      });
      const saved = await api.post('/cards/save', {
        card_id: targetCard.id,
        deck_id: targetCard.deck_id || currentDeck?.id,
        audio_back_path: generated.data.path,
        silent: true
      });
      const patch = {
        audio_back_path: saved.data.audio_back_path || generated.data.path,
        audio_back_url: saved.data.audio_back_url || generated.data.url
      };
      updateCurrentCardAudio(targetCard.id, patch);
      playAudio(patch.audio_back_url);
    } catch (err) {
      console.error('Back audio generation failed:', err);
      showToast(`Не удалось сгенерировать перевод: ${err.response?.data?.detail || err.message}`);
    }
  };

  const handleResetProgressConfirmed = async () => {
    if (window.confirm('Вы уверены, что хотите сбросить прогресс этой колоды? Все ваши успехи будут обнулены.')) {
      try {
        await handleResetProgress(currentDeck.id);
        showToast('Прогресс успешно сброшен', 'success');
        useSessionStore.getState().resetSession();
        await fetchNextCard(currentDeck.id);
      } catch (err) {
        showToast('Ошибка при сбросе прогресса');
      }
    }
  };

  if (view !== 'study') return null;

  return (
    <div className="view-study">
      {currentDeck?.id !== 'duplicates' && !isAutoplayActive && studyMode !== 'trainer' && (
        <GradeButtons 
          card={card} 
          loading={loading} 
          onGrade={(grade) => {
            stopAudio();
            submitGrade(grade);
          }} 
        />
      )}

      <motion.div
        key="study"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="view"
      >
        <StudyHeader
          deckName={currentDeck?.name}
          card={card}
          loading={loading}
          isFlipped={isFlipped}
          isAudioLoading={isAudioLoading}
          onBack={() => { 
            autoplay.stop();
            if (currentDeck?.id === 'duplicates') {
              useDeckStore.getState().setLastDuplicateCardId(card?.id);
              setView('duplicates');
            } else {
              if (card?.id) {
                useUiStore.getState().setLastSelectedCardId(card.id);
              }
              setView('cards');
            }
            setCard(null); 
          }}
          onOpenCreator={() => openCreator(currentDeck?.id, 'study')}
          onStartTutorial={() => startTutorial(isFlipped ? 'study_back' : 'study')}
          onQuickAudio={() => handleQuickAudio(card, playAudio)}
          onOpenEditor={() => openEditor(currentDeck?.id === 'duplicates' ? card.deck_id : currentDeck?.id, card, 'study')}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />

        {card && (
          <MediaPicker
            isOpen={isImagePickerOpen}
            onClose={() => setIsImagePickerOpen(false)}
            onImageUpload={(file) => uploadStudyImage(file, card)}
            searchQuery={card?.front || ''}
            loading={loading}
          />
        )}

        {loading && !card ? (
          <div className="finished-view glass">
            <RefreshCw size={48} className="spin" color="#a855f7" />
            <h3>Загрузка карточек...</h3>
          </div>
        ) : card ? (
          <div className="study-flow">
            {/* Deck general audio material player */}
            {(() => {
              const deckAudio = card?.deck_metadata?.resources?.find(r => r.type === 'audio');
              if (deckAudio) {
                return <DeckAudioPlayer url={deckAudio.url} title={deckAudio.title} variant="compact" />;
              }
              return null;
            })()}

            {/* Study Mode Selector Dropdown */}
            <div className="study-mode-dropdown-container">
              <span className="study-mode-dropdown-label">Режим:</span>
              <select
                className="study-mode-select glass"
                value={studyMode}
                onChange={(e) => {
                  const val = e.target.value;
                  setStudyMode(val);
                  setIsFlipped(false); // Reset card face on mode swap
                  
                  // If we switch to turbo mode, initialize favoritesQueue
                  if (val === 'turbo' && (!favoritesQueue || favoritesQueue.length === 0)) {
                    const cardsToUse = deckCards.length > 0 ? deckCards : (card ? [card] : []);
                    useSessionStore.getState().setFavoritesQueue([...cardsToUse]);
                  }
                }}
              >
                <option value="classic">🃏 Карточки (Немецкий → Русский)</option>
                <option value="reverse">🔄 Перевод (Русский → Немецкий)</option>
                <option value="cloze">📝 Выбор слова (Пропуски)</option>
                <option value="puzzle">🧩 Конструктор (Сборка фразы)</option>
                <option value="speak">🗣 Произношение (Голос)</option>
                <option value="turbo">🔥 Ударная тренировка (До автоматизма)</option>
                <option value="random">🎲 Случайный выбор (Рандом)</option>
              </select>
            </div>

            {studyMode === 'random' && (
              <div className="random-mode-config glass">
                <div className="random-config-title">Случайные режимы в пуле 🎲</div>
                <div className="random-config-grid">
                  {[
                    { key: 'classic', label: '🃏 Карточки' },
                    { key: 'reverse', label: '🔄 Перевод' },
                    { key: 'cloze', label: '📝 Выбор слова' },
                    { key: 'puzzle', label: '🧩 Конструктор' },
                    { key: 'speak', label: '🗣 Произношение' }
                  ].map(({ key, label }) => {
                    const isChecked = (randomEnabledModes || []).includes(key);
                    return (
                      <label key={key} className="random-checkbox-label">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            const enabled = [...(randomEnabledModes || [])];
                            if (e.target.checked) {
                              if (!enabled.includes(key)) enabled.push(key);
                            } else {
                              if (enabled.length <= 1) {
                                return;
                              }
                              const idx = enabled.indexOf(key);
                              if (idx >= 0) enabled.splice(idx, 1);
                            }
                            setRandomEnabledModes(enabled);
                          }}
                        />
                        <span className="custom-checkbox-span"></span>
                        <span className="random-checkbox-text">{label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <StudyCard
              card={card}
              isFlipped={isFlipped}
              onFlip={setIsFlipped}
              loading={loading}
              historyIndex={historyIndex}
              playAudio={playAudio}
              isAudioLoading={isAudioLoading}
              isAutoplayActive={isAutoplayActive}
              onPlayBackAudio={handlePlayBackAudio}
              styles={styleSettings}
              resolvedBgFront={resolvedBgFront}
              resolvedBgBack={resolvedBgBack}
              studyMode={studyMode === 'random' ? (activeRandomMode || 'classic') : studyMode}
              onTrainerAnswer={handleTrainerAnswer}
              onNextCard={() => {
                setIsFlipped(false);
                if (studyMode === 'trainer') {
                  fetchNextCard(currentDeck?.id);
                } else {
                  goNext();
                }
              }}
            />

            <div className="card-actions-row-study">
              <CardActionButton 
                card={card} 
                size={22} 
                className="btn-card-action-trigger" 
                stopDrag={false}
              />

              {currentDeck?.id === 'duplicates' && (
                <button
                  className="btn-card-action-trigger"
                  onClick={onDeleteDuplicate}
                  title="Удалить дубликат"
                  style={{ marginRight: '10px', color: '#ef4444' }}
                >
                  <Trash2 size={22} />
                </button>
              )}

              <button
                className={`btn-card-action-trigger btn-favorite-toggle-direct ${card.want_to_learn ? 'active' : ''}`}
                onClick={(e) => { e.stopPropagation(); handleToggleLearn(card); }}
                title={card.want_to_learn ? "Убрать из Ударного режима" : "Добавить в Ударный режим"}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  background: card.want_to_learn 
                    ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.25), rgba(244, 63, 94, 0.15))' 
                    : 'rgba(255, 255, 255, 0.05)',
                  border: card.want_to_learn 
                    ? '1px solid rgba(239, 68, 68, 0.45)' 
                    : '1px solid rgba(255, 255, 255, 0.12)',
                  padding: '0 16px',
                  height: '42px',
                  borderRadius: '12px',
                  color: card.want_to_learn ? '#fecdd3' : '#cbd5e1',
                  cursor: 'pointer',
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  flexGrow: 1,
                  flexShrink: 0,
                  boxShadow: card.want_to_learn 
                    ? '0 4px 12px rgba(239, 68, 68, 0.2)' 
                    : '0 4px 8px rgba(0, 0, 0, 0.1)',
                  fontWeight: 600
                }}
              >
                <Heart size={18} fill={card.want_to_learn ? "#ef4444" : "none"} color={card.want_to_learn ? "#ef4444" : "currentColor"} />
                <span style={{ fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.2px' }}>
                  {card.want_to_learn ? 'В ударном 🔥' : 'В ударный'}
                </span>
              </button>

              {!isFlipped && card.deck_name && (
                <div 
                  className="deck-badge-subcard" 
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '6px', 
                    background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.18), rgba(168, 85, 247, 0.12))', 
                    border: '1px solid rgba(99, 102, 241, 0.35)', 
                    padding: '0 14px', 
                    height: '42px',
                    borderRadius: '20px', 
                    flexShrink: 0,
                    boxShadow: '0 4px 10px rgba(99, 102, 241, 0.1)'
                  }}
                >
                  <Folder size={15} color="#a5b4fc" style={{ opacity: 0.8 }} />
                  <span style={{ fontSize: '0.8rem', color: '#a5b4fc', fontWeight: 700, letterSpacing: '0.3px' }}>
                    {card.deck_name}
                  </span>
                </div>
              )}
            </div>

            <StudyNavigation
              historyIndex={
                currentDeck?.id === 'duplicates' 
                  ? duplicateCards.findIndex(c => c.id === card?.id) 
                  : currentDeck?.id === 'favorites'
                  ? favoriteCards.length - favoritesQueue.length
                  : (deckCards && deckCards.length > 0 && deckCards.findIndex(c => c.id === card?.id) !== -1)
                  ? deckCards.findIndex(c => c.id === card?.id)
                  : historyIndex
              }
              totalCards={
                currentDeck?.id === 'duplicates' 
                  ? duplicateCards.length 
                  : currentDeck?.id === 'favorites'
                  ? favoriteCards.length
                  : (deckCards && deckCards.length > 0 && deckCards.findIndex(c => c.id === card?.id) !== -1)
                  ? deckCards.length
                  : (currentDeck?.stats?.total || 0)
              }
              loading={loading}
              onBack={handleAutoplayAwareBack}
              onNext={handleAutoplayAwareNext}
              autoplayState={autoplayState}
              autoplayStatus={autoplay.status}
              autoplaySettings={autoplaySettingsObj}
              onAutoplayStart={autoplay.start}
              onAutoplayStop={autoplay.stop}
              onAutoplayPause={autoplay.pause}
              onAutoplayResume={autoplay.resume}
              hideAutoplay={studyMode === 'trainer'}
            />
          </div>
        ) : studyMode === 'trainer' ? (
          <TrainerFinished
            totalCards={trainerAnsweredIds.size || deckCards?.length || 1}
            correctFirstTry={trainerCorrectCount}
            wrongCount={trainerWrongCardIds.length}
            elapsedSeconds={Math.round(((trainerStartTime ? Date.now() - trainerStartTime : 0)) / 1000)}
            onRetryWrong={() => {
              const wrongCards = (deckCards || []).filter(c => trainerWrongCardIds.includes(c.id));
              if (wrongCards.length > 0) {
                setTrainerWrongCardIds([]);
                setTrainerCorrectCount(0);
                setTrainerAnsweredIds(new Set());
                setTrainerStartTime(Date.now());
                useSessionStore.getState().setFavoritesQueue([...wrongCards]);
                fetchNextCard(currentDeck.id);
              }
            }}
            onRestart={() => {
              setTrainerWrongCardIds([]);
              setTrainerCorrectCount(0);
              setTrainerAnsweredIds(new Set());
              setTrainerStartTime(Date.now());
              fetchNextCard(currentDeck.id);
            }}
            onGoToDecks={() => setView('cards')}
          />
        ) : (
          <StudyFinished
            apiError={apiError}
            onGoToDecks={() => setView('cards')}
            onLearnMore={handleLearnMore}
            onSyncDeck={() => handleSyncDeck(currentDeck.id)}
            onResetProgress={handleResetProgressConfirmed}
          />
        )}
      </motion.div>
    </div>
  );
};
