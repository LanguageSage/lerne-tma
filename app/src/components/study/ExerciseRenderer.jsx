import React, { useMemo } from 'react';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import {
  studyContent, studyExerciseType, studyInfoBlocks, studyMatch, studyQuiz, studyTrainer, studyWordBank, layoutAnswerRevealed
} from '../../utils/structuredStudyCard.js';

import { StudyCardTrainer } from './StudyCardTrainer.jsx';
import { StudyCardQuiz } from './StudyCardQuiz.jsx';
import { StudyCardMatch } from './StudyCardMatch.jsx';
import { StudyCardFreeText } from './StudyCardFreeText.jsx';
import { StudyCardPuzzle } from './StudyCardPuzzle.jsx';
import { StudyCardWordBank } from './StudyCardWordBank.jsx';
import { ExerciseInfoBlocks } from './ExerciseInfoBlocks.jsx';
import { StructuredCardLayout } from './StructuredCardLayout.jsx';

/**
 * Universal ExerciseRenderer for all interactive exercise types:
 * - trainer (choice gaps + input gaps)
 * - match (pair matching)
 * - free_text (open response with example answer)
 * - editable_text (correction of provided text)
 * - quiz (multiple choice test)
 * - puzzle (word ordering)
 * - word_bank (numbered gaps with a shared option bank)
 */
export const ExerciseRenderer = React.memo(({
  card,
  isPureTrainerMode = false,
  isFlipped = false,
  onFlip,
  onTrainerAnswer,
  onNextCard,
  renderAudioPlayer,
  playAudio,
  designConfig,
  savedState,
  onSaveState,
  footerActionTarget,
  fallback = null,
  reviewKey,
  assessmentMode = false,
  supportHistoryUnknown = false,
  previewAfterAnswer = false,
}) => {
  // Standalone trainer callers use the effective app design; scoped previews
  // explicitly supply their V2 draft. Null/undefined selects the active V2.
  const activeDesign = useSettingsStore(state => state.activeDesignConfig);
  const effectiveDesign = designConfig ?? activeDesign;
  const exerciseCard = card;
  const structured = studyContent(card);
  const { detectedType, data } = useMemo(() => {
    const type = studyExerciseType(structured);
    const value = structured?.data;
    let projected = value;
    if (type === 'trainer') projected = studyTrainer(value);
    else if (type === 'quiz') projected = studyQuiz(value);
    else if (type === 'match') projected = studyMatch(value);
    else if (type === 'word_bank') projected = studyWordBank(value);
    else if (type === 'free_text') projected = { prompt: value.prompt, exampleAnswer: value.sample_answer };
    else if (type === 'editable_text') projected = { sourceText: value.source_text };
    return { detectedType: type, data: projected };
  }, [structured]);

  const withInformation = exercise => structured?.layout
    ? <StructuredCardLayout card={card} exercise={exercise}
        afterAnswer={previewAfterAnswer || layoutAnswerRevealed(savedState)} />
    : <><ExerciseInfoBlocks blocks={studyInfoBlocks(structured)} />{exercise}</>;

  if (!detectedType) {
    return fallback ? withInformation(fallback) : null;
  }

  switch (detectedType) {
    case 'word_bank':
      if (!data) return fallback;
      return withInformation(
        <StudyCardWordBank
          key={reviewKey || exerciseCard.id}
          card={exerciseCard}
          wordBankData={data}
          renderAudioPlayer={renderAudioPlayer}
          designConfig={effectiveDesign}
          onTrainerAnswer={onTrainerAnswer}
          savedState={savedState}
          onSaveState={onSaveState}
          footerActionTarget={footerActionTarget}
        />
      );

    case 'match':
      if (!data) return fallback;
      return withInformation(
        <StudyCardMatch
          key={reviewKey || exerciseCard.id}
          card={exerciseCard}
          matchData={data}
          designConfig={effectiveDesign}
          onFlip={onFlip}
          onTrainerAnswer={onTrainerAnswer}
          onNextCard={onNextCard}
          renderAudioPlayer={renderAudioPlayer}
          isPureTrainerMode={isPureTrainerMode}
          savedState={savedState}
          onSaveState={onSaveState}
        />
      );

    case 'free_text':
      if (!data) return fallback;
      return withInformation(
        <StudyCardFreeText
          assessmentMode={assessmentMode}
          key={reviewKey || exerciseCard.id}
          reviewKey={reviewKey}
          card={exerciseCard}
          freeTextData={data}
          supportHistoryUnknown={supportHistoryUnknown}
          designConfig={effectiveDesign}
          onFlip={onFlip}
          onTrainerAnswer={onTrainerAnswer}
          onNextCard={onNextCard}
          renderAudioPlayer={renderAudioPlayer}
          isPureTrainerMode={isPureTrainerMode}
          savedState={savedState}
          onSaveState={onSaveState}
        />
      );

    case 'editable_text':
      if (!data) return fallback;
      return withInformation(
        <StudyCardFreeText
          assessmentMode={assessmentMode}
          key={reviewKey || exerciseCard.id}
          reviewKey={reviewKey}
          card={exerciseCard}
          editableTextData={data}
          designConfig={effectiveDesign}
          onTrainerAnswer={onTrainerAnswer}
          onNextCard={onNextCard}
          renderAudioPlayer={renderAudioPlayer}
          isPureTrainerMode={isPureTrainerMode}
          savedState={savedState}
          onSaveState={onSaveState}
        />
      );

    case 'quiz':
      if (!data) return fallback;
      return withInformation(
        <StudyCardQuiz
          key={reviewKey || exerciseCard.id}
          card={exerciseCard}
          quizData={data}
          backNote={structured ? (structured.data.back_note ?? '') : undefined}
          designConfig={effectiveDesign}
          isFlipped={isFlipped}
          setIsFlipped={onFlip}
          onFlip={onFlip}
          playAudio={playAudio}
          onTrainerAnswer={onTrainerAnswer}
          renderAudioPlayer={renderAudioPlayer}
          savedState={savedState}
          onSaveState={onSaveState}
        />
      );

    case 'trainer':
      if (!data) return fallback;
      return withInformation(
        <StudyCardTrainer
          assessmentMode={assessmentMode}
          supportHistoryUnknown={supportHistoryUnknown}
          key={reviewKey || exerciseCard.id}
          card={exerciseCard}
          clozeData={data}
          backNote={structured ? (structured.data.back_note ?? '') : undefined}
          designConfig={effectiveDesign}
          isFlipped={isFlipped}
          onFlip={onFlip}
          playAudio={playAudio}
          onTrainerAnswer={onTrainerAnswer}
          onNextCard={onNextCard}
          renderAudioPlayer={renderAudioPlayer}
          isPureTrainerMode={isPureTrainerMode}
          savedState={savedState}
          onSaveState={onSaveState}
          footerActionTarget={footerActionTarget}
        />
      );

    case 'puzzle':
      return withInformation(
        <StudyCardPuzzle
          key={reviewKey || exerciseCard.id}
          card={exerciseCard}
          designConfig={effectiveDesign}
          isFlipped={isFlipped}
          onFlip={onFlip}
          tokens={structured?.data.tokens}
          translation={structured ? (structured.data.translation ?? '') : undefined}
          loading={false}
          playAudio={playAudio}
          renderAudioPlayer={renderAudioPlayer}
          onTrainerAnswer={onTrainerAnswer}
          onNextCard={onNextCard}
          isPureTrainerMode={isPureTrainerMode}
          savedState={savedState}
          onSaveState={onSaveState}
        />
      );

    default:
      return fallback ? withInformation(fallback) : null;
  }
});
