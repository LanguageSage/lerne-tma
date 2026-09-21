import React, { useMemo } from 'react';
import { parseClozeData } from '../../utils/clozeParser.js';
import { parseQuizData } from '../../utils/quizParser.js';
import { parseMatchData } from '../../utils/matchParser.js';
import { parseFreeTextData } from '../../utils/freeTextParser.js';
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
  savedState,
  onSaveState,
  footerActionTarget,
  fallback = null
}) => {
  const content = useMemo(() => {
    return parseExerciseContent(card?.front || card?.front_text || '');
  }, [card?.front, card?.front_text]);

  const exerciseCard = useMemo(() => {
    if (!card || !content.hasBlocks) return card;
    return { ...card, front: content.exercise, front_text: content.exercise };
  }, [card, content]);

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
    const exerciseIndex = blocks.findIndex(b => b.type === 'exercise');
    
    let topBlocks = blocks;
    let bottomBlocks = [];
    
    if (exerciseIndex !== -1) {
      topBlocks = blocks.slice(0, exerciseIndex);
      bottomBlocks = blocks.slice(exerciseIndex + 1);
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
    return fallback;
  }

  switch (detectedType) {
    case 'word_bank':
      if (!wordBankData) return fallback;
      return withInformation(
        <StudyCardWordBank
          card={exerciseCard}
          wordBankData={wordBankData}
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
          card={exerciseCard}
          matchData={matchData}
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
          card={exerciseCard}
          freeTextData={freeTextData}
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

    case 'quiz':
      if (!quizData) return fallback;
      return withInformation(
        <StudyCardQuiz
          card={exerciseCard}
          quizData={quizData}
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
          card={exerciseCard}
          clozeData={clozeData}
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
          card={exerciseCard}
          isFlipped={isFlipped}
          onFlip={onFlip}
          loading={false}
          playAudio={playAudio}
          onTrainerAnswer={onTrainerAnswer}
          onNextCard={onNextCard}
          styles={styles}
          isPureTrainerMode={isPureTrainerMode}
          savedState={savedState}
          onSaveState={onSaveState}
        />
      );

    default:
      return fallback;
  }
});
