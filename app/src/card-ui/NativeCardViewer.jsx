import React, { useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { RefreshCw, RotateCw } from 'lucide-react';
import { tr } from '../i18n/locale.js';
import { useInterfaceLocale } from '../i18n/useInterfaceLocale.js';
import { DEFAULT_DESIGN_CONFIG_V2 } from '../design/designConfig.js';
import { designConfigToCssVariables } from '../design/designTokens.js';
import { getDesignStylesFromV2, getHarmonizedOptionStyles } from '../utils/cardStyles.js';
import { getFlagStyle } from '../constants/cardFlags.js';
import { stripMarkdown } from '../utils/text.js';
import { MediaResolverProvider, defaultResolveMediaUrl, defaultResolveAudioUrl, useMediaResolvers } from './MediaResolverContext.jsx';
import { canRevealFreeTextAnswer } from '../utils/freeTextEvaluationState.js';
import { getPhysicalSideAudioSource, getStudyRolePhysicalSide, PEDAGOGICAL_ROLE } from '../utils/studyCardRoles.js';
import { studyContent, studyExerciseType, studyInfoBlocks, studyQuiz, studySideText } from '../utils/structuredStudyCard.js';
import { CardBackground } from '../components/common/CardBackground.jsx';
import { CardLevelBadge } from '../components/common/CardLevelBadge.jsx';
import { MarkdownRenderer } from '../components/common/MarkdownRenderer.jsx';
import { ExerciseRenderer } from '../components/study/ExerciseRenderer.jsx';
import { ExerciseInfoBlocks } from '../components/study/ExerciseInfoBlocks.jsx';
import { StructuredCardLayout } from '../components/study/StructuredCardLayout.jsx';
import { CardAudioPlayer } from '../components/study/CardAudioPlayer.jsx';
import { StudyCardImage } from '../components/study/StudyCardImage.jsx';
import { StudyCardText } from '../components/study/StudyCardText.jsx';
import { useLocalAudioPlayer } from './useLocalAudioPlayer.js';
import './CardUiScoped.css';

const CardVideo = ({ src }) => {
  const [status, setStatus] = useState('loading');
  const { isLocalAssetUrl } = useMediaResolvers();
  return (
    <div className="video-container-card">
      {status === 'loading' && <p role="status">{tr('Загрузка видео...')}</p>}
      {status === 'error' && (
        <p role="status">{tr((isLocalAssetUrl(src) || navigator.onLine) ? 'Не удалось загрузить видео' : 'Видео недоступно без сети')}</p>
      )}
      <video
        src={src}
        controls
        autoPlay
        loop
        muted
        playsInline
        onLoadedData={() => setStatus('loaded')}
        onError={() => setStatus('error')}
      />
    </div>
  );
};

function resolveCardImageSrc(card, resolveMediaUrl) {
  if (!card) return null;
  const raw = card.image_url || card.media_url || card.image_path || card.image;
  return raw ? resolveMediaUrl(raw, 'images') : null;
}

function resolveDeckImageSrc(deckImage, resolveMediaUrl) {
  if (!deckImage) return null;
  if (deckImage.url) return deckImage.url;
  if (deckImage.path) return resolveMediaUrl(deckImage.path, 'images');
  return null;
}

export const NativeCardViewer = React.memo(({
  card,
  designConfig = DEFAULT_DESIGN_CONFIG_V2,
  isFlipped = false,
  onFlip,
  loading = false,
  historyIndex = 0,
  studyMode = 'classic',
  isAutoplayActive = false,
  resolvedBgFront = '',
  resolvedBgBack = '',
  animated = true,
  className = '',
  rootClassName = '',
  containerId,
  surfaceRef = null,
  reviewKey: controlledReviewKey,
  exerciseStates: controlledExerciseStates,
  onSaveExerciseState: controlledSaveExerciseState,
  cardImageHeight = 220,
  onResizeImageStart,
  showImageResizeHandle = false,
  deckResources = [],
  resolveMediaUrl = defaultResolveMediaUrl,
  resolveAudioUrl = defaultResolveAudioUrl,
  isLocalAssetUrl = null,
  allowDictation = true,
  audioControls: providedAudioControls = null,
  frontAudioPlayerProps = {},
  backFrontAudioPlayerProps = {},
  backAudioPlayerProps = {},
  renderFrontText = null,
  evaluateAnswer = null,
  isAdmin = false,
  onBeforeDictation = null,
  onTrainerAnswer,
  onNextCard,
  requiredActionContent = null,
  frontSpeechContent = null,
  topFrontSlot = null,
  topBackSlot = null,
  backQuestionSlot = null,
  personalNotesSlot = null,
  footerRightSlot = null,
  footerBottomSlot = null,
  inlineAudio = true,
  showFooter = true,
}) => {
  useInterfaceLocale();
  const reduceMotion = useReducedMotion() || !animated;
  const localAudioControls = useLocalAudioPlayer();
  const audioControls = providedAudioControls || localAudioControls;

  const [localExerciseStates, setLocalExerciseStates] = useState({});
  const [exerciseFooterTarget, setExerciseFooterTarget] = useState(null);
  const [exerciseVersions, setExerciseVersions] = useState({});

  const content = studyContent(card);
  const seen = card?.id != null ? exerciseVersions[card.id] : null;
  if (card?.id != null && content && seen?.data !== content.data) {
    const changed = !seen || seen.type !== content.type || JSON.stringify(seen.data) !== JSON.stringify(content.data);
    setExerciseVersions({
      ...exerciseVersions,
      [card.id]: {
        data: content.data,
        type: content.type,
        version: (seen?.version ?? -1) + Number(changed),
      },
    });
  }

  const effectiveReviewKey = controlledReviewKey ?? (
    card?.id != null ? `${card.id}:${historyIndex}:${seen?.version ?? 0}` : null
  );
  const exerciseStates = controlledExerciseStates || localExerciseStates;

  const handleSaveExerciseState = useCallback((state) => {
    if (!effectiveReviewKey) return;
    if (controlledSaveExerciseState) {
      controlledSaveExerciseState(state, effectiveReviewKey);
    } else {
      setLocalExerciseStates(prev => ({ ...prev, [effectiveReviewKey]: state }));
    }
  }, [controlledSaveExerciseState, effectiveReviewKey]);

  const effectiveConfig = designConfig || DEFAULT_DESIGN_CONFIG_V2;
  const designVariables = useMemo(() => designConfigToCssVariables(effectiveConfig), [effectiveConfig]);
  const v2Styles = useMemo(() => getDesignStylesFromV2(effectiveConfig), [effectiveConfig]);
  const harmonizedOptions = useMemo(
    () => getHarmonizedOptionStyles(effectiveConfig?.exercises?.baseColor),
    [effectiveConfig]
  );
  const flagStyle = useMemo(() => getFlagStyle(card?.flag), [card?.flag]);
  const topBlocks = useMemo(() => studyInfoBlocks(content), [content]);
  const quizData = useMemo(() => (content?.type === 'quiz' ? studyQuiz(content.data) : null), [content]);

  if (!card || !content) return null;

  const cardStyle = v2Styles.frontText;
  const backCardStyle = v2Styles.backText;
  const contextStyle = v2Styles.contextText;
  const referenceStyle = v2Styles.referenceText;

  const exerciseType = studyExerciseType(content);
  const promptPhysicalSide = getStudyRolePhysicalSide(PEDAGOGICAL_ROLE.PROMPT, studyMode);
  const rawFrontText = studySideText(content, promptPhysicalSide);
  const frontText = stripMarkdown(rawFrontText);
  const isTheory = content?.type === 'theory';

  const blockAnswerReveal = ['free_text', 'editable_text'].includes(exerciseType)
    && studyMode !== 'speak'
    && !isAutoplayActive
    && !canRevealFreeTextAnswer(exerciseStates[effectiveReviewKey]?.evaluationState);

  const deckImage = deckResources.find(r => r.type === 'image' && r.show_in_cards !== false);
  const deckVideo = deckResources.find(r => r.type === 'video');
  const imageUrl = resolveCardImageSrc(card, resolveMediaUrl) || resolveDeckImageSrc(deckImage, resolveMediaUrl);
  const videoFrontUrl = card.video_front_url || (card.video_front_path ? resolveMediaUrl(card.video_front_path, 'videos') : null);
  const videoBackUrl = card.video_back_url || (card.video_back_path ? resolveMediaUrl(card.video_back_path, 'videos') : null) || deckVideo?.url;

  const getResolvedAudioUrl = (isBackSide = false) => {
    const target = getPhysicalSideAudioSource(card, isBackSide ? 'back' : 'front');
    return target ? resolveAudioUrl(target) : '';
  };

  const renderAudioPlayer = (sideRole, extraProps = {}) => {
    const isBackSide = sideRole === 'back';
    const audioUrl = getResolvedAudioUrl(isBackSide);
    const hasGenerator = Boolean(extraProps.voicePicker && extraProps.cardText && extraProps.cardId);
    if (!audioUrl && !hasGenerator) return null;
    return (
      <CardAudioPlayer
        audioUrl={audioUrl}
        playAudio={audioControls?.playAudio}
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
        isAudioLoading={audioControls?.isAudioLoading}
        isGenerating={card.audio_is_generating}
        resolveAudioUrl={resolveAudioUrl}
        inline={inlineAudio}
        disabled={loading || isAutoplayActive}
        {...extraProps}
      />
    );
  };

  const showExercise = Boolean(exerciseType) && studyMode !== 'speak' && !isAutoplayActive;
  const frontAudioUrl = getResolvedAudioUrl(promptPhysicalSide === 'back');

  const frontFace = (
    <div className="card-inner card-front glass" style={flagStyle}>
      <CardBackground
        background={effectiveConfig?.front?.card?.background}
        styleType={resolvedBgFront}
        cardId={card.id}
        isStatic={!animated}
      />
      <div className="card-face">
        {topFrontSlot}

        {imageUrl && (
          <StudyCardImage
            src={imageUrl}
            height={cardImageHeight}
            cardId={card?.id}
            onResizeStart={onResizeImageStart}
            showResizeHandle={showImageResizeHandle}
          />
        )}

        {videoFrontUrl && <CardVideo key={videoFrontUrl} src={videoFrontUrl} />}

        {requiredActionContent ?? (
          <>
            {!showExercise && studyMode !== 'speak' && (
              <>
                {!content?.layout && <ExerciseInfoBlocks blocks={topBlocks} />}
                {(() => {
                  const defaultPromptBody = (promptPhysicalSide === 'back' || isTheory)
                    ? <MarkdownRenderer>{rawFrontText}</MarkdownRenderer>
                    : rawFrontText;
                  const prompt = (
                    <StudyCardText id={containerId ? 'tut-study-front' : undefined} style={cardStyle}>
                      {renderFrontText ? renderFrontText({ rawFrontText, frontText, cardStyle, promptPhysicalSide, isTheory }) : defaultPromptBody}
                    </StudyCardText>
                  );
                  return content?.layout
                    ? <StructuredCardLayout card={card} exercise={prompt} resolveMediaUrl={resolveMediaUrl} />
                    : prompt;
                })()}
                {(frontAudioUrl || frontAudioPlayerProps?.voicePicker) && renderAudioPlayer(
                  promptPhysicalSide === 'back' ? 'back' : 'front',
                  {
                    isBack: promptPhysicalSide === 'back',
                    ...frontAudioPlayerProps,
                  }
                )}
              </>
            )}

            {showExercise && (
              <ExerciseRenderer
                card={card}
                native
                studyMode={studyMode}
                isPureTrainerMode={false}
                isFlipped={isFlipped}
                onFlip={onFlip}
                playAudio={audioControls?.playAudio}
                onTrainerAnswer={onTrainerAnswer}
                onNextCard={onNextCard}
                renderAudioPlayer={() => renderAudioPlayer(
                  promptPhysicalSide === 'back' ? 'back' : 'front',
                  {
                    isBack: promptPhysicalSide === 'back',
                    ...frontAudioPlayerProps,
                  }
                )}
                designConfig={effectiveConfig}
                savedState={effectiveReviewKey ? exerciseStates[effectiveReviewKey] : undefined}
                onSaveState={handleSaveExerciseState}
                footerActionTarget={exerciseFooterTarget}
                reviewKey={effectiveReviewKey}
                evaluateAnswer={evaluateAnswer}
                isAdmin={isAdmin}
                resolveMediaUrl={resolveMediaUrl}
                allowDictation={allowDictation}
                onBeforeDictation={onBeforeDictation}
              />
            )}

            {studyMode === 'speak' && frontSpeechContent}
          </>
        )}
      </div>
    </div>
  );

  const rawBackText = studySideText(content, promptPhysicalSide === 'back' ? 'front' : 'back');
  const backClean = stripMarkdown(rawBackText).trim();
  const hasDistinctBack = Boolean(backClean && backClean !== frontText.trim());
  const backAudio = getResolvedAudioUrl(studyMode !== 'reverse');
  const showBackAnswerSection = hasDistinctBack || backAudio || videoBackUrl;

  const backReference = exerciseType === 'quiz' && quizData ? (
    <div>
      <div className="back-quiz-question" style={{ ...cardStyle, textAlign: 'left', fontSize: '1.2rem', marginBottom: '8px' }}>
        {quizData.question}
      </div>
      <div className="back-quiz-subdivider">
        <span>{tr('Варианты ответа')}</span>
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
            {opt.isCorrect && <span className="back-quiz-opt-badge">{tr('✓ Верный')}</span>}
          </div>
        ))}
      </div>
    </div>
  ) : (
    <div className="front-mini-container" style={{ position: 'relative', width: '100%' }}>
      {!content?.layout && topBlocks.length > 0 && <ExerciseInfoBlocks blocks={topBlocks} />}
      <div className="text-front-mini" style={{ marginBottom: 0, opacity: 0.95, whiteSpace: 'pre-wrap', ...referenceStyle }}>
        {promptPhysicalSide === 'back' || isTheory ? <MarkdownRenderer>{rawFrontText}</MarkdownRenderer> : frontText}
      </div>
    </div>
  );

  const backFace = (
    <div className="card-inner card-back glass" style={flagStyle}>
      <CardBackground
        background={effectiveConfig?.back?.card?.background}
        styleType={resolvedBgBack}
        cardId={card.id}
        isStatic={!animated}
      />
      <div className="card-face">
        {topBackSlot}

        <div className="card-back-front-section">
          {content?.layout
            ? <StructuredCardLayout card={card} exercise={backReference} afterAnswer resolveMediaUrl={resolveMediaUrl} />
            : backReference}
          {(getResolvedAudioUrl(studyMode === 'reverse') || backFrontAudioPlayerProps?.voicePicker) && (
            <div style={{ marginTop: '8px' }}>
              {renderAudioPlayer(studyMode === 'reverse' ? 'back' : 'front', {
                isBack: studyMode === 'reverse',
                ...backFrontAudioPlayerProps,
              })}
            </div>
          )}
        </div>

        {backQuestionSlot}

        {showBackAnswerSection && (
          <>
            {!exerciseType && (
              <div className="card-side-separator">
                <div className="separator-line" />
                <div className="separator-badge">
                  <RotateCw size={12} />
                  <span>{studyMode === 'reverse' ? tr('Оригинал') : tr('Перевод')}</span>
                </div>
                <div className="separator-line" />
              </div>
            )}

            {videoBackUrl && <CardVideo key={videoBackUrl} src={videoBackUrl} />}

            {(hasDistinctBack || backAudio) && (
              <div className="back-answer-block">
                {backAudio && renderAudioPlayer(studyMode === 'reverse' ? 'front' : 'back', {
                  isBack: studyMode !== 'reverse',
                  ...backAudioPlayerProps,
                })}
                <StudyCardText side="back" id={containerId ? 'tut-study-answer' : undefined} style={backCardStyle}>
                  {studyMode === 'reverse' ? backClean : <MarkdownRenderer>{rawBackText}</MarkdownRenderer>}
                </StudyCardText>
              </div>
            )}
          </>
        )}

        {imageUrl && (
          <div style={{ marginTop: '12px', marginBottom: '12px', flexShrink: 0, width: '100%' }}>
            <StudyCardImage src={imageUrl} height={cardImageHeight} cardId={card?.id} showResizeHandle={false} />
          </div>
        )}

        {personalNotesSlot}

        {content.explanation && (
          <div className="card-context-wrapper">
            <div className="text-context" style={{ whiteSpace: 'pre-wrap', ...contextStyle }}>
              <MarkdownRenderer>{content.explanation}</MarkdownRenderer>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const surfaceContent = (
    <motion.div
      id={containerId}
      ref={surfaceRef}
      key={`${card.id}-${historyIndex}`}
      initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: reduceMotion ? 0 : 0.1 }}
      className={`card-container study-flashcard ${loading ? 'loading-card' : ''} ${className}`.trim()}
      style={flagStyle}
      aria-busy={loading}
    >
      <div className="study-card-perspective">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={isFlipped ? 'back' : 'front'}
            initial={reduceMotion ? false : {
              rotateY: isFlipped ? -90 : 90,
              rotateX: -4,
              z: 36,
              scale: 0.97,
            }}
            animate={reduceMotion ? { rotateY: 0, rotateX: 0, z: 0, scale: 1 } : {
              rotateY: [isFlipped ? -90 : 90, isFlipped ? 3 : -3, 0],
              rotateX: [-4, 1, 0],
              z: [36, 12, 0],
              scale: [0.97, 1.005, 1],
            }}
            exit={reduceMotion ? {} : {
              rotateY: isFlipped ? -90 : 90,
              rotateX: 4,
              z: 36,
              scale: 0.97,
              transition: { duration: 0.22, ease: [0.55, 0, 0.85, 0.4] },
            }}
            transition={{ duration: reduceMotion ? 0 : 0.42, times: [0, 0.76, 1], ease: [0.16, 1, 0.3, 1] }}
            className="study-card-surface"
          >
            {!isFlipped ? frontFace : backFace}
          </motion.div>
        </AnimatePresence>
      </div>

      {showFooter && (
        <div className="study-card-footer">
          <div className="study-card-bottom-bar">
            <div className="study-card-level-slot">
              <CardLevelBadge card={card} expandable={false} style={{ maxWidth: '100%' }} />
            </div>
            <div className="study-card-footer-actions">
              <div ref={setExerciseFooterTarget} className="study-card-footer-action-target" />
              {!blockAnswerReveal && onFlip && (
                <button
                  type="button"
                  className="study-card-flip-button"
                  disabled={loading || isAutoplayActive}
                  onClick={() => onFlip(!isFlipped)}
                >
                  <RotateCw size={18} aria-hidden="true" />
                  <span>{tr('Перевернуть карточку')}</span>
                </button>
              )}
            </div>
            {footerRightSlot}
          </div>
          {footerBottomSlot}
        </div>
      )}

      {loading && (
        <div className="card-loading-overlay">
          <RefreshCw size={40} className="spin" />
        </div>
      )}
    </motion.div>
  );

  return (
    <MediaResolverProvider
      resolveMediaUrl={resolveMediaUrl}
      resolveAudioUrl={resolveAudioUrl}
      isLocalAssetUrl={isLocalAssetUrl}
    >
      <div className={`lerne-card-ui-root ${rootClassName}`.trim()} style={designVariables}>
        {animated ? <AnimatePresence mode="sync" initial={false}>{surfaceContent}</AnimatePresence> : surfaceContent}
      </div>
    </MediaResolverProvider>
  );
});
