import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { RefreshCw, AlertTriangle, RotateCw } from 'lucide-react';
import { stripMarkdown } from '../../utils/text';
import { MarkdownRenderer } from '../common/MarkdownRenderer';
import './StudyCard.css';
import { CardBackground } from '../common/CardBackground';
import { useDeckStore } from '../../store/useDeckStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { useSettingsStore } from '../../store/useSettingsStore';

// Extracted Sub-components and Utilities
import { ExerciseRenderer } from './ExerciseRenderer.jsx';
import { ExerciseInfoBlocks } from './ExerciseInfoBlocks.jsx';
import { canRevealFreeTextAnswer } from '../../utils/freeTextEvaluationState.js';
import { StudyCardSpeech } from './StudyCardSpeech.jsx';
import { CardAudioPlayer } from './CardAudioPlayer.jsx';
import { StudyCardImage } from './StudyCardImage';
import { CardQuestionComposer } from './CardQuestionComposer.jsx';
import { KaraokeText } from './KaraokeText';
import { useVoicePicker } from '../../hooks/useVoicePicker';
import { useKaraokeSync } from '../../hooks/useKaraokeSync';
import { getAudioUrl } from '../../utils/media';
import { getPhysicalSideAudioSource, getStudyRolePhysicalSide, PEDAGOGICAL_ROLE } from '../../utils/studyCardRoles.js';

import { getHarmonizedOptionStyles, getDesignStylesFromV2 } from '../../utils/cardStyles';

import { getFlagStyle } from '../../constants/cardFlags';
import { CardLevelBadge } from '../common/CardLevelBadge';
import { CardActionButton } from '../modals/CardActionModal';
import { CardRating } from './CardRating';
import { useCardNotes } from '../../hooks/useCardNotes';
import { studyContent, studyExerciseType, studyInfoBlocks, studyQuiz, studySideText } from '../../utils/structuredStudyCard.js';
import { useStudyCardControls } from '../../hooks/useStudyCardControls';

// Keep playback/error state with the mounted physical side.
const CardVideo = ({ src }) => {
  const [status, setStatus] = useState('loading');
  return <div className="video-container-card">
    {status === 'loading' && <p role="status">{tr('Загрузка видео...')}</p>}
    {status === 'error' && <p role="status">{tr(navigator.onLine
      ? 'Не удалось загрузить видео' : 'Видео недоступно без сети')}</p>}
    <video src={src} controls autoPlay loop muted playsInline
      onLoadedData={() => setStatus('loaded')} onError={() => setStatus('error')} />
  </div>;
};

