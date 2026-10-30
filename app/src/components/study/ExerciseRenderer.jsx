import React, { useMemo } from 'react';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { parseClozeData } from '../../utils/clozeParser.js';
import { parseQuizData } from '../../utils/quizParser.js';
import { parseMatchData } from '../../utils/matchParser.js';
import { parseFreeTextData } from '../../utils/freeTextParser.js';
import { parseEditableTextData } from '../../utils/editableTextParser.js';
import { parseWordBankData } from '../../utils/wordBankParser.js';
import { detectExerciseType } from '../../utils/exerciseDetector.js';
import { parseExerciseContent } from '../../utils/exerciseContentParser.js';

import { StudyCardTrainer } from './StudyCardTrainer.jsx';
import { StudyCardQuiz } from './StudyCardQuiz.jsx';
import { StudyCardMatch } from './StudyCardMatch.jsx';
import { StudyCardFreeText } from './StudyCardFreeText.jsx';
import { StudyCardPuzzle } from './StudyCardPuzzle.jsx';
import { StudyCardWordBank } from './StudyCardWordBank.jsx';
import { ExerciseInfoBlocks } from './ExerciseInfoBlocks.jsx';

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
  studyMode = 'classic',
  isPureTrainerMode = false,
  isFlipped = false,
  onFlip,
  onTrainerAnswer,
  onNextCard,
  renderAudioPlayer,
  playAudio,
  styles = {},
  designConfig,
  savedState,
  onSaveState,
  footerActionTarget,
  fallback = null,
  reviewKey,
  assessmentMode = false
}) => {
  // Standalone trainer callers use the effective app design; scoped previews
  // explicitly supply their draft (null intentionally selects V1 fallback).
  const activeDesign = useSettingsStore(state => state.activeDesignConfig);
  const effectiveDesign = designConfig === undefined ? activeDesign : designConfig;
  const content = useMemo(() => {
    return parseExerciseContent(card?.front || card?.front_text || '');
  }, [card?.front, card?.front_text]);

  // Each parser owns its projection. Joining exercises here would erase the
  // structural boundaries needed to select one interactive block.
  const exerciseCard = card;

  const detectedType = useMemo(() => {
    return detectExerciseType(exerciseCard, studyMode);
  }, [exerciseCard, studyMode]);

  // Match
  const matchData = useMemo(() => {
    if (detectedType !== 'match') return null;
    return parseMatchData(exerciseCard);
  }, [exerciseCard, detectedType]);

  // Free text
  const freeTextData = useMemo(() => {
    if (detectedType !== 'free_text') return null;
    return parseFreeTextData(exerciseCard);
  }, [exerciseCard, detectedType]);

  const editableTextData = useMemo(() => {
    if (detectedType !== 'editable_text') return null;
    return parseEditableTextData(exerciseCard);
  }, [exerciseCard, detectedType]);

  // Quiz
  const quizData = useMemo(() => {
    if (detectedType !== 'quiz') return null;
    return parseQuizData(exerciseCard);
  }, [exerciseCard, detectedType]);

  // Trainer (cloze gaps)
  const clozeData = useMemo(() => {
    if (detectedType !== 'trainer') return null;
    return parseClozeData(exerciseCard, studyMode);
  }, [exerciseCard, detectedType, studyMode]);

  const wordBankData = useMemo(() => {
    if (detectedType !== 'word_bank') return null;
    return parseWordBankData(exerciseCard);
  }, [exerciseCard, detectedType]);

  const withInformation = (exercise) => {
    const blocks = content?.blocks || [];
    const directive = { puzzle: 'puzzle', match: 'match', free_text: 'free', editable_text: 'edit', word_bank: 'wordbank' }[detectedType];
    const exerciseIndex = blocks.findIndex(b => b.type === 'exercise'
      && (!directive || b.content.split('\n')[0].trim().toLowerCase() === `@${directive}`));
    
    let topBlocks = blocks;
    let bottomBlocks = [];
    
    if (exerciseIndex !== -1) {
      // A directive may follow a plain instruction block. Keep that instruction,
      // but never print authored exercise syntax (including its correct answers)
      // as an information block beside the interactive renderer. Trainer/Quiz
      // already consume the combined exercise projection in their own parser.
      topBlocks = blocks.slice(0, exerciseIndex).filter(b => b.type !== 'exercise' || !detectExerciseType(b.content));
      bottomBlocks = blocks.slice(exerciseIndex + 1).filter(b => b.type !== 'exercise' || !detectExerciseType(b.content));
    }

    return (
      <>
        {topBlocks.length > 0 && (
          <ExerciseInfoBlocks blocks={topBlocks} />
        )}
        {exercise}
        {bottomBlocks.length > 0 && (
          <ExerciseInfoBlocks blocks={bottomBlocks} />
        )}
      </>
    );
  };

  if (!detectedType) {
    return fallback ? withInformation(fallback) : null;
  }

  switch (detectedType) {
    case 'word_bank':
      if (!wordBankData) return fallback;
      return withInformation(
        <StudyCardWordBank
          key={reviewKey || exerciseCard.id}
          card={exerciseCard}
          wordBankData={wordBankData}
          designConfig={effectiveDesign}
          onTrainerAnswer={onTrainerAnswer}
          styles={styles}
          savedState={savedState}
          onSaveState={onSaveState}
          footerActionTarget={footerActionTarget}
        />
      );

    case 'match':
      if (!matchData) return fallback;
      return withInformation(
        <StudyCardMatch
          key={reviewKey || exerciseCard.id}
          card={exerciseCard}
          matchData={matchData}
          designConfig={effectiveDesign}
          onFlip={onFlip}
          onTrainerAnswer={onTrainerAnswer}
          onNextCard={onNextCard}
          renderAudioPlayer={renderAudioPlayer}
          styles={styles}
          isPureTrainerMode={isPureTrainerMode}
          savedState={savedState}
          onSaveState={onSaveState}
        />
      );

    case 'free_text':
      if (!freeTextData) return fallback;
      return withInformation(
        <StudyCardFreeText
          assessmentMode={assessmentMode}
          key={reviewKey || exerciseCard.id}
          reviewKey={reviewKey}
          card={exerciseCard}
          freeTextData={freeTextData}
          designConfig={effectiveDesign}
          onFlip={onFlip}
          onTrainerAnswer={onTrainerAnswer}
          onNextCard={onNextCard}
          renderAudioPlayer={renderAudioPlayer}
          styles={styles}
          isPureTrainerMode={isPureTrainerMode}
          savedState={savedState}
          onSaveState={onSaveState}
        />
      );

    case 'editable_text':
      if (!editableTextData) return fallback;
      return withInformation(
        <StudyCardFreeText
          assessmentMode={assessmentMode}
          key={reviewKey || exerciseCard.id}
          reviewKey={reviewKey}
          card={exerciseCard}
          editableTextData={editableTextData}
          designConfig={effectiveDesign}
          onTrainerAnswer={onTrainerAnswer}
          onNextCard={onNextCard}
          renderAudioPlayer={renderAudioPlayer}
          styles={styles}
          isPureTrainerMode={isPureTrainerMode}
          savedState={savedState}
          onSaveState={onSaveState}
        />
      );

    case 'quiz':
      if (!quizData) return fallback;
      return withInformation(
        <StudyCardQuiz
          key={reviewKey || exerciseCard.id}
          card={exerciseCard}
          quizData={quizData}
          designConfig={effectiveDesign}
          isFlipped={isFlipped}
          setIsFlipped={onFlip}
          onFlip={onFlip}
          playAudio={playAudio}
          onTrainerAnswer={onTrainerAnswer}
          renderAudioPlayer={renderAudioPlayer}
          styles={styles}
          savedState={savedState}
          onSaveState={onSaveState}
        />
      );

    case 'trainer':
      if (!clozeData) return fallback;
      return withInformation(
        <StudyCardTrainer
          assessmentMode={assessmentMode}
          key={reviewKey || exerciseCard.id}
          card={exerciseCard}
          clozeData={clozeData}
          designConfig={effectiveDesign}
          isFlipped={isFlipped}
          onFlip={onFlip}
          playAudio={playAudio}
          onTrainerAnswer={onTrainerAnswer}
          onNextCard={onNextCard}
          renderAudioPlayer={renderAudioPlayer}
          styles={styles}
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
          loading={false}
          playAudio={playAudio}
          renderAudioPlayer={renderAudioPlayer}
          onTrainerAnswer={onTrainerAnswer}
          onNextCard={onNextCard}
          styles={styles}
          isPureTrainerMode={isPureTrainerMode}
          savedState={savedState}
          onSaveState={onSaveState}
        />
      );

    default:
      return fallback ? withInformation(fallback) : null;
  }
});
