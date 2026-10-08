import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Trash2, Music, ChevronDown, ChevronUp, Pause, Play as PlayIcon } from 'lucide-react';
import DeckAudioPlayer from '../common/DeckAudioPlayer';
import api from '../../services/api';
import { useUiStore } from '../../store/useUiStore';
import { useDeckStore } from '../../store/useDeckStore';
import { useSessionStore } from '../../store/useSessionStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { getTtsVoiceForLang } from '../../constants/languageConstants';
import { useCardActions } from '../../hooks/useCardActions';
import { useMediaUpload } from '../../hooks/useMediaUpload';
import { CardActionButton } from '../modals/CardActionModal';
import { useAudio } from '../../hooks/useAudio';
import { useAutoplay } from '../../hooks/useAutoplay';
import { useCardNavigation } from '../../hooks/useCardNavigation';
import { useSessionVoice } from '../../hooks/useSessionVoice';
import { MediaPicker } from '../common/MediaPicker';
import { navigateUp, returnToStudyTheme } from '../../utils/navigation';
import { getNextThemeDeck, isLastThemeDeck } from '../../utils/studyFlow';
import { useStudyNavigation } from '../../hooks/useStudyNavigation';
import { StudyError } from './StudyError';
import { getAudioUrl } from '../../utils/media';
import { getUserId } from '../../utils/auth';
import { useStudyStepFlow } from '../../hooks/useStudyStepFlow.js';
import { canGradeStudyFlow, isSuccessfulStudyAnswer, STUDY_ACTION } from '../../utils/studySteps.js';


// Sub-components
import { StudyHeader } from './StudyHeader';
import { StudyNavigation } from './StudyNavigation';
import { GradeButtons } from './GradeButtons';
import { StudyFinished } from './StudyFinished';
import { StudyCard } from './StudyCard';
import { StudyCardSpeech } from './StudyCardSpeech.jsx';
import { getSpeechFollowupTarget } from '../../utils/speechFollowup.js';

