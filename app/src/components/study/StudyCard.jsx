import { tr, getInterfaceLanguage } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { stripMarkdown } from '../../utils/text';
import { MarkdownRenderer } from '../common/MarkdownRenderer';
import { useDeckStore } from '../../store/useDeckStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUiStore } from '../../store/useUiStore';
import { StudyCardSpeech } from './StudyCardSpeech.jsx';
import { CardQuestionComposer } from './CardQuestionComposer.jsx';
import { KaraokeText } from './KaraokeText';
import { useVoicePicker } from '../../hooks/useVoicePicker';
import { useKaraokeSync } from '../../hooks/useKaraokeSync';
import { stopGlobalAudio } from '../../hooks/useAudio.js';
import { evaluateFreeTextAnswer } from '../../services/answerEvaluationService.js';
import { mediaURL } from '../../services/apiConfig.js';
import { getAudioUrl } from '../../utils/media';
import { isPlatformAssetUrl } from '../../utils/platform';
import { getPhysicalSideAudioSource, getStudyRolePhysicalSide, PEDAGOGICAL_ROLE } from '../../utils/studyCardRoles.js';
import { getDesignStylesFromV2 } from '../../utils/cardStyles';
import { canEditContainer, findCardDeck, isBundledSeedCard } from '../../utils/deckUtils.js';
import { CardActionButton } from '../modals/CardActionModal';
import { CardRating } from './CardRating';
import { useCardNotes } from '../../hooks/useCardNotes';
import { layoutAnswerRevealed, studyContent, studyExerciseType, studySideText } from '../../utils/structuredStudyCard.js';
import { useStudyCardControls } from '../../hooks/useStudyCardControls';
import { canRevealFreeTextAnswer } from '../../utils/freeTextEvaluationState.js';
import { NativeCardViewer } from '../../card-ui/NativeCardViewer.jsx';
import { IS_STANDALONE } from '../../utils/standaloneMode.js';
import { getStudySpeakableText, isTargetLanguageCardSide } from '../../pilot/tts/ttsService.js';

const LeechBadge = ({ lapses }) => (
  <div
    className="leech-badge"
    title={tr('Сложная карточка ({{p0}} ошибок). Рекомендуем упростить или добавить мнемонику.', { p0: lapses || 5 })}
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
      alignSelf: 'center',
    }}
  >
    <AlertTriangle size={12} color="#ef4444" />
    <span>{tr('Сложная карточка (')}{lapses || 5}{' '}{tr('ошибок)')}</span>
  </div>
);

