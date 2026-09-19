import React, { useMemo } from 'react';
import { parseClozeData } from '../../utils/clozeParser.js';
import { parseQuizData } from '../../utils/quizParser.js';
import { parseMatchData } from '../../utils/matchParser.js';
import { parseFreeTextData } from '../../utils/freeTextParser.js';
import { parseWordBankData } from '../../utils/wordBankParser.js';
import { detectExerciseType } from '../../utils/exerciseDetector.js';

import { StudyCardTrainer } from './StudyCardTrainer.jsx';
import { StudyCardQuiz } from './StudyCardQuiz.jsx';
import { StudyCardMatch } from './StudyCardMatch.jsx';
import { StudyCardFreeText } from './StudyCardFreeText.jsx';
import { StudyCardPuzzle } from './StudyCardPuzzle.jsx';
import { StudyCardWordBank } from './StudyCardWordBank.jsx';

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
  const detectedType = useMemo(() => {
    return detectExerciseType(card, studyMode);
  }, [card, studyMode]);

  // Match
  const matchData = useMemo(() => {
    if (detectedType !== 'match') return null;
    return parseMatchData(card);
  }, [card, detectedType]);

  // Free text
  const freeTextData = useMemo(() => {
    if (detectedType !== 'free_text') return null;
    return parseFreeTextData(card);
  }, [card, detectedType]);

  // Quiz
  const quizData = useMemo(() => {
    if (detectedType !== 'quiz') return null;
    return parseQuizData(card);
  }, [card, detectedType]);

  // Trainer (cloze gaps)
  const clozeData = useMemo(() => {
    if (detectedType !== 'trainer') return null;
    return parseClozeData(card, studyMode);
  }, [card, detectedType, studyMode]);

  const wordBankData = useMemo(() => {
    if (detectedType !== 'word_bank') return null;
    return parseWordBankData(card);
  }, [card, detectedType]);

  if (!detectedType) {
    return fallback;
  }

  switch (detectedType) {
    case 'word_bank':
      if (!wordBankData) return fallback;
      return (
        <StudyCardWordBank
          card={card}
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
      return (
        <StudyCardMatch
          card={card}
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
      return (
        <StudyCardFreeText
          card={card}
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
      return (
        <StudyCardQuiz
          card={card}
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
      return (
        <StudyCardTrainer
          card={card}
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
        />
      );

    case 'puzzle':
      return (
        <StudyCardPuzzle
          card={card}
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