export const StudyCard = React.memo(({
  card,
  isFlipped,
  onFlip: requestFlip,
  loading,
  historyIndex,
  playAudio,
  audioControls,
  sessionVoice = null, // from useSessionVoice in StudyView
  isAudioLoading,
  isAutoplayActive,
  resolvedBgFront,
  resolvedBgBack,
  studyMode = 'classic',
  onTrainerAnswer,
  onSpeechSuccess,
  stepFlow,
  renderRequiredAction,
  onAskQuestion,
  aiExplanation,
  onSaveExplanation,
  isSavingExplanation = false,
  onNextCard,
  onPreviousCard,
  onNavigateNext,
  controlsEnabled = true
}) => {
  useInterfaceLocale();
  const reduceMotion = useReducedMotion();
  const flagStyle = useMemo(() => getFlagStyle(card?.flag), [card?.flag]);

  const surfaceRef = useRef(null);

  const handleAsk = async (req) => {
    try {
      return Boolean(await onAskQuestion(req));
    } catch {
      return false;
    }
  };


  // Card language: prefer card-level, then deck-level, then global active language
  const cardLang = card?.target_language
    || useDeckStore.getState().currentDeck?.target_language
    || useLanguageStore.getState().activeLanguage
    || 'de';

  const deckId = useDeckStore.getState().currentDeck?.id;
  const notes = useCardNotes(card?.id, card?.deck_id ?? deckId, true);

  // Propagate voice choice back to session store so it survives card navigation
  const handleVoiceChange = useCallback((voiceValue) => {
    sessionVoice?.setSessionVoice(deckId, voiceValue);
  }, [sessionVoice, deckId]);

  // Voice picker — scoped to this card's language, initialized from session store
  const storedVoice = sessionVoice?.getSessionVoice(deckId) || null;
  const frontVoicePicker = useVoicePicker(cardLang, storedVoice, handleVoiceChange, false, true);

  const content = studyContent(card);
  const exerciseType = studyExerciseType(content);
  const promptPhysicalSide = getStudyRolePhysicalSide(PEDAGOGICAL_ROLE.PROMPT, studyMode);
  const rawFrontText = studySideText(content, promptPhysicalSide);
  const frontText = stripMarkdown(rawFrontText);
  const topBlocks = useMemo(() => studyInfoBlocks(content), [content]);

  // Karaoke: sync word boundaries with audio playback position (with fallback estimation)
  const { activeWordIndex } = useKaraokeSync(
    frontVoicePicker.wordBoundaries,
    frontText,
    audioControls?.duration ?? 0,
    audioControls?.currentTime ?? 0,
    audioControls?.audioState ?? 'idle',
  );

  useEffect(() => {
    frontVoicePicker.setCardText(frontText);
  }, [frontText]); // eslint-disable-line react-hooks/exhaustive-deps

  // On card change: keep voice selection (session) but clear stale preview URL
  useEffect(() => {
    frontVoicePicker.setPreviewUrl(null);
  }, [card?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Interactive Cloze & Exercise states
  const [exerciseStates, setExerciseStates] = useState({});
  const [exerciseFooterTarget, setExerciseFooterTarget] = useState(null);

  const [exerciseVersions, setExerciseVersions] = useState({});
  const seen = exerciseVersions[card?.id];
  if (content && seen?.data !== content.data) {
    const changed = !seen || seen.type !== content.type || JSON.stringify(seen.data) !== JSON.stringify(content.data);
    setExerciseVersions({ ...exerciseVersions, [card.id]: {
      data: content.data, type: content.type, version: (seen?.version ?? -1) + Number(changed),
    } });
  }
  const reviewKey = card?.id != null
    ? `${(stepFlow?.hasRequiredActions ? stepFlow.reviewKey : null) || `${card.id}:${historyIndex}`}:${seen?.version ?? 0}`
    : null;

  const handleSaveExerciseState = useCallback((state) => {
    if (!reviewKey) return;
    setExerciseStates(prev => ({ ...prev, [reviewKey]: state }));
  }, [reviewKey]);

  // Reactive image height — subscribes to store so editor changes apply instantly
  const storedImageHeight = useDeckStore(state => {
    try {
      const meta = state.currentDeck?.metadata;
      const parsed = meta ? (typeof meta === 'string' ? JSON.parse(meta) : meta) : {};
      return parsed.imageHeight || 220;
    } catch { return 220; }
  });

  const cardMetaImageHeight = useMemo(() => {
    if (card?.image_height) return card.image_height;
    if (card?.deck_metadata) {
      try {
        const dm = typeof card.deck_metadata === 'string' ? JSON.parse(card.deck_metadata) : card.deck_metadata;
        if (dm?.imageHeight) return dm.imageHeight;
      } catch { /* ignore */ }
    }
    return null;
  }, [card?.image_height, card?.deck_metadata]);

  const [cardImageHeight, setCardImageHeight] = useState(cardMetaImageHeight || storedImageHeight);

  // Keep in sync when card or metadata changes externally (e.g. editor slider)
  useEffect(() => {
    setCardImageHeight(cardMetaImageHeight || storedImageHeight);
  }, [cardMetaImageHeight, card?.id, storedImageHeight]);

  const startCardImageResize = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    const startY = e.touches ? e.touches[0].clientY : e.clientY;
    const startH = cardImageHeight;
    const onMove = (ev) => {
      const clientY = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const newH = Math.max(60, Math.min(800, startH + (clientY - startY)));
      setCardImageHeight(newH);
    };
    const onUp = (ev) => {
      const clientY = ev.changedTouches ? ev.changedTouches[0].clientY : ev.clientY;
      const finalH = Math.max(60, Math.min(800, startH + (clientY - startY)));
      const deck = useDeckStore.getState().currentDeck;
      if (deck) {
        const meta = deck.metadata
          ? (typeof deck.metadata === 'string' ? JSON.parse(deck.metadata) : deck.metadata)
          : {};
        useDeckStore.getState().updateDeckMetadata(deck.id, { ...meta, imageHeight: Math.round(finalH) }).catch(() => {});
      }
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
  }, [cardImageHeight]);

  const effectiveConfig = useSettingsStore(state => state.activeDesignConfig);
  const v2Styles = useMemo(() => getDesignStylesFromV2(effectiveConfig), [effectiveConfig]);

  const cardStyle = v2Styles.frontText;
  const backCardStyle = v2Styles.backText;
  const contextStyle = v2Styles.contextText;
  const referenceStyle = v2Styles.referenceText;
  const harmonizedOptions = useMemo(() => getHarmonizedOptionStyles(effectiveConfig?.exercises?.baseColor), [effectiveConfig]);

  const blockAnswerReveal = ['free_text', 'editable_text'].includes(exerciseType) && studyMode !== 'speak' && !isAutoplayActive
    && !canRevealFreeTextAnswer(exerciseStates[reviewKey]?.evaluationState);
  const onFlip = next => {
    if (!loading && !isAutoplayActive && (!next || !blockAnswerReveal)) requestFlip(next);
  };
  useStudyCardControls({
    surfaceRef,
    reviewKey: `${reviewKey}:${card?.id}:${studyMode}:${isFlipped}`,
    enabled: controlsEnabled && !loading,
    isFlipped, onFlip, onPrevious: onPreviousCard, onNext: onNavigateNext,
  });

  const quizData = useMemo(() => content?.type === 'quiz' ? studyQuiz(content.data) : null, [content]);

  const getResolvedAudioUrl = (c, isBack = false) => {
    if (!c) return '';
    const target = getPhysicalSideAudioSource(c, isBack ? 'back' : 'front');
    return getAudioUrl(target);
  };

  const renderFrontAudioPlayer = () => {
    const isBackSide = promptPhysicalSide === 'back';
    const audioUrl = getResolvedAudioUrl(card, isBackSide);
    // The reverse-mode front is the translation. Ordinary study may play an
    // existing translation recording, but only Auto is allowed to generate it.
    if (!audioUrl && (!frontText || isBackSide)) return null;

    return (
      <CardAudioPlayer
        audioUrl={audioUrl}
        playAudio={audioControls?.playAudio || playAudio}
        pauseAudio={audioControls?.pauseAudio}
        resumeAudio={audioControls?.resumeAudio}
        togglePlayPause={audioControls?.togglePlayPause}
        stopAudio={audioControls?.stopAudio}
        seekAudio={audioControls?.seekAudio}
        setPlaybackSpeed={audioControls?.setPlaybackSpeed}
        audioState={audioControls?.audioState}
        currentUrl={audioControls?.currentUrl}
        currentTime={audioControls?.currentTime}
        duration={audioControls?.duration}
        playbackRate={audioControls?.playbackRate}
        isAudioLoading={isAudioLoading || audioControls?.isAudioLoading}
        isGenerating={card.audio_is_generating}
        voicePicker={isBackSide ? null : frontVoicePicker}
        cardText={isBackSide ? '' : frontText}
        cardId={isBackSide ? null : card?.id}
        isBack={isBackSide}
        disabled={loading || isAutoplayActive}
      />
    );
  };

  // --- Early return after all hooks ---
  if (!card || !content) return null;

  let deckMeta = card.deck_metadata;
  if (!deckMeta) {
    const currentDeck = useDeckStore.getState().currentDeck;
    if (currentDeck?.metadata) {
      deckMeta = typeof currentDeck.metadata === 'string' ? JSON.parse(currentDeck.metadata) : currentDeck.metadata;
    }
  } else if (typeof deckMeta === 'string') {
    try { deckMeta = JSON.parse(deckMeta); } catch { /* pass */ }
  }

  const deckResources = deckMeta?.resources || [];
  const deckImage = deckResources.find(r => r.type === 'image' && r.show_in_cards !== false);
  const deckVideo = deckResources.find(r => r.type === 'video');

  const getDeckImageUrl = (resItem) => {
    if (!resItem) return null;
    if (resItem.url) return resItem.url;
    if (resItem.path) {
      const cleanPath = resItem.path.replace(/^(images|audio|videos)\//, '');
      return `/api/media/images/${cleanPath}`;
    }
    return null;
  };

  const getResolvedImageUrl = (c) => {
    if (!c) return null;
    const raw = c.image_url || c.media_url || c.image_path || c.image;
    if (!raw || typeof raw !== 'string') return null;
    if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:') || raw.startsWith('blob:')) {
      return raw;
    }
    if (raw.startsWith('/api/media/')) {
      return raw;
    }
    const cleanPath = raw.replace(/^(images|audio|videos)\//, '').replace(/^\/lid_images\//, '');
    return `/api/media/images/${cleanPath}`;
  };

  const imageUrl = getResolvedImageUrl(card) || getDeckImageUrl(deckImage);

  const showExercise = Boolean(exerciseType) && studyMode !== 'speak' && !isAutoplayActive;

  // A future step renderer can reuse speech/listening UI without a new card type.
  const requiredActionContent = stepFlow?.currentStep && stepFlow.currentStep.action !== 'answer'
    ? renderRequiredAction?.({ card, stepFlow, audioControls })
    : null;

  return (
    <AnimatePresence mode="sync" initial={false}>
      <motion.div
        id="tut-study-card"
        ref={surfaceRef}
        key={`${card.id}-${historyIndex}`}
        initial={{ opacity: 0, y: reduceMotion ? 0 : 12, scale: reduceMotion ? 1 : 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: reduceMotion ? 0 : 0.1 }}
        className={`card-container study-flashcard ${loading ? 'loading-card' : ''}`}
        style={flagStyle}
        aria-busy={loading}
      >
        <div className="study-card-perspective">
        <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={isFlipped ? 'back' : 'front'}
          initial={reduceMotion ? false : {
            rotateY: isFlipped ? -90 : 90, rotateX: -4, z: 36, scale: 0.97,
          }}
          animate={reduceMotion ? { rotateY: 0, rotateX: 0, z: 0, scale: 1 } : {
            rotateY: [isFlipped ? -90 : 90, isFlipped ? 3 : -3, 0],
            rotateX: [-4, 1, 0], z: [36, 12, 0], scale: [0.97, 1.005, 1],
          }}
          exit={reduceMotion ? {} : {
            rotateY: isFlipped ? -90 : 90, rotateX: 4, z: 36, scale: 0.97,
            transition: { duration: 0.22, ease: [0.55, 0, 0.85, 0.4] },
          }}
          transition={{ duration: reduceMotion ? 0 : 0.42, times: [0, 0.76, 1], ease: [0.16, 1, 0.3, 1] }}
          className="study-card-surface"
        >
        {!isFlipped ? (
          <div className="card-inner card-front glass" style={flagStyle}>
            <CardBackground background={effectiveConfig?.front?.card?.background} styleType={resolvedBgFront} cardId={card.id} />
            <div className="card-face">
              
              {/* Leech Indicator */}
              {Boolean(card?.is_leech || (card?.lapses && card.lapses >= 5)) && (
                <div
                  className="leech-badge"
                  title={tr("Сложная карточка ({{p0}} ошибок). Рекомендуем упростить или добавить мнемонику.", { p0: card?.lapses || 5 })}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    padding: '4px 10px',
                    borderRadius: '20px',
                    background: 'rgba(239, 68, 68, 0.2)',
                    color: '#fca5a5',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)',
                    marginBottom: '12px',
                    alignSelf: 'center'
                  }}
                >
                  <AlertTriangle size={12} color="#ef4444" />
                  <span>{tr("Сложная карточка (")}{card?.lapses || 5}{' '}{tr("ошибок)")}</span>
                </div>
              )}
              
              {/* Media Preview Header — shown on all modes */}
              {imageUrl && (
                <StudyCardImage
                  src={imageUrl}
                  height={cardImageHeight}
                  cardId={card?.id}
                  onResizeStart={startCardImageResize}
                  showResizeHandle={true}
                />
              )}

              {card.video_front_url && <CardVideo key={card.video_front_url} src={card.video_front_url} />}

              {requiredActionContent ?? <>
              {!showExercise && studyMode !== 'speak' && (
                <>
                  <ExerciseInfoBlocks blocks={topBlocks} />
                  <div id="tut-study-front" className="text-front" style={{ whiteSpace: 'pre-wrap', ...cardStyle }}>
                    {promptPhysicalSide === 'back' ? <MarkdownRenderer>{rawFrontText}</MarkdownRenderer>
                      : <KaraokeText text={frontText} activeWordIndex={activeWordIndex} style={cardStyle} />}
                  </div>
                  {renderFrontAudioPlayer()}
                </>
              )}

              {/* Interactive Exercise Renderer */}
              {showExercise && (
                <ExerciseRenderer
                  card={card}
                  native
                  studyMode={studyMode}
                  isPureTrainerMode={false}
                  isFlipped={isFlipped}
                  onFlip={onFlip}
                  playAudio={playAudio}
                  onTrainerAnswer={onTrainerAnswer}
                  onNextCard={onNextCard}
                  renderAudioPlayer={renderFrontAudioPlayer}
                  designConfig={effectiveConfig}
                  savedState={reviewKey ? exerciseStates[reviewKey] : undefined}
                  onSaveState={handleSaveExerciseState}
                  footerActionTarget={exerciseFooterTarget}
                  reviewKey={reviewKey}
                />
              )}

              {/* Speech Recognition Mode */}
              {studyMode === 'speak' && (
                <StudyCardSpeech
                  key={stepFlow?.reviewKey || reviewKey}
                  card={card}
                  targetText={frontText}
                  designConfig={effectiveConfig}
                  reviewKey={stepFlow?.reviewKey || reviewKey}
                  onSuccess={onSpeechSuccess}
                  onFlip={onFlip}
                  loading={loading}
                  playAudio={playAudio}
                  onPlayCardAudio={async () => {
                    const url = await frontVoicePicker.generateAndSaveToCard(card?.id, frontText, false);
                    if (url) playAudio?.(url);
                  }}
                  stopAudio={audioControls?.stopAudio}
                  isAudioLoading={isAudioLoading}
                  isAutoplayActive={isAutoplayActive}

                />
              )}
              </>}

            </div>
          </div>
        ) : (
          <div className="card-inner card-back glass" style={flagStyle}>
            <CardBackground background={effectiveConfig?.back?.card?.background} styleType={resolvedBgBack} cardId={card.id} />
            <div className="card-face">
              {/* Leech Indicator */}
              {Boolean(card?.is_leech || (card?.lapses && card.lapses >= 5)) && (
                <div
                  className="leech-badge"
                  title={tr("Сложная карточка ({{p0}} ошибок). Рекомендуем упростить или добавить мнемонику.", { p0: card?.lapses || 5 })}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    padding: '4px 10px',
                    borderRadius: '20px',
                    background: 'rgba(239, 68, 68, 0.2)',
                    color: '#fca5a5',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)',
                    marginBottom: '12px',
                    alignSelf: 'center'
                  }}
                >
                  <AlertTriangle size={12} color="#ef4444" />
                  <span>{tr("Сложная карточка (")}{card?.lapses || 5}{' '}{tr("ошибок)")}</span>
                </div>
              )}
              {/* 1. FRONT REFERENCE SECTION */}
              <div className="card-back-front-section">
                {exerciseType === 'quiz' && quizData ? (
                  <div>
                    <div className="back-quiz-question" style={{ ...cardStyle, textAlign: 'left', fontSize: '1.2rem', marginBottom: '8px' }}>
                      {quizData.question}
                    </div>

                    <div className="back-quiz-subdivider">
                      <span>{tr("Варианты ответа")}</span>
                    </div>

                    <div className="back-quiz-options-compact">
                      {quizData.options.map((opt, i) => (
                        <div 
                          key={i} 
                          className={`back-quiz-opt-row ${opt.isCorrect ? 'is-correct' : ''}`}
                          style={opt.isCorrect ? undefined : { color: harmonizedOptions.textColor }}
                        >
                          <span className="back-quiz-opt-tag">{['A', 'B', 'C', 'D', 'E', 'F'][i] || (i + 1)}</span>
                          <span className="back-quiz-opt-label">{opt.text}</span>
                          {opt.isCorrect && <span className="back-quiz-opt-badge">{tr("✓ Верный")}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="front-mini-container" style={{ position: 'relative', width: '100%' }}>
                    {topBlocks.length > 0 && (
                      <ExerciseInfoBlocks blocks={topBlocks} />
                    )}
                    <div className="text-front-mini" style={{ marginBottom: 0, opacity: 0.95, whiteSpace: 'pre-wrap', ...referenceStyle }}>
                      {promptPhysicalSide === 'back' ? <MarkdownRenderer>{rawFrontText}</MarkdownRenderer> : frontText}
                    </div>
                  </div>
                )}

                {(() => {
                  const isTranslation = studyMode === 'reverse';
                  const resolvedFrontUrl = getResolvedAudioUrl(card, isTranslation);
                  if (!resolvedFrontUrl && (!frontText || isTranslation)) return null;

                  return (
                    <div style={{ marginTop: '8px' }}>
                      <CardAudioPlayer
                        audioUrl={resolvedFrontUrl}
                        playAudio={audioControls?.playAudio || playAudio}
                        pauseAudio={audioControls?.pauseAudio}
                        resumeAudio={audioControls?.resumeAudio}
                        togglePlayPause={audioControls?.togglePlayPause}
                        stopAudio={audioControls?.stopAudio}
                        seekAudio={audioControls?.seekAudio}
                        setPlaybackSpeed={audioControls?.setPlaybackSpeed}
                        audioState={audioControls?.audioState}
                        currentUrl={audioControls?.currentUrl}
                        currentTime={audioControls?.currentTime}
                        duration={audioControls?.duration}
                        playbackRate={audioControls?.playbackRate}
                        isAudioLoading={isAudioLoading || audioControls?.isAudioLoading}
                        isGenerating={card.audio_is_generating}
                        voicePicker={isTranslation ? null : frontVoicePicker}
                        cardText={isTranslation ? '' : frontText}
                        cardId={isTranslation ? null : card?.id}
                        isBack={isTranslation}
                        disabled={loading || isAutoplayActive}
                      />
                    </div>
                  );
                })()}
              </div>

              <CardQuestionComposer key={card?.id} onSubmit={handleAsk} submitLabel={tr('Задать')} />
              {aiExplanation && <div className="ai-explanation-block card-context-wrapper">
                <strong>{tr('Ответ ИИ:')}</strong>
                <div className="text-context" style={{ whiteSpace: 'pre-wrap', ...contextStyle }}>
                  <MarkdownRenderer>{aiExplanation.answer}</MarkdownRenderer>
                </div>
                <button type="button" className="btn btn-primary" disabled={isSavingExplanation}
                  style={{ minHeight: '44px', width: '100%', marginTop: '12px', whiteSpace: 'normal' }}
                  onClick={event => { event.stopPropagation(); onSaveExplanation?.(); }}>
                  {isSavingExplanation ? tr('Выполняется...') : tr('Сохранить в Контекст')}
                </button>
              </div>}


              {/* 2. EXPLICIT SEPARATOR BETWEEN FRONT & BACK */}
              {(() => {
                const rawBackText = studySideText(content, promptPhysicalSide === 'back' ? 'front' : 'back');
                const backClean = stripMarkdown(rawBackText).trim();
                const hasDistinctBack = Boolean(backClean && backClean !== frontText.trim());
                const backAudio = getResolvedAudioUrl(card, studyMode !== 'reverse');
                if (!hasDistinctBack && !backAudio && !card.video_back_url && !deckVideo?.url) return null;

                return (
                  <>
                    {!exerciseType && (
                      <div className="card-side-separator">
                        <div className="separator-line" />
                        <div className="separator-badge">
                          <RotateCw size={12} />
                          <span>{studyMode === 'reverse' ? tr("Оригинал") : tr("Перевод")}</span>
                        </div>
                        <div className="separator-line" />
                      </div>
                    )}

                    {(card.video_back_url || deckVideo?.url) && (
                      <CardVideo key={card.video_back_url || deckVideo?.url} src={card.video_back_url || deckVideo?.url} />
                    )}
                    
                    {/* 3. BACK ANSWER BLOCK */}
                    {(hasDistinctBack || backAudio) && (
                      <div className="back-answer-block">
                        {(() => {
                          const targetBackAudioUrl = studyMode === 'reverse'
                            ? getResolvedAudioUrl(card, false)
                            : getResolvedAudioUrl(card, true);
                          if (targetBackAudioUrl) {
                            return (
                              <CardAudioPlayer
                                audioUrl={targetBackAudioUrl}
                                playAudio={audioControls?.playAudio || playAudio}
                                pauseAudio={audioControls?.pauseAudio}
                                resumeAudio={audioControls?.resumeAudio}
                                togglePlayPause={audioControls?.togglePlayPause}
                                stopAudio={audioControls?.stopAudio}
                                seekAudio={audioControls?.seekAudio}
                                setPlaybackSpeed={audioControls?.setPlaybackSpeed}
                                audioState={audioControls?.audioState}
                                currentUrl={audioControls?.currentUrl}
                                currentTime={audioControls?.currentTime}
                                duration={audioControls?.duration}
                                playbackRate={audioControls?.playbackRate}
                                isAudioLoading={isAudioLoading || audioControls?.isAudioLoading}
                                isGenerating={card.audio_is_generating}
                                disabled={loading || isAudioLoading}
                              />
                            );
                          }
                          return null;
                        })()}
                        <div id="tut-study-answer" className="text-back" style={{ whiteSpace: 'pre-wrap', ...backCardStyle }}>
                          {studyMode === 'reverse' ? backClean : <MarkdownRenderer>{rawBackText}</MarkdownRenderer>}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
              
              {imageUrl && (
                <div style={{ marginTop: '12px', marginBottom: '12px', flexShrink: 0 }}>
                  <StudyCardImage
                    src={imageUrl}
                    height={cardImageHeight}
                    cardId={card?.id}
                    showResizeHandle={false}
                  />
                </div>
              )}

              {/* 4. CONTEXT BLOCK */}
              {notes.rows.length > 0 && <div className="card-context-wrapper card-personal-notes">
                <strong>{tr('Мои заметки')}</strong>
                {notes.rows.map(row => <div key={row.id} className="text-context"
                  style={{ whiteSpace: 'pre-wrap', ...contextStyle }}>{row.text}</div>)}
              </div>}
              {content.explanation && (
                <div className="card-context-wrapper">
                  <div className="text-context" style={{ whiteSpace: 'pre-wrap', ...contextStyle }}>
                    <MarkdownRenderer>{content.explanation}</MarkdownRenderer>
                  </div>
                </div>
              )}


            </div>
          </div>
        )}

        </motion.div>
        </AnimatePresence>
        </div>
        <div className="study-card-footer">
          <div className="study-card-bottom-bar">
            <div className="study-card-level-slot">
              <CardLevelBadge card={card} expandable={false} style={{ maxWidth: '100%' }} />
            </div>
            <div className="study-card-footer-actions">
              <div ref={setExerciseFooterTarget} className="study-card-footer-action-target" />
              {!blockAnswerReveal && <button
                type="button"
                className="study-card-flip-button"
                disabled={loading || isAutoplayActive}
                onClick={() => onFlip(!isFlipped)}
              >
                <RotateCw size={18} aria-hidden="true" />
                <span>{tr("Перевернуть карточку")}</span>
              </button>}
            </div>
            <CardActionButton card={card} size={20} className="study-card-actions-button" refreshNotes />
          </div>
          <CardRating key={card?.id} card={card} deckId={card?.deck_id ?? deckId} />
        </div>
        {loading && (
          <div className="card-loading-overlay">
            <RefreshCw size={40} className="spin" />
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
});


