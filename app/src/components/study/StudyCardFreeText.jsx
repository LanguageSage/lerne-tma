import { tr } from '../../i18n/locale.js';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale.js';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { PenLine, Eye, Check, LoaderCircle } from 'lucide-react';
import { getCardStyle, getContextStyle } from '../../utils/cardStyles.js';
import { playSuccessSound, playErrorSound } from '../../utils/audioSynth.js';
import { triggerHaptic } from '../../utils/platform.js';
import { useFreeTextEvaluation } from '../../hooks/useFreeTextEvaluation.js';
import { canRevealFreeTextAnswer } from '../../utils/freeTextEvaluationState.js';
import './StudyCardFreeText.css';

export const StudyCardFreeText = React.memo(({
  card, freeTextData, onTrainerAnswer, onNextCard, renderAudioPlayer,
  styles = {}, isPureTrainerMode = false, savedState, onSaveState,
}) => {
  useInterfaceLocale();
  const [userInput, setUserInput] = useState(savedState?.userInput || '');
  const [showExample, setShowExample] = useState(savedState?.showExample || false);
  const { state, submit, evidence } = useFreeTextEvaluation(card?.id, savedState?.evaluationState);
  const reported = useRef(false);
  const { result, loading } = state;
  const isCompleted = result?.accepted === true;
  const cardStyle = useMemo(() => getCardStyle(styles), [styles]);
  const contextStyle = useMemo(() => getContextStyle(styles), [styles]);

  useEffect(() => {
    onSaveState?.({ userInput, showExample, isCompleted, evaluationState: state });
  }, [userInput, showExample, isCompleted, state, onSaveState]);

  useEffect(() => {
    if (evidence && !reported.current) {
      reported.current = true;
      onTrainerAnswer?.(card?.id, evidence);
    }
  }, [evidence, onTrainerAnswer, card?.id]);

  if (!card || !freeTextData) return null;
  const exampleAnswer = freeTextData.exampleAnswer;
  const canShowExample = !isCompleted && canRevealFreeTextAnswer(state);
  const sameRejectedAnswer = userInput === state.lastAnswer && result?.verdict !== 'unavailable';

  const handleSubmit = async event => {
    event.preventDefault();
    const outcome = await submit(userInput);
    if (!outcome) return;
    if (outcome.evidence) {
      playSuccessSound();
      triggerHaptic('success');
      reported.current = true;
      onTrainerAnswer?.(card.id, outcome.evidence);
    } else if (outcome.result.verdict !== 'unavailable') {
      playErrorSound();
      triggerHaptic('error');
    }
  };

  return (
    <form className="interactive-mode-container free-text-exercise"
      onClick={event => event.stopPropagation()} onSubmit={handleSubmit} aria-busy={loading}>
      <div className="free-text-heading"><PenLine size={16} />{tr('Свободный ответ / Письмо')}</div>
      <div className="text-front free-text-prompt" style={cardStyle}>{freeTextData.prompt}</div>
      {renderAudioPlayer && <div className="free-text-audio">{renderAudioPlayer()}</div>}
      <textarea
        aria-label={tr('Ваш ответ')}
        value={userInput}
        onChange={event => setUserInput(event.target.value)}
        placeholder={tr('Напишите ваш ответ здесь...')}
        disabled={isCompleted || loading}
        maxLength={4000} rows={3} style={contextStyle}
        aria-describedby={result ? `answer-feedback-${card.id}` : undefined}
      />
      {result && (
        <div id={`answer-feedback-${card.id}`} className={`free-text-feedback ${isCompleted ? 'is-success' : ''}`}
          role="status" aria-live="polite">
          {result.verdict === 'correct' && <p><Check size={16} />{tr('Верно!')}</p>}
          {result.verdict === 'accepted_minor' && <>
            <p><Check size={16} />{result.error_type === 'typo' ? tr('Верно. Небольшая опечатка.') : tr('Верно. Небольшая неточность в написании.')}</p>
            {result.corrected_answer && <p className="free-text-correction">{result.corrected_answer}</p>}
          </>}
          {result.verdict === 'unavailable' && <p>{tr('Не удалось проверить ответ. Попробуйте ещё раз — попытка не засчитана.')}</p>}
          {['needs_retry', 'incorrect'].includes(result.verdict) && <>
            <p>{result.hint || tr('Проверьте смысл и полноту ответа. Попробуйте ещё раз.')}</p>
            {result.explanation && <p>{result.explanation}</p>}
          </>}
        </div>
      )}
      {!isCompleted && <button type="submit" className="btn btn-primary free-text-action"
        disabled={loading || !userInput.trim() || sameRejectedAnswer}>
        {loading && <LoaderCircle size={16} className="spin" />}
        {loading ? tr('Проверяем ответ…') : result ? tr('Проверить ещё раз') : tr('Проверить ответ')}
      </button>}
      {canShowExample && exampleAnswer && <button type="button" className="btn free-text-action"
        onClick={() => { setShowExample(value => !value); triggerHaptic('light'); }}>
        <Eye size={16} />{showExample ? tr('Скрыть пример ответа') : tr('Показать пример ответа')}
      </button>}
      {showExample && canShowExample && <div className="free-text-example" style={contextStyle}>
        <strong>{tr('Пример правильного ответа:')}</strong><p>{exampleAnswer}</p>
      </div>}
      {isCompleted && isPureTrainerMode && <button type="button" className="btn btn-primary free-text-action" onClick={onNextCard}>
        {tr('Дальше →')}
      </button>}
    </form>
  );
});
