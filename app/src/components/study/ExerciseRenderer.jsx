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
  native = false,
  studyMode = 'classic',
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
  const nativeRender = native || Boolean(structured);
  const legacyCard = nativeRender ? null : card;
  const { detectedType, content, data } = useMemo(() => {
    if (nativeRender) {
      const type = studyExerciseType(structured);
      const value = structured?.data;
      let projected = value;
      if (type === 'trainer') projected = studyTrainer(value);
      else if (type === 'quiz') projected = studyQuiz(value);
      else if (type === 'match') projected = studyMatch(value);
      else if (type === 'word_bank') projected = studyWordBank(value);
      else if (type === 'free_text') projected = { prompt: value.prompt, exampleAnswer: value.sample_answer };
      else if (type === 'editable_text') projected = { sourceText: value.source_text };
      return { detectedType: type, content: { blocks: studyInfoBlocks(structured) }, data: projected };
    }
    // Editor and design previews still consume their authoring inputs.
    const type = detectExerciseType(legacyCard, studyMode);
    const parse = {
      trainer: parseClozeData, quiz: parseQuizData, match: parseMatchData, free_text: parseFreeTextData,
      editable_text: parseEditableTextData, word_bank: parseWordBankData,
    }[type];
    return { detectedType: type, content: parseExerciseContent(legacyCard?.front || legacyCard?.front_text || ''),
      data: parse?.(legacyCard, studyMode) };
  }, [nativeRender, structured, legacyCard, studyMode]);

  const withInformation = (exercise) => {
    if (structured?.layout) return <StructuredCardLayout card={card} exercise={exercise}
      afterAnswer={previewAfterAnswer || layoutAnswerRevealed(savedState)} />;
    const blocks = content?.blocks || [];
    const directive = { puzzle: 'puzzle', match: 'match', free_text: 'free', editable_text: 'edit', word_bank: 'wordbank' }[detectedType];
    const exerciseIndex = nativeRender ? -1 : blocks.findIndex(b => b.type === 'exercise'
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
