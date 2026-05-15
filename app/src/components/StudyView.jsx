import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Settings2, Heart, Repeat, Share2 } from 'lucide-react';
import { stripMarkdown } from '../utils/text';
import { CardBackground } from './common/CardBackground';
import { getTextShadow, getContextShadow } from '../utils/style';
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

const OPEN_PICKER_AFTER_GOOGLE = 'lerne_open_picker_after_google';

export const StudyView = ({ startTutorial }) => {
  const { view, setView, loading, setIsSettingsOpen, setEditorSourceView, setActionCard, setIsCardActionModalOpen, showToast } = useUiStore();
  const { currentDeck, handleSyncDeck, handleResetProgress } = useDeckStore();
  const { card, setCard, isFlipped, setIsFlipped, studyHistory, historyIndex, apiError, setEditingCard, setIsLearningMore } = useSessionStore();
  const { submitGrade, goBack, goNext, handleQuickAudio, fetchNextCard, handleShareCard } = useCardActions();
  const { openEditor, openCreator } = useCardNavigation();
  const { uploadStudyImage, uploadCardVideo } = useMediaUpload();

  const {
    cardFont, cardTextColor, cardFontWeight, cardFontStyle, cardFontSize, cardTextShadow,
    cardBgFront, cardBgBack,
    contextFont, contextTextColor, contextFontSize, contextFontWeight, contextFontStyle, contextTextShadow,
    autoPlay
  } = useSettingsStore();

  const { playAudio, isAudioLoading } = useAudio(autoPlay, showToast);

  const [isImagePickerOpen, setIsImagePickerOpen] = useState(false);
  const googleReturnTimerRef = useRef(null);

  const openCardActions = (targetCard) => {
    setActionCard(targetCard);
    setIsCardActionModalOpen(true);
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
          onBack={() => { setView('decks'); setCard(null); }}
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
            <AnimatePresence mode="wait" initial={false}>
            <motion.div
              id="tut-study-card"
              key={card ? `${card.id}-${historyIndex}` : 'no-card'}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className={`card-container ${loading ? 'loading-card' : ''}`}
              onClick={() => !loading && setIsFlipped(!isFlipped)}
              style={{
                fontFamily: cardFont,
                color: cardTextColor,
                fontSize: `${cardFontSize}rem`,
                fontWeight: cardFontWeight,
                fontStyle: cardFontStyle,
                textShadow: getTextShadow(cardTextShadow, cardTextColor)
              }}
            >
              {!isFlipped ? (
                <div className="card-inner card-front glass">
                  <CardBackground styleType={resolvedBgFront} />
                    <div className="card-face">
                    {card.audio_url && (
                      <button
                        id="tut-study-audio"
                        className="audio-btn-corner"
                        disabled={loading}
                        onClick={(e) => { e.stopPropagation(); playAudio(card.audio_url); }}
                      >
                        {isAudioLoading ? <RefreshCw size={24} className="spin" /> : <span>🔊</span>}
                      </button>
                    )}
                    {useDeckStore.getState().duplicateCards.some(d => d.front === card.front && d.id !== card.id) && (
                      <div className="duplicate-label" style={{ position: 'absolute', top: '55px', right: '12px' }}>
                        <Repeat size={12} />
                        <span>Есть дубликат</span>
                      </div>
                    )}
                    {card.video_front_url && (
                      <div className="video-container-card">
                        <video src={card.video_front_url} autoPlay loop muted playsInline />
                      </div>
                    )}
                    <div className="text-front" style={{ fontStyle: cardFontStyle }}>{stripMarkdown(card.front)}</div>
                    <div className="flip-indicator-center">
                      <Repeat size={44} />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="card-inner card-back glass">
                  <CardBackground styleType={resolvedBgBack} />
                  <div className="card-face">
                    <div className="front-mini-container" style={{ position: 'relative', width: '100%', marginBottom: '20px' }}>
                      <div className="text-front-mini" style={{ marginBottom: 0 }}>{stripMarkdown(card.front)}</div>
                      {card.audio_url && (
                        <button
                          id="tut-study-audio-back"
                          className="audio-btn-back-corner"
                          disabled={loading}
                          onClick={(e) => { e.stopPropagation(); playAudio(card.audio_url); }}
                        >
                          {isAudioLoading ? <RefreshCw size={26} className="spin" /> : <span>🔊</span>}
                        </button>
                      )}
                    </div>

                    {card.video_back_url && (
                      <div className="video-container-card">
                        <video src={card.video_back_url} autoPlay loop muted playsInline />
                      </div>
                    )}
                    <div id="tut-study-answer" className="text-back" style={{ fontStyle: cardFontStyle }}>{stripMarkdown(card.back)}</div>
                    {card.image_url && (
                      <img
                        src={card.image_url}
                        className="card-img"
                        alt="Card"
                        onError={(e) => { console.warn('Image load error:', card.image_url); e.target.style.display='none'; }}
                      />
                    )}
                    {card.context && (
                      <div
                        className="text-context"
                        style={{
                          fontFamily: contextFont,
                          color: contextTextColor,
                          fontSize: `${contextFontSize}rem`,
                          fontWeight: contextFontWeight,
                          fontStyle: contextFontStyle,
                          textShadow: getContextShadow(contextTextShadow, contextTextColor)
                        }}
                      >
                        {stripMarkdown(card.context)}
                      </div>
                    )}

                    {card.creator_name && (
                      <div className="creator-badge-corner" style={{ position: 'absolute', bottom: '10px', right: '10px', display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(0,0,0,0.4)', padding: '4px 10px', borderRadius: '20px', zIndex: 10, opacity: 0.8 }}>
                        {card.creator_avatar ? (
                          <img src={card.creator_avatar} alt="avatar" style={{ width: 18, height: 18, borderRadius: '50%' }} />
                        ) : (
                          <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '9px' }}>
                            {card.creator_name.charAt(0)}
                          </div>
                        )}
                        <span style={{ fontSize: '0.65rem', color: '#fff', fontWeight: 500 }}>{card.creator_name}</span>
                      </div>
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

            <div className="card-actions-row-study">
              <button
                className="btn-card-action-trigger"
                onClick={(e) => { e.stopPropagation(); handleShareCard(card); }}
                title="Поделиться карточкой"
                style={{ marginRight: '10px' }}
              >
                <Share2 size={22} />
              </button>

              <button
                className="btn-card-action-trigger"
                onClick={(e) => { e.stopPropagation(); openCardActions(card); }}
                title="Действия с карточкой"
              >
                <Settings2 size={22} />
              </button>

              {card.want_to_learn && (
                 <div style={{ marginLeft: 'auto', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '5px' }}>
                   <Heart size={18} fill="#ef4444" />
                   <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>В списке на изучение</span>
                 </div>
              )}
            </div>

            <StudyNavigation
              historyIndex={historyIndex}
              totalCards={currentDeck?.stats?.total}
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
