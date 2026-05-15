import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Settings2, Heart, Share2, Trash2 } from 'lucide-react';
import { useUiStore } from '../store/useUiStore';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useCardActions } from '../hooks/useCardActions';
import { useMediaUpload } from '../hooks/useMediaUpload';
import { useAudio } from '../hooks/useAudio';
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
  const { currentDeck, handleSyncDeck, handleResetProgress, fetchDuplicates, duplicateCards } = useDeckStore();
  const { card, setCard, isFlipped, setIsFlipped, historyIndex, apiError, setIsLearningMore } = useSessionStore();
  const { submitGrade, goBack, goNext, handleQuickAudio, fetchNextCard, handleShareCard, handleDeleteCard } = useCardActions();
  const { openEditor, openCreator } = useCardNavigation();
  const { uploadStudyImage } = useMediaUpload();

  const settings = useSettingsStore();
  const { autoPlay, cardBgFront, cardBgBack } = settings;

  const { playAudio, isAudioLoading } = useAudio(autoPlay, showToast);

  const [isImagePickerOpen, setIsImagePickerOpen] = useState(false);
  const googleReturnTimerRef = useRef(null);

  const openCardActions = (targetCard) => {
    setActionCard(targetCard);
    setIsCardActionModalOpen(true);
  };

  const onDeleteDuplicate = async (e) => {
    e.stopPropagation();
    if (window.confirm('Удалить этот дубликат?')) {
      try {
        await handleDeleteCard(card.id);
        fetchDuplicates(); // Update the list in background
        goNext(); // Move to next card
      } catch (err) {
        showToast('Ошибка при удалении');
      }
    }
  };

  useEffect(() => {
    if (view === 'study' && card?.audio_url && autoPlay && !loading) {
      const timer = setTimeout(() => {
        playAudio(card.audio_url);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [card?.id, historyIndex, autoPlay, view, loading]);

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

  const handleResetProgressConfirmed = async () => {
    if (window.confirm('Вы уверены, что хотите сбросить прогресс этой колоды? Все ваши успехи будут обнулены.')) {
      try {
        await handleResetProgress(currentDeck.id);
        showToast('Прогресс успешно сброшен', 'success');
      } catch (err) {
        showToast('Ошибка при сбросе прогресса');
      }
    }
  };

  if (view !== 'study') return null;

  return (
    <div className="view-study">
      <GradeButtons card={card} loading={loading} onGrade={submitGrade} />

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
            if (currentDeck?.id === 'duplicates') {
              setView('duplicates');
            } else {
              setView('decks');
            }
            setCard(null); 
          }}
          onOpenCreator={() => openCreator(currentDeck?.id, 'study')}
          onStartTutorial={() => startTutorial(isFlipped ? 'study_back' : 'study')}
          onOpenImagePicker={() => setIsImagePickerOpen(true)}
          onQuickAudio={() => handleQuickAudio(card, playAudio)}
          onOpenEditor={() => openEditor(currentDeck?.id, card, 'study')}
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
              historyIndex={historyIndex}
              totalCards={currentDeck?.id === 'duplicates' ? duplicateCards.length : currentDeck?.stats?.total}
              loading={loading}
              onBack={goBack}
              onNext={goNext}
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