export const StudyView = ({ requiredActions, renderRequiredAction } = {}) => {
  useInterfaceLocale();
  const { view, loading, setIsSettingsOpen, showToast, userProfile, setIsAuthModalOpen } = useUiStore();
  const { currentDeck, decks, fetchDuplicates, duplicateCards, deckCards } = useDeckStore();
  const { card, isFlipped, setIsFlipped, historyIndex, sessionRevision, apiError, isSessionFinished, studyHistory, isLearningMore, autoplayState, pendingGrades, gradeErrors, dismissGradeError } = useSessionStore();
  const { submitGrade, goBack, goNext, fetchNextCard, handleDeleteCard, runAiGenerator } = useCardActions();
  const { startStudy } = useStudyNavigation();
  const { openEditor, openCreator } = useCardNavigation();
  const { uploadStudyImage } = useMediaUpload();

  const autoPlay = useSettingsStore(s => s.autoPlay);
  const cardBgFront = useSettingsStore(s => s.cardBgFront);
  const cardBgBack = useSettingsStore(s => s.cardBgBack);
  const studyMode = useSettingsStore(s => s.studyMode);
  const setStudyMode = useSettingsStore(s => s.setStudyMode);
  const randomEnabledModes = useSettingsStore(s => s.randomEnabledModes);
  const setRandomEnabledModes = useSettingsStore(s => s.setRandomEnabledModes);
  const speechFollowupEnabled = useSettingsStore(s => s.speechFollowupEnabled);
  const setSpeechFollowupEnabled = useSettingsStore(s => s.setSpeechFollowupEnabled);
  const autoplayLoop = useSettingsStore(s => s.autoplayLoop);
  const alwaysRegenerateAudio = useSettingsStore(s => s.alwaysRegenerateAudio);
  const cardFont = useSettingsStore(s => s.cardFont);
  const cardTextColor = useSettingsStore(s => s.cardTextColor);
  const cardFontSize = useSettingsStore(s => s.cardFontSize);
  const cardFontWeight = useSettingsStore(s => s.cardFontWeight);
  const cardFontStyle = useSettingsStore(s => s.cardFontStyle);
  const cardTextShadow = useSettingsStore(s => s.cardTextShadow);
  const cardTextAlign = useSettingsStore(s => s.cardTextAlign);
  const backTextColor = useSettingsStore(s => s.backTextColor);
  const contextFont = useSettingsStore(s => s.contextFont);
  const contextTextColor = useSettingsStore(s => s.contextTextColor);
  const contextFontSize = useSettingsStore(s => s.contextFontSize);
  const contextFontWeight = useSettingsStore(s => s.contextFontWeight);
  const contextFontStyle = useSettingsStore(s => s.contextFontStyle);
  const contextTextShadow = useSettingsStore(s => s.contextTextShadow);
  const contextTextAlign = useSettingsStore(s => s.contextTextAlign);

  const styleSettings = React.useMemo(() => ({
    cardFont, cardTextColor, cardFontSize, cardFontWeight, cardFontStyle, cardTextShadow, cardTextAlign,
    backTextColor,
    contextFont, contextTextColor, contextFontSize, contextFontWeight, contextFontStyle, contextTextShadow, contextTextAlign
  }), [cardFont, cardTextColor, cardFontSize, cardFontWeight, cardFontStyle, cardTextShadow, cardTextAlign, backTextColor, contextFont, contextTextColor, contextFontSize, contextFontWeight, contextFontStyle, contextTextShadow, contextTextAlign]);

  const {
    playAudio,
    pauseAudio,
    resumeAudio,
    togglePlayPause,
    stopAudio,
    seekAudio,
    setPlaybackSpeed,
    preloadAudio,
    isAudioLoading,
    audioState,
    currentUrl,
    currentTime,
    duration,
    playbackRate,
    startBackgroundLock,
    stopBackgroundLock,
  } = useAudio(autoPlay, showToast);

  // Bundle all playback controls into a single object so child components
  // stay decoupled from StudyView's internal structure (easy to extend later)
  const audioControls = React.useMemo(() => ({
    playAudio, pauseAudio, resumeAudio, togglePlayPause, stopAudio, seekAudio,
    setPlaybackSpeed, preloadAudio, isAudioLoading, audioState,
    currentUrl, currentTime, duration, playbackRate,
  }), [
    playAudio, pauseAudio, resumeAudio, togglePlayPause, stopAudio, seekAudio,
    setPlaybackSpeed, preloadAudio, isAudioLoading, audioState,
    currentUrl, currentTime, duration, playbackRate,
  ]);

  const queueStats = React.useMemo(() => {
    if (card?.deck_stats && typeof card.deck_stats === 'object') {
      return {
        new: card.deck_stats.new ?? 0,
        due: card.deck_stats.due ?? 0,
        learning: card.deck_stats.learning ?? 0
      };
    }

    if (deckCards && deckCards.length > 0) {
      const now = new Date();
      let newCount = 0;
      let learningCount = 0;
      let dueCount = 0;

      deckCards.forEach(c => {
        const q = c.queue || 'new';
        if (q === 'new') {
          newCount++;
        } else if (q === 'learning' || q === 'relearning') {
          learningCount++;
        } else if (q === 'review') {
          if (!c.next_review || new Date(c.next_review) <= now) {
            dueCount++;
          }
        }
      });

      return {
        new: newCount,
        due: dueCount,
        learning: learningCount
      };
    }

    return {
      new: currentDeck?.stats?.new ?? 0,
      due: currentDeck?.stats?.due ?? 0,
      learning: currentDeck?.stats?.learning ?? 0
    };
  }, [card?.deck_stats, deckCards, currentDeck?.stats]);

  const currentCardSrsStatus = React.useMemo(() => {
    if (!card) return null;
    const queue = card.queue || 'new';
    if (queue === 'learning' || queue === 'relearning') {
      const step = (card.step_index || 0) + 1;
      return {
        label: tr("🟡 На закреплении (шаг {{p0}})", { p0: step }),
        title: tr("Карточка на этапе краткосрочного закрепления"),
        style: {
          background: 'rgba(234, 179, 8, 0.18)',
          color: '#fde047',
          border: '1px solid rgba(234, 179, 8, 0.35)'
        }
      };
    }
    if (queue === 'review') {
      if (isLearningMore && card.next_review && new Date(card.next_review) > new Date()) {
        return {
          label: tr('↻ Дополнительное повторение'),
          title: tr('Карточка повторяется раньше запланированного срока'),
          style: {
            background: 'rgba(59, 130, 246, 0.18)',
            color: '#93c5fd',
            border: '1px solid rgba(59, 130, 246, 0.35)'
          }
        };
      }
      const days = card.interval || 1;
      return {
        label: tr("🔴 К повторению (интервал {{p0}} дн)", { p0: days }),
        title: tr("Настал срок интервального повторения карточки"),
        style: {
          background: 'rgba(239, 68, 68, 0.18)',
          color: '#fca5a5',
          border: '1px solid rgba(239, 68, 68, 0.35)'
        }
      };
    }
    return {
      label: tr("🔵 Новая карточка"),
      title: tr("Карточка открывается впервые"),
      style: {
        background: 'rgba(59, 130, 246, 0.18)',
        color: '#93c5fd',
        border: '1px solid rgba(59, 130, 246, 0.35)'
      }
    };
  }, [card, isLearningMore]);

  const autoplay = useAutoplay({ card, playAudio, stopAudio, showToast, startBackgroundLock, stopBackgroundLock });
  const isAutoplayActive = autoplayState === 'playing' || autoplayState === 'paused';

  useEffect(() => {
    useSessionStore.getState().registerAutoplayHandlers?.({
      startAutoplayFn: autoplay.start,
      stopAutoplayFn: autoplay.stop,
      pauseAutoplayFn: autoplay.pause,
      resumeAutoplayFn: autoplay.resume
    });
    return () => {
      useSessionStore.getState().unregisterAutoplayHandlers?.();
    };
  }, [autoplay.start, autoplay.stop, autoplay.pause, autoplay.resume]);

  // Session-level voice memory: voice choice persists across card navigation within a deck
  const sessionVoice = useSessionVoice();

  const [isImagePickerOpen, setIsImagePickerOpen] = useState(false);
  const previousAutoplayStateRef = useRef(autoplayState);
  const suppressLegacyAutoplayCardRef = useRef(null);
  const lastAutoplayedCardRef = useRef(null);
  
  // Local UI & Animation State
  const [activeRandomMode, setActiveRandomMode] = useState(null);
  const [exerciseEvidence, setExerciseEvidence] = useState(null);
  const effectiveStudyMode = isAutoplayActive ? 'classic' : studyMode === 'random' ? (activeRandomMode || 'classic') : studyMode;
  // Opt-in: attach a speak step only where a complete target sentence is known.
  // Snapshot the toggle for each review; changing it mid-exercise must not reset a solved answer.
  const speechPlanRef = useRef({ key: null, target: null });
  const speechPlanKey = `${sessionRevision}:${card?.id}:${historyIndex}:${effectiveStudyMode}:${isAutoplayActive}`;
  if (speechPlanRef.current.key !== speechPlanKey) {
    speechPlanRef.current = {
      key: speechPlanKey,
      target: speechFollowupEnabled && !isAutoplayActive && effectiveStudyMode !== 'speak'
        ? getSpeechFollowupTarget(card, effectiveStudyMode) : null,
    };
  }
  const speechFollowupTarget = speechPlanRef.current.target;
  const autoSpeechActions = speechFollowupTarget && requiredActions == null && card?.requiredActions == null
    ? ['answer', 'speak'] : null;
  const configuredActions = requiredActions ?? card?.requiredActions ?? autoSpeechActions;
  const hasRequiredActions = configuredActions != null && !isAutoplayActive;
  const stepFlow = useStudyStepFlow({
    cardId: card?.id, historyIndex, sessionRevision, studyMode: effectiveStudyMode,
    requiredActions: hasRequiredActions ? configuredActions : undefined,
  });
  const { currentStep, completeStep } = stepFlow;
  const canGrade = canGradeStudyFlow(stepFlow, hasRequiredActions);
  const isAutoSpeechReview = Boolean(autoSpeechActions);
  const renderSpeechFollowup = useCallback(({ card: actionCard, stepFlow: actionFlow, audioControls: controls, styles }) => {
    if (!speechFollowupTarget || actionFlow.currentStep?.action !== STUDY_ACTION.SPEAK) return null;
    return (
      <StudyCardSpeech
        key={`${actionFlow.reviewKey}:${actionFlow.currentStep.id}`}
        card={actionCard}
        reviewKey={actionFlow.reviewKey}
        targetText={speechFollowupTarget}
        styles={styles}
        stopAudio={controls?.stopAudio}
        onSuccess={actionFlow.completeStep}
        onSkip={() => actionFlow.completeStep({ skipped: true, action: 'speak' })}
        followUp
      />
    );
  }, [speechFollowupTarget]);
  // The speech step lives on the front: don't strand learners on a flipped card.
  useEffect(() => {
    if (isAutoSpeechReview && currentStep?.action === STUDY_ACTION.SPEAK && isFlipped) setIsFlipped(false);
  }, [isAutoSpeechReview, currentStep?.action, isFlipped, setIsFlipped]);
  const handleExerciseAnswer = useCallback((cardId, evidence) => {
    const latest = useSessionStore.getState();
    if (String(cardId) !== String(card?.id) || String(latest.card?.id) !== String(cardId)
      || latest.historyIndex !== historyIndex || latest.sessionRevision !== sessionRevision) return;
    if (evidence && typeof evidence === 'object') setExerciseEvidence(evidence);
    if (currentStep?.action === STUDY_ACTION.ANSWER && isSuccessfulStudyAnswer(evidence)) completeStep(evidence);
  }, [card?.id, historyIndex, sessionRevision, currentStep?.action, completeStep]);
  const handleSpeechSuccess = useCallback((result) => {
    if (currentStep?.action === STUDY_ACTION.SPEAK
      || (!hasRequiredActions && currentStep?.action === STUDY_ACTION.ANSWER)) completeStep(result);
  }, [currentStep?.action, hasRequiredActions, completeStep]);
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const lastCardKeyRef = useRef('');

  useEffect(() => {
    setExerciseEvidence(null);
  }, [card?.id, historyIndex, studyMode]);

  // Scroll logic removed to prevent scrollHeight jumps and geometry instability
  useEffect(() => {
    const container = document.getElementById('app-container');
    if (container) {
      container.scrollTop = 0;
    }
    setIsHeaderVisible(true);
  }, [card?.id]);



  const onDeleteDuplicate = async (e) => {
    e.stopPropagation();
    if (window.confirm(tr("Удалить этот дубликат?"))) {
      try {
        await handleDeleteCard(card.id, true);
        fetchDuplicates(); // Update the list in background
      } catch {
        showToast(tr("Ошибка при удалении"));
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

  const cardId = card?.id;

  useEffect(() => {
    const isSuppressedAfterAutoplay = suppressLegacyAutoplayCardRef.current === cardId;
    const currentCardKey = `${cardId}-${historyIndex}`;
    const isAutoplayEnabledMode = studyMode === 'classic' || (studyMode === 'random' && activeRandomMode === 'classic');
    const shouldStart = view === 'study' && cardId && autoPlay && isAutoplayEnabledMode
      && !loading && !isAutoplayActive && !isSuppressedAfterAutoplay
      && lastAutoplayedCardRef.current !== currentCardKey;
    if (shouldStart) {
      lastAutoplayedCardRef.current = currentCardKey;
      let cancelled = false;
      const timer = setTimeout(async () => {
        const latestCard = useSessionStore.getState().card;
        if (!latestCard || String(latestCard.id) !== String(cardId)) return;

        let url = getAudioUrl(latestCard.audio_url || latestCard.audio_path);
        const updateAudioState = (patch) => {
          useSessionStore.getState().updateCardInSession?.(cardId, patch);
          useDeckStore.getState().updateCardLocal?.(cardId, patch);
        };
        const generateAudio = async () => {
          updateAudioState({ audio_is_generating: true });
          try {
            const settings = useSettingsStore.getState();
            const currentCardData = useSessionStore.getState().card || latestCard;
            const targetLanguage = currentCardData.target_language || currentDeck?.target_language || 'de';
            const generated = await api.post('/media/generate-card-audio', {
              card_id: cardId,
              side: 'front',
              text: currentCardData.front || currentCardData.front_text,
              lang: targetLanguage,
              rate: `${Number(settings.ttsSpeed) >= 0 ? '+' : ''}${Number(settings.ttsSpeed) || 0}%`,
              voice: getTtsVoiceForLang(targetLanguage, settings.adminSettings, settings.ttsVoices),
            });
            const patch = {
              audio_path: generated.data.path,
              audio_url: generated.data.url,
              audio_is_generating: false,
            };
            updateAudioState(patch);
            return getAudioUrl(generated.data.url || generated.data.path) || generated.data.url;
          } catch (error) {
            updateAudioState({ audio_is_generating: false });
            throw error;
          }
        };
        try {
          if (!url || alwaysRegenerateAudio) {
            url = await generateAudio();
            if (cancelled) return;
          }
          if (!cancelled && url) {
            await playAudio(url, undefined, (playbackErr) => {
              console.warn('[StudyView] Audio playback warning:', url, playbackErr);
            });
          }
        } catch (err) {
          if (!cancelled) {
            console.error('Automatic audio generation failed:', err);
            showToast(tr("Не удалось автоматически создать озвучку: {{p0}}", { p0: err.response?.data?.detail || err.message }));
          }
        }
      }, 300);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }
  }, [cardId, historyIndex, autoPlay, view, loading, isAutoplayActive, playAudio, studyMode, activeRandomMode, alwaysRegenerateAudio, currentDeck?.target_language, showToast]);

  useEffect(() => {
    if (studyMode === 'random') {
      const currentCardKey = card ? `${card.id}-${historyIndex}` : '';
      const cardChanged = lastCardKeyRef.current !== currentCardKey;
      const enabled = randomEnabledModes || [];
      
      if (cardChanged || !activeRandomMode || !enabled.includes(activeRandomMode)) {
        lastCardKeyRef.current = currentCardKey;
        if (enabled.length > 0) {
          const randomIndex = Math.floor(Math.random() * enabled.length);
          queueMicrotask(() => setActiveRandomMode(enabled[randomIndex]));
        } else {
          queueMicrotask(() => setActiveRandomMode('classic'));
        }
      }
    } else {
      queueMicrotask(() => setActiveRandomMode(null));
      lastCardKeyRef.current = '';
    }
  }, [card?.id, historyIndex, studyMode, randomEnabledModes, activeRandomMode]); // eslint-disable-line react-hooks/exhaustive-deps



  const availableStyles = ['mesh', 'aurora', 'holographic', 'liquid', 'liquid_sunset', 'liquid_ocean', 'liquid_cosmic', 'liquid_emerald', 'video_aquarium', 'video_space', 'video_nature'];
  const getResolvedStyle = (settingStyle, cardId) => {
    if (settingStyle !== 'auto') return settingStyle;
    if (!cardId) return 'standard';
    const sum = cardId.toString().split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    return availableStyles[sum % availableStyles.length];
  };

  const resolvedBgFront = getResolvedStyle(cardBgFront, card?.id);
  const resolvedBgBack = getResolvedStyle(cardBgBack, card?.id);

  const nextDeck = getNextThemeDeck(decks, currentDeck);
  const lastDeck = isLastThemeDeck(decks, currentDeck);
  const nextReview = deckCards.map(c => c.next_review).filter(date => date && new Date(date) > new Date()).sort()[0];
  const handleGoToTheme = () => {
    stopAudio();
    returnToStudyTheme();
    useDeckStore.getState().fetchDecks(true).catch(console.error);
  };
  const handleStartStudy = (deck, reviewContext = 'scheduled') => {
    stopAudio();
    autoplay.stop();
    return startStudy(deck, { reviewContext });
  };

  const buildStudyContext = async (targetCard, mode) => {
    try {
      const { detectExerciseType } = await import('../../utils/exerciseDetector.js');
      const computedType = detectExerciseType(targetCard, mode);
      
      if (computedType === 'word_bank') {
         const { parseWordBankData } = await import('../../utils/wordBankParser.js');
         const wbData = parseWordBankData(targetCard);
         if (wbData) {
           return `Упражнение Wordbank (заполнение пропусков из списка).
Текст упражнения:
${wbData.maskedText}

Доступные варианты: ${wbData.options.map(o => o.value).join(' | ')}
Правильные ответы:
${wbData.gaps.map(g => `${g.id}: ${g.correctAnswer}`).join('\n')}`;
         }
      } else if (computedType === 'quiz') {
         const { parseQuizData } = await import('../../utils/quizParser.js');
         const quizData = parseQuizData(targetCard);
         if (quizData) {
           return `Тест (Quiz).
Вопрос: ${quizData.question}
Варианты ответов:
${quizData.options.map((o, i) => `${i + 1}. ${o.text}${o.isCorrect ? ' (Правильный ответ)' : ''}`).join('\n')}`;
         }
      } else if (computedType === 'cloze' || computedType === 'trainer') {
         const { parseClozeData } = await import('../../utils/clozeParser.js');
         const clozeData = parseClozeData(targetCard, mode, []);
         if (clozeData) {
            return `Упражнение на заполнение пропуска.
Текст: ${clozeData.maskedText}
Правильный ответ: ${clozeData.correctAnswer}`;
         }
      }
    } catch (e) {
      console.warn("Failed to build detailed AI context", e);
    }
    
    let fallback = `Лицевая сторона:
${targetCard.front}`;
    if (targetCard.back) fallback += `

Обратная сторона:
${targetCard.back}`;
    return fallback;
  };

  const handleAskQuestion = async (userRequest) => {
    if (!card?.front) return false;
    if (userProfile?.is_guest) {
      setIsAuthModalOpen(true, tr("Для редактирования карточек войдите через Telegram"));
      return false;
    }

    const promptContext = await buildStudyContext(card, studyMode);
    const result = await runAiGenerator(promptContext, true, 'custom_directive', userRequest);
    if (!result) return false;

    const answer = String(result.context || '').trim();
    if (!answer) return false;

    stopAudio();
    return { success: true, answer };
  };

  const handleSaveExplanation = async (explanation) => {
    if (!explanation || !card) return;
    const currentContext = String(card.context || '').trim();
    const nextContext = currentContext ? `${explanation}\n\n${currentContext}` : explanation;
    try {
      await api.put(`/cards/${card.id}`, { context: nextContext });
      useSessionStore.getState().updateCardInSession?.(card.id, { context: nextContext });
      useDeckStore.getState().updateCardLocal?.(card.id, { context: nextContext });
      showToast(tr("Ответ сохранен в контекст!"), "success");
    } catch {
      showToast(tr("Не удалось сохранить контекст"), "error");
    }
  };

  const handleAutoplayAwareBack = async () => {
    stopAudio();
    if (isAutoplayActive) {
      autoplay.navigate(-1);
      return;
    }
    await goBack();
  };

  const handleAutoplayAwareNext = async () => {
    stopAudio();
    if (isAutoplayActive) {
      autoplay.navigate(1);
      return;
    }
    await goNext();
  };

  const showGradeButtons = currentDeck?.id !== 'duplicates' && !isAutoplayActive;

  const handleGrade = useCallback((grade, isExtended) => {
    if (!canGrade) return;
    const latest = useSessionStore.getState();
    const key = `${getUserId()}:${card?.id}`;
    if (latest.card?.id !== card?.id || latest.historyIndex !== historyIndex || latest.sessionRevision !== sessionRevision
      || latest.pendingGrades[key] || latest.gradeErrors[key]) return;
    // Unconfigured reviews may still be self-assessed without an interactive evaluator.
    if (!hasRequiredActions && currentStep?.action === STUDY_ACTION.ANSWER) completeStep({ selfAssessed: true });
    stopAudio();
    const evidence = exerciseEvidence;
    setExerciseEvidence(null);
    submitGrade(grade, isExtended, evidence);
  }, [card?.id, historyIndex, sessionRevision, canGrade, hasRequiredActions, currentStep?.action, completeStep, stopAudio, exerciseEvidence, submitGrade]);

  if (view !== 'study') return null;

  return (
    <div className="view-study">
      {showGradeButtons && (
        <GradeButtons 
          card={card} 
          loading={loading || !canGrade || Boolean(pendingGrades[`${getUserId()}:${card?.id}`] || gradeErrors[`${getUserId()}:${card?.id}`])}
          onGrade={handleGrade} 
        />
      )}

      <motion.div
        key="study"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="view"
      >
        <div className={`study-top-collapsible ${isHeaderVisible ? 'is-visible' : 'is-hidden'}`}>
          <StudyHeader
            deckName={currentDeck?.name}
            isTrainerDeck={Boolean(currentDeck?.is_trainer || (deckCards && deckCards.length > 0 && deckCards.every(c => /\{([^}]+)\}/.test(c.front || ''))))}
            card={card}
            onBack={navigateUp}
            onOpenCreator={() => openCreator(currentDeck?.id, 'study', card?.id)}
            onOpenEditor={() => openEditor(currentDeck?.id === 'duplicates' ? card.deck_id : currentDeck?.id, card, 'study')}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />

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
            <span className="study-mode-dropdown-label">{tr("Режим:")}</span>
            <select
              className="study-mode-select glass"
              disabled={isAutoplayActive}
              value={studyMode}
              onChange={(e) => {
                const val = e.target.value;
                setStudyMode(val);
                setIsFlipped(false); // Reset card face on mode swap
              }}
            >
              <option value="classic">{tr("🃏 Карточки (Немецкий → Русский)")}</option>
              <option value="reverse">{tr("🔄 Перевод (Русский → Немецкий)")}</option>
              <option value="cloze">{tr("📝 Выбор слова (Пропуски)")}</option>
              <option value="puzzle">{tr("🧩 Конструктор (Сборка фразы)")}</option>
              <option value="speak">{tr("🗣 Произношение (Голос)")}</option>
              <option value="random">{tr("🎲 Случайный выбор (Рандом)")}</option>
            </select>
          </div>

          <label className="study-voice-followup-toggle">
            <input
              type="checkbox"
              checked={speechFollowupEnabled}
              disabled={isAutoplayActive}
              onChange={e => setSpeechFollowupEnabled(e.target.checked)}
            />
            <span title={tr('Настройка применяется со следующей карточки')}>{tr('Произносить фразу после правильного ответа')}</span>
          </label>

          {studyMode === 'random' && !isAutoplayActive && (
            <div className="random-mode-config glass">
              <div className="random-config-title">{tr("Случайные режимы в пуле 🎲")}</div>
              <div className="random-config-grid">
                {[
                  { key: 'classic', label: tr("🃏 Карточки") },
                  { key: 'reverse', label: tr("🔄 Перевод") },
                  { key: 'cloze', label: tr("📝 Выбор слова") },
                  { key: 'puzzle', label: tr("🧩 Конструктор") },
                  { key: 'speak', label: tr("🗣 Произношение") }
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
        </div>

        {card && (
          <MediaPicker
            isOpen={isImagePickerOpen}
            onClose={() => setIsImagePickerOpen(false)}
            onImageUpload={(file) => uploadStudyImage(file, card)}
            searchQuery={card?.front || ''}
            loading={loading}
          />
        )}

        {Object.entries(gradeErrors).filter(([key]) => key.startsWith(`${getUserId()}:`)).map(([key, error]) => (
          <div className="study-grade-error" role="alert" key={key}>
            <p className="study-error-message">{tr('Оценка карточки №{{p0}} не подтверждена: {{p1}}. Проверьте прогресс перед повторной оценкой.', { p0: error.card.id, p1: error.message })}</p>
            <button className="btn btn-secondary" onClick={() => dismissGradeError(key)}>{tr('Понятно')}</button>
          </div>
        ))}

        {loading && !card ? (
          <div className="finished-view glass">
            <RefreshCw size={48} className="spin" color="#a855f7" />
            <h3>{tr("Загрузка карточек...")}</h3>
          </div>
        ) : card && !apiError ? (
          <div className="study-flow">

            <StudyCard
              card={card}
              isFlipped={isFlipped}
              onFlip={isAutoplayActive ? () => {} : setIsFlipped}
              loading={loading}
              historyIndex={historyIndex}
              playAudio={playAudio}
              audioControls={audioControls}
              sessionVoice={sessionVoice}
              isAudioLoading={isAudioLoading}
              isAutoplayActive={isAutoplayActive}
              styles={styleSettings}
              resolvedBgFront={resolvedBgFront}
              resolvedBgBack={resolvedBgBack}
              studyMode={effectiveStudyMode}
              onTrainerAnswer={handleExerciseAnswer}
              onSpeechSuccess={handleSpeechSuccess}
              stepFlow={stepFlow}
              renderRequiredAction={renderRequiredAction ?? (autoSpeechActions ? renderSpeechFollowup : undefined)}
              onAskQuestion={handleAskQuestion}
              onSaveExplanation={handleSaveExplanation}
              onNextCard={() => {
                if (!canGrade) return;
                setIsFlipped(false);
                goNext();
              }}
            />

            <StudyNavigation
              historyIndex={
                isAutoplayActive && autoplay.autoplayCards && autoplay.autoplayCards.length > 0
                  ? autoplay.autoplayCards.findIndex(c => String(c.id) === String(card?.id))
                  : currentDeck?.id === 'duplicates' 
                  ? duplicateCards.findIndex(c => String(c.id) === String(card?.id)) 
                  : (deckCards && deckCards.length > 0 && deckCards.findIndex(c => String(c.id) === String(card?.id)) !== -1)
                  ? deckCards.findIndex(c => String(c.id) === String(card?.id))
                  : historyIndex
              }
              totalCards={
                isAutoplayActive && autoplay.autoplayCards && autoplay.autoplayCards.length > 0
                  ? autoplay.autoplayCards.length
                  : currentDeck?.id === 'duplicates' 
                  ? duplicateCards.length 
                  : (deckCards && deckCards.length > 0 && deckCards.findIndex(c => String(c.id) === String(card?.id)) !== -1)
                  ? deckCards.length
                  : (currentDeck?.stats?.total || 0)
              }
              loading={loading}
              onBack={handleAutoplayAwareBack}
              onNext={handleAutoplayAwareNext}
              autoplayState={autoplayState}
              autoplayStatus={autoplay.status}
              onAutoplayStop={autoplay.stop}
              onAutoplayPause={autoplay.pause}
              onAutoplayResume={autoplay.resume}
              onAutoplayStart={autoplay.start}
              autoplayLoop={autoplayLoop}
              onAutoplaySettings={() => {
                autoplay.pause();
                useUiStore.getState().openSettings('autoplay');
              }}
            />

            <div className="card-actions-row-study">
              <div className="card-actions-left">
                <CardActionButton 
                  card={card} 
                  size={22} 
                  className="btn-card-action-trigger" 
                  stopDrag={false}
                />
              </div>

              {/* Center Column: Anki-style Queue Counter + Current Card SRS Status Underneath */}
              <div className="study-queue-center-col">
                <div className="anki-queue-counter" title={tr("Очередь колоды: Новые (синий), К повторению сегодня (красный), На закреплении (желтый)")}>
                  <div className="anki-pill pill-new" title={tr("Новые карточки (еще не изучались)")}>
                    <span className="anki-dot dot-blue" />
                    <span className="anki-count">{queueStats.new}</span>
                  </div>
                  <div className="anki-pill pill-due" title={tr("Срочные к повторению сегодня")}>
                    <span className="anki-dot dot-red" />
                    <span className="anki-count">{queueStats.due}</span>
                  </div>
                  <div className="anki-pill pill-learning" title={tr("На закреплении в текущей сессии")}>
                    <span className="anki-dot dot-yellow" />
                    <span className="anki-count">{queueStats.learning}</span>
                  </div>
                </div>

                {currentCardSrsStatus && (
                  <div
                    className="current-card-srs-badge"
                    title={currentCardSrsStatus.title}
                    style={currentCardSrsStatus.style}
                  >
                    <span>{currentCardSrsStatus.label}</span>
                  </div>
                )}
              </div>

              <div className="card-actions-right">
                {currentDeck?.id === 'duplicates' && (
                  <button
                    className="btn-card-action-trigger"
                    onClick={onDeleteDuplicate}
                    title={tr("Удалить дубликат")}
                    style={{ color: '#ef4444' }}
                  >
                    <Trash2 size={22} />
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : apiError ? (
          <StudyError deck={currentDeck} error={apiError} onRetry={() => fetchNextCard(currentDeck.id, !card)} onGoToDecks={handleGoToTheme} />
        ) : isSessionFinished ? (
          <StudyFinished
            deck={currentDeck}
            nextDeck={nextDeck}
            isLastDeck={lastDeck}
            alreadyDone={studyHistory.length === 0}
            nextReview={nextReview}
            onContinue={() => handleStartStudy(nextDeck)}
            onRepeat={() => handleStartStudy(currentDeck, 'forced')}
            onGoToDecks={handleGoToTheme}
          />
        ) : null}
      </motion.div>
    </div>
  );
};






