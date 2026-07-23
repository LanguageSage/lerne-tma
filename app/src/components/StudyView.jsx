import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Settings2, Heart, Share2, Trash2, Folder, Music, ChevronDown, ChevronUp, Pause, Play as PlayIcon } from 'lucide-react';

const StudyDeckAudioPlayer = React.memo(({ url, title }) => {
  const audioRef = React.useRef(null);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [playbackRate, setPlaybackRate] = React.useState(1);
  const [isExpanded, setIsExpanded] = React.useState(false);

  React.useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    if (audioRef.current) {
      audioRef.current.load();
      audioRef.current.playbackRate = playbackRate;
    }
  }, [url]);

  const togglePlay = (e) => {
    e.stopPropagation();
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(err => console.error(err));
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleSeek = (e) => {
    const time = Number(e.target.value);
    setCurrentTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  const changeSpeed = (e) => {
    e.stopPropagation();
    const rates = [1, 1.25, 1.5, 0.75];
    const nextIdx = (rates.indexOf(playbackRate) + 1) % rates.length;
    const nextRate = rates[nextIdx];
    setPlaybackRate(nextRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
  };

  const formatTime = (time) => {
    if (isNaN(time)) return '0:00';
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className="glass" style={{
      margin: '0 15px 12px 15px',
      borderRadius: '14px',
      border: '1px solid rgba(56, 189, 248, 0.3)',
      background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 41, 59, 0.8) 100%)',
      overflow: 'hidden',
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      boxShadow: '0 6px 20px rgba(56, 189, 248, 0.15)'
    }}>
      <audio 
        ref={audioRef} 
        src={url} 
        onPlay={() => setIsPlaying(true)} 
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => setIsPlaying(false)}
      />
      
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          cursor: 'pointer',
          userSelect: 'none'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
          <Music size={16} className={isPlaying ? "pulse-animation" : ""} style={{ color: '#38bdf8', flexShrink: 0 }} />
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title || 'Аудио колоды'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {!isExpanded && (
            <button
              onClick={togglePlay}
              style={{
                background: 'rgba(56, 189, 248, 0.15)',
                border: 'none',
                color: '#38bdf8',
                width: '26px',
                height: '26px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer'
              }}
            >
              {isPlaying ? <Pause size={12} fill="currentColor" /> : <PlayIcon size={12} fill="currentColor" style={{ marginLeft: '1px' }} />}
            </button>
          )}
          {isExpanded ? <ChevronUp size={16} color="#94a3b8" /> : <ChevronDown size={16} color="#94a3b8" />}
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{
              padding: '0 14px 12px 14px',
              borderTop: '1px solid rgba(255, 255, 255, 0.05)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              marginTop: '4px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '6px' }}>
                <button 
                  onClick={togglePlay}
                  style={{
                    background: 'linear-gradient(135deg, #38bdf8, #6366f1)',
                    border: 'none',
                    color: 'white',
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    flexShrink: 0
                  }}
                >
                  {isPlaying ? <Pause size={14} fill="currentColor" /> : <PlayIcon size={14} fill="currentColor" style={{ marginLeft: '1px' }} />}
                </button>

                <input 
                  type="range"
                  min={0}
                  max={duration || 100}
                  value={currentTime}
                  onChange={handleSeek}
                  style={{
                    flex: 1,
                    height: '4px',
                    borderRadius: '4px',
                    background: 'rgba(255,255,255,0.1)',
                    outline: 'none',
                    cursor: 'pointer',
                    WebkitAppearance: 'none'
                  }}
                />

                <span style={{ fontSize: '0.7rem', color: '#94a3b8', minWidth: '60px', textAlign: 'right', fontFamily: 'monospace' }}>
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>

                <button
                  onClick={changeSpeed}
                  style={{
                    background: 'rgba(255, 255, 255, 0.08)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: '6px',
                    padding: '2px 6px',
                    fontSize: '0.7rem',
                    color: '#38bdf8',
                    fontWeight: 700,
                    cursor: 'pointer',
                    minWidth: '36px',
                    textAlign: 'center'
                  }}
                >
                  {playbackRate}x
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
import api from '../services/api';
import { useUiStore } from '../store/useUiStore';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useSettingsStore } from '../store/useSettingsStore';
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
import { StudyCard } from './study/StudyCard';

const OPEN_PICKER_AFTER_GOOGLE = 'lerne_open_picker_after_google';

export const StudyView = ({ startTutorial }) => {
  const { view, setView, loading, setIsSettingsOpen, setActionCard, setIsCardActionModalOpen, showToast } = useUiStore();
  const { currentDeck, handleSyncDeck, handleResetProgress, fetchDuplicates, duplicateCards, deckCards, favoriteCards } = useDeckStore();
  const { card, setCard, isFlipped, setIsFlipped, historyIndex, apiError, setIsLearningMore, autoplayState, favoritesQueue } = useSessionStore();
  const { submitGrade, goBack, goNext, handleQuickAudio, fetchNextCard, handleShareCard, handleDeleteCard, handleToggleLearn } = useCardActions();
  const { openEditor, openCreator } = useCardNavigation();
  const { uploadStudyImage } = useMediaUpload();

  const settings = useSettingsStore();
  const { autoPlay, cardBgFront, cardBgBack, studyMode, setStudyMode } = settings;

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
      const enabled = settings.randomEnabledModes || [];
      
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
  }, [card?.id, historyIndex, studyMode, settings.randomEnabledModes, activeRandomMode]);

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
    if (isAutoplayActive) {
      autoplay.cancelCurrent();
      const cards = currentDeck?.id === 'duplicates' ? duplicateCards : deckCards;
      const currentIndex = cards.findIndex(c => c.id === card?.id);
      if (currentIndex < cards.length - 1) {
        setCard(cards[currentIndex + 1]);
      } else if (settings.autoplayLoop && cards.length > 0) {
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
      const generated = await api.post('/media/generate-audio', {
        text: targetCard.back,
        lang: 'ru',
        rate: formatRate(settings.ttsSpeedRu),
        voice: settings.adminSettings?.TTS_VOICE_RU
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
      {currentDeck?.id !== 'duplicates' && !isAutoplayActive && (
        <GradeButtons card={card} loading={loading} onGrade={submitGrade} />
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
                return <StudyDeckAudioPlayer url={deckAudio.url} title={deckAudio.title} />;
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
                    const isChecked = (settings.randomEnabledModes || []).includes(key);
                    return (
                      <label key={key} className="random-checkbox-label">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            const enabled = [...(settings.randomEnabledModes || [])];
                            if (e.target.checked) {
                              if (!enabled.includes(key)) enabled.push(key);
                            } else {
                              if (enabled.length <= 1) {
                                return;
                              }
                              const idx = enabled.indexOf(key);
                              if (idx >= 0) enabled.splice(idx, 1);
                            }
                            settings.setRandomEnabledModes(enabled);
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
              styles={settings}
              resolvedBgFront={resolvedBgFront}
              resolvedBgBack={resolvedBgBack}
              studyMode={studyMode === 'random' ? (activeRandomMode || 'classic') : studyMode}
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
              autoplaySettings={settings}
              onAutoplayStart={autoplay.start}
              onAutoplayStop={autoplay.stop}
              onAutoplayPause={autoplay.pause}
              onAutoplayResume={autoplay.resume}
            />
          </div>
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
