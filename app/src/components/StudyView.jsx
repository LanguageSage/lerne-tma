import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Settings2, Heart, Share2, Trash2 } from 'lucide-react';
import api from '../services/api';
import { useUiStore } from '../store/useUiStore';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useCardActions } from '../hooks/useCardActions';
import { useMediaUpload } from '../hooks/useMediaUpload';
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
  const { currentDeck, handleSyncDeck, handleResetProgress, fetchDuplicates, duplicateCards, deckCards } = useDeckStore();
  const { card, setCard, isFlipped, setIsFlipped, historyIndex, apiError, setIsLearningMore, autoplayState } = useSessionStore();
  const { submitGrade, goBack, goNext, handleQuickAudio, fetchNextCard, handleShareCard, handleDeleteCard } = useCardActions();
  const { openEditor, openCreator } = useCardNavigation();
  const { uploadStudyImage } = useMediaUpload();

  const settings = useSettingsStore();
  const { autoPlay, cardBgFront, cardBgBack } = settings;

  const { playAudio, stopAudio, isAudioLoading, startBackgroundLock, stopBackgroundLock } = useAudio(autoPlay, showToast);
  const autoplay = useAutoplay({ card, playAudio, stopAudio, showToast, startBackgroundLock, stopBackgroundLock });
  const isAutoplayActive = autoplayState === 'playing' || autoplayState === 'paused';

  const [isImagePickerOpen, setIsImagePickerOpen] = useState(false);
  const googleReturnTimerRef = useRef(null);
  const previousAutoplayStateRef = useRef(autoplayState);
  const suppressLegacyAutoplayCardRef = useRef(null);
  const lastAutoplayedCardRef = useRef(null);

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
        goNext(); // Move to next card
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
    if (view === 'study' && card?.audio_url && autoPlay && !loading && !isAutoplayActive && !isSuppressedAfterAutoplay && lastAutoplayedCardRef.current !== currentCardKey) {
      lastAutoplayedCardRef.current = currentCardKey;
      const timer = setTimeout(() => {
        playAudio(card.audio_url);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [card?.id, card?.audio_url, historyIndex, autoPlay, view, loading, isAutoplayActive, playAudio]);

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
              setView('decks');
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
            />

            <div className="card-actions-row-study">
              <button
                className="btn-card-action-trigger"
                onClick={(e) => { e.stopPropagation(); handleShareCard(card); }}
                title="Поделиться карточкой"
                style={{ marginRight: '10px' }}
              >
                <Share2 size={22} />
              </button>

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
                className="btn-card-action-trigger"
                onClick={(e) => { e.stopPropagation(); openCardActions(card); }}
                title="Действия с карточкой"
              >
                <Settings2 size={22} />
              </button>

              {!isFlipped && card.deck_name && (
                <div className="deck-badge-subcard" style={{ marginLeft: '12px', display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(129, 140, 248, 0.15)', border: '1px solid rgba(129, 140, 248, 0.3)', padding: '4px 12px', borderRadius: '20px' }}>
                  <span style={{ fontSize: '0.75rem', color: '#818cf8', fontWeight: 600 }}>{card.deck_name}</span>
                </div>
              )}

              {card.want_to_learn && (
                 <div style={{ marginLeft: 'auto', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '5px' }}>
                   <Heart size={18} fill="#ef4444" />
                   <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>В списке на изучение</span>
                 </div>
              )}
            </div>

            <StudyNavigation
              historyIndex={currentDeck?.id === 'duplicates' ? duplicateCards.findIndex(c => c.id === card?.id) : (isAutoplayActive ? deckCards.findIndex(c => c.id === card?.id) : historyIndex)}
              totalCards={currentDeck?.id === 'duplicates' ? duplicateCards.length : (isAutoplayActive ? deckCards.length : currentDeck?.stats?.total)}
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
            onGoToDecks={() => setView('decks')}
            onLearnMore={handleLearnMore}
            onSyncDeck={() => handleSyncDeck(currentDeck.id)}
            onResetProgress={handleResetProgressConfirmed}
          />
        )}
      </motion.div>
    </div>
  );
};