export const StudyCard = React.memo(({
  card,
  isFlipped,
  onFlip: requestFlip,
  loading,
  historyIndex,
  playAudio,
  audioControls,
  sessionVoice = null,
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
  controlsEnabled = true,
}) => {
  useInterfaceLocale();
  const surfaceRef = useRef(null);

  const handleAsk = async (req) => {
    try {
      return Boolean(await onAskQuestion(req));
    } catch {
      return false;
    }
  };

  const cardLang = card?.target_language
    || useDeckStore.getState().currentDeck?.target_language
    || useLanguageStore.getState().activeLanguage
    || 'de';

  const deckId = useDeckStore.getState().currentDeck?.id;
  const notes = useCardNotes(card?.id, card?.deck_id ?? deckId, true);
  const content = studyContent(card);

  const handleVoiceChange = useCallback((voiceValue) => {
    sessionVoice?.setSessionVoice(deckId, voiceValue);
  }, [sessionVoice, deckId]);

  const storedVoice = sessionVoice?.getSessionVoice(deckId) || null;
  const frontVoicePicker = useVoicePicker(cardLang, storedVoice, handleVoiceChange, false, true);
  const isTargetLangBack = studyMode === 'reverse' || isTargetLanguageCardSide(content, 'back');
  const backSideLang = isTargetLangBack ? cardLang : getInterfaceLanguage();
  const backVoicePicker = useVoicePicker(backSideLang, isTargetLangBack ? storedVoice : null, null, false, true);

  const exerciseType = studyExerciseType(content);
  const promptPhysicalSide = getStudyRolePhysicalSide(PEDAGOGICAL_ROLE.PROMPT, studyMode);
  const rawFrontText = studySideText(content, promptPhysicalSide);
  const frontText = stripMarkdown(rawFrontText);
  const narrating = audioControls?.audioState === 'playing' || audioControls?.audioState === 'paused';

  const { activeWordIndex } = useKaraokeSync(
    frontVoicePicker.wordBoundaries,
    frontText,
    audioControls?.duration ?? 0,
    audioControls?.currentTime ?? 0,
    audioControls?.audioState ?? 'idle',
  );

  const [exerciseStates, setExerciseStates] = useState({});
  const [exerciseVersions, setExerciseVersions] = useState({});
  const seen = exerciseVersions[card?.id];
  if (content && seen?.data !== content.data) {
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
  const reviewKey = card?.id != null
    ? `${(stepFlow?.hasRequiredActions ? stepFlow.reviewKey : null) || `${card.id}:${historyIndex}`}:${seen?.version ?? 0}`
    : null;

  const currentExerciseState = reviewKey ? exerciseStates[reviewKey] : undefined;
  const answerRevealed = Boolean(isFlipped || layoutAnswerRevealed(currentExerciseState));
  const frontSideLang = promptPhysicalSide === 'back' && studyMode !== 'reverse' && !isTargetLanguageCardSide(content, 'back')
    ? getInterfaceLanguage()
    : cardLang;
  const frontSpeakableText = IS_STANDALONE
    ? getStudySpeakableText(content, promptPhysicalSide, { isFlipped, answerRevealed, lang: frontSideLang })
    : frontText;
  const revealedFrontSpeakableText = IS_STANDALONE
    ? getStudySpeakableText(content, 'front', { isFlipped: true, answerRevealed: true, lang: cardLang })
    : frontText;
  const backAnswerSide = promptPhysicalSide === 'back' ? 'front' : 'back';
  const backSpeakableText = content
    ? getStudySpeakableText(content, backAnswerSide, { isFlipped: true, answerRevealed: true, lang: backSideLang })
    : '';

  useEffect(() => {
    frontVoicePicker.setCardText(frontSpeakableText);
    frontVoicePicker.setPreviewUrl(null);
  }, [card?.id, frontSpeakableText]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    backVoicePicker.setCardText(backSpeakableText);
    backVoicePicker.setPreviewUrl(null);
  }, [card?.id, backSpeakableText]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveExerciseState = useCallback((state, key) => {
    const targetKey = key ?? reviewKey;
    if (!targetKey) return;
    setExerciseStates(prev => ({ ...prev, [targetKey]: state }));
  }, [reviewKey]);

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
      setCardImageHeight(Math.max(60, Math.min(800, startH + (clientY - startY))));
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
  const isAdmin = useSettingsStore(state => state.isAdmin);
  const playerCollapsed = useSettingsStore(state => state.playerCollapsed);
  const setPlayerCollapsed = useSettingsStore(state => state.setPlayerCollapsed);
  const useLocalTtsWhenAudioMissing = useSettingsStore(state => state.useLocalTtsWhenAudioMissing);
  const openSettings = useUiStore(state => state.openSettings);
  const contextStyle = useMemo(() => getDesignStylesFromV2(effectiveConfig).contextText, [effectiveConfig]);

  const blockAnswerReveal = ['free_text', 'editable_text'].includes(exerciseType)
    && studyMode !== 'speak'
    && !isAutoplayActive
    && !canRevealFreeTextAnswer(exerciseStates[reviewKey]?.evaluationState);

  const onFlip = next => {
    if (!loading && !isAutoplayActive && (!next || !blockAnswerReveal)) requestFlip(next);
  };

  useStudyCardControls({
    surfaceRef,
    reviewKey: `${reviewKey}:${card?.id}:${studyMode}:${isFlipped}`,
    enabled: controlsEnabled && !loading,
    isFlipped,
    onFlip,
    onPrevious: onPreviousCard,
    onNext: onNavigateNext,
  });

  if (!card || !content) return null;

  const deckStoreState = useDeckStore.getState();
  const currentDeckObj = deckStoreState.currentDeck;
  const ownerDeck = findCardDeck(deckStoreState, card?.deck_id ?? deckId);
  let deckMeta = card.deck_metadata;
  if (!deckMeta && currentDeckObj?.metadata) {
    deckMeta = typeof currentDeckObj.metadata === 'string'
      ? JSON.parse(currentDeckObj.metadata)
      : currentDeckObj.metadata;
  } else if (typeof deckMeta === 'string') {
    try { deckMeta = JSON.parse(deckMeta); } catch { /* pass */ }
  }
  const deckResources = deckMeta?.resources || [];

  const requiredActionContent = stepFlow?.currentStep && stepFlow.currentStep.action !== 'answer'
    ? renderRequiredAction?.({ card, stepFlow, audioControls })
    : null;

  const isBackPrompt = promptPhysicalSide === 'back';
  const isReverse = studyMode === 'reverse';
  const hasLeech = Boolean(card?.is_leech || (card?.lapses && card.lapses >= 5));
  const leechBadge = hasLeech ? <LeechBadge lapses={card?.lapses} /> : null;

  const allowSaveToCard = Boolean(ownerDeck) && canEditContainer(ownerDeck, false) && !isBundledSeedCard(card);

  const sharedAudioUi = {
    collapsed: playerCollapsed,
    onCollapsedChange: setPlayerCollapsed,
    onOpenSettings: () => openSettings('voice'),
    isAudioLoading: isAudioLoading || audioControls?.isAudioLoading,
    preferLocalStudyTts: IS_STANDALONE,
    allowSaveToCard,
  };

  const hasExistingFrontAudio = Boolean(getPhysicalSideAudioSource(card, promptPhysicalSide));
  const canUseFrontGenerator = !IS_STANDALONE
    || (frontVoicePicker.isOfflineLocalAvailable && (hasExistingFrontAudio || useLocalTtsWhenAudioMissing));
  const showFrontGenerator = !isBackPrompt && Boolean(frontSpeakableText) && canUseFrontGenerator;
  const showFrontAudio = Boolean(hasExistingFrontAudio || showFrontGenerator);

  const hasExistingBackFrontAudio = Boolean(getPhysicalSideAudioSource(card, isReverse ? 'back' : 'front'));
  const canUseBackFrontGenerator = !IS_STANDALONE
    || (frontVoicePicker.isOfflineLocalAvailable && (hasExistingBackFrontAudio || useLocalTtsWhenAudioMissing));
  const showBackFrontGenerator = !isReverse && Boolean(revealedFrontSpeakableText) && canUseBackFrontGenerator;
  const showBackFrontAudio = Boolean(hasExistingBackFrontAudio || showBackFrontGenerator);

  const hasExistingBackAnswerAudio = Boolean(getPhysicalSideAudioSource(card, isReverse ? 'front' : 'back'));
  const showBackAnswerGenerator = IS_STANDALONE
    && backVoicePicker.isOfflineLocalAvailable
    && Boolean(backSpeakableText)
    && backSpeakableText !== frontText.trim()
    && (hasExistingBackAnswerAudio || useLocalTtsWhenAudioMissing);

  const frontAudioPlayerProps = {
    ...sharedAudioUi,
    voicePicker: showFrontGenerator ? frontVoicePicker : null,
    cardText: showFrontGenerator ? frontSpeakableText : '',
    cardId: showFrontGenerator ? card?.id : null,
  };

  const backFrontAudioPlayerProps = {
    ...sharedAudioUi,
    voicePicker: showBackFrontGenerator ? frontVoicePicker : null,
    cardText: showBackFrontGenerator ? revealedFrontSpeakableText : '',
    cardId: showBackFrontGenerator ? card?.id : null,
  };

  const backAudioPlayerProps = {
    ...sharedAudioUi,
    disabled: loading || isAudioLoading,
    ...(showBackAnswerGenerator
      ? {
          isBack: !isTargetLangBack,
          voicePicker: backVoicePicker,
          cardText: backSpeakableText,
          cardId: card?.id,
        }
      : {}),
  };

  const existingSpeakAudioUrl = getAudioUrl(getPhysicalSideAudioSource(card, 'front'));
  const canPlayInSpeakMode = Boolean(existingSpeakAudioUrl) || !IS_STANDALONE || (
    useLocalTtsWhenAudioMissing
    && frontVoicePicker.isOfflineLocalAvailable
    && Boolean(revealedFrontSpeakableText)
  );

  return (
    <NativeCardViewer
      card={card}
      designConfig={effectiveConfig}
      isFlipped={isFlipped}
      onFlip={onFlip}
      loading={loading}
      historyIndex={historyIndex}
      studyMode={studyMode}
      isAutoplayActive={isAutoplayActive}
      resolvedBgFront={resolvedBgFront}
      resolvedBgBack={resolvedBgBack}
      animated
      containerId="tut-study-card"
      surfaceRef={surfaceRef}
      reviewKey={reviewKey}
      exerciseStates={exerciseStates}
      onSaveExerciseState={handleSaveExerciseState}
      cardImageHeight={cardImageHeight}
      onResizeImageStart={startCardImageResize}
      showImageResizeHandle
      deckResources={deckResources}
      resolveMediaUrl={mediaURL}
      resolveAudioUrl={getAudioUrl}
      isLocalAssetUrl={isPlatformAssetUrl}
      allowDictation={!IS_STANDALONE}
      audioControls={{
        ...audioControls,
        playAudio: audioControls?.playAudio || playAudio,
        isAudioLoading: isAudioLoading || audioControls?.isAudioLoading,
      }}
      frontAudioPlayerProps={showFrontAudio ? frontAudioPlayerProps : { voicePicker: null }}
      backFrontAudioPlayerProps={showBackFrontAudio ? backFrontAudioPlayerProps : { voicePicker: null }}
      backAudioPlayerProps={backAudioPlayerProps}
      renderFrontText={({ rawFrontText: raw, frontText: plain, cardStyle: style, promptPhysicalSide: side, isTheory: theory }) => (
        side === 'back' || (theory && !narrating)
          ? <MarkdownRenderer>{raw}</MarkdownRenderer>
          : <KaraokeText text={plain} activeWordIndex={activeWordIndex} style={style} />
      )}
      evaluateAnswer={IS_STANDALONE ? null : evaluateFreeTextAnswer}
      isAdmin={isAdmin}
      onBeforeDictation={stopGlobalAudio}
      onTrainerAnswer={onTrainerAnswer}
      onNextCard={onNextCard}
      requiredActionContent={requiredActionContent}
      frontSpeechContent={(
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
          onPlayCardAudio={!canPlayInSpeakMode ? null : async () => {
            if (existingSpeakAudioUrl) {
              playAudio?.(existingSpeakAudioUrl);
              return;
            }
            const url = IS_STANDALONE
              ? await frontVoicePicker.generateOrGetLocalStudyAudio(revealedFrontSpeakableText, false)
              : await frontVoicePicker.generateAndSaveToCard(card?.id, frontText, false);
            if (url) playAudio?.(getAudioUrl(url) || url);
          }}
          stopAudio={audioControls?.stopAudio}
          isAudioLoading={isAudioLoading}
          isAutoplayActive={isAutoplayActive}
        />
      )}
      topFrontSlot={leechBadge}
      topBackSlot={leechBadge}
      backQuestionSlot={(
        <>
          {!IS_STANDALONE && <CardQuestionComposer key={card?.id} onSubmit={handleAsk} submitLabel={tr('Задать')} />}
          {aiExplanation && (
            <div className="ai-explanation-block card-context-wrapper">
              <strong>{tr('Ответ ИИ:')}</strong>
              <div className="text-context" style={{ whiteSpace: 'pre-wrap', ...contextStyle }}>
                <MarkdownRenderer>{aiExplanation.answer}</MarkdownRenderer>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={isSavingExplanation}
                style={{ minHeight: '44px', width: '100%', marginTop: '12px', whiteSpace: 'normal' }}
                onClick={event => { event.stopPropagation(); onSaveExplanation?.(); }}
              >
                {isSavingExplanation ? tr('Выполняется...') : tr('Сохранить в Контекст')}
              </button>
            </div>
          )}
        </>
      )}
      personalNotesSlot={notes.rows.length > 0 ? (
        <div className="card-context-wrapper card-personal-notes">
          <strong>{tr('Мои заметки')}</strong>
          {notes.rows.map(row => (
            <div key={row.id} className="text-context" style={{ whiteSpace: 'pre-wrap', ...contextStyle }}>
              {row.text}
            </div>
          ))}
        </div>
      ) : null}
      footerRightSlot={<CardActionButton card={card} size={20} className="study-card-actions-button" refreshNotes />}
      footerBottomSlot={!IS_STANDALONE && <CardRating key={card?.id} card={card} deckId={card?.deck_id ?? deckId} />}
      inlineAudio={false}
    />
  );
});
