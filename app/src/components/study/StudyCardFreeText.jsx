import { tr } from '../../i18n/locale.js';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale.js';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { PenLine, Eye, Check, LoaderCircle, Mic, Pause, Play, RotateCcw } from 'lucide-react';
import { getCardStyle, getContextStyle } from '../../utils/cardStyles.js';
import { playSuccessSound, playErrorSound } from '../../utils/audioSynth.js';
import { triggerHaptic } from '../../utils/platform.js';
import { useFreeTextEvaluation } from '../../hooks/useFreeTextEvaluation.js';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition.js';
import { canRevealFreeTextAnswer } from '../../utils/freeTextEvaluationState.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import './StudyCardFreeText.css';
import { MarkdownRenderer } from '../common/MarkdownRenderer';

export const StudyCardFreeText = React.memo(({
  card, freeTextData, editableTextData, onTrainerAnswer, onNextCard, renderAudioPlayer,
  styles = {}, isPureTrainerMode = false, savedState, onSaveState, reviewKey,
  assessmentMode = false,
}) => {
  useInterfaceLocale();
  const currentKey = reviewKey ?? (card?.id != null ? String(card.id) : null);
  const [prevKey, setPrevKey] = useState(currentKey);
  const [userInput, setUserInput] = useState(savedState?.userInput ?? editableTextData?.sourceText ?? '');
  const [showExample, setShowExample] = useState(savedState?.showExample || false);
  const isAdmin = useSettingsStore(s => s.isAdmin);
  const [diagnosticsEnabled, setDiagnosticsEnabled] = useState(false);
  const { state, submit, evidence, diagnostics } = useFreeTextEvaluation(card?.id, savedState?.evaluationState, currentKey,
    null, isAdmin && diagnosticsEnabled);
  const reported = useRef(Boolean(savedState?.isCompleted));
  const submitting = useRef(false);
  const dictationBase = useRef('');
  const { isListening, isPaused, isStopping, speechError, start, stop, pause, resume, cancel } = useSpeechRecognition({
    resetKey: `${card?.id}:${currentKey}`,
    language: card?.target_language,
    silenceTimeoutMs: null,
    autoRestart: true,
    onTranscript: text => {
      if (text) setUserInput([dictationBase.current.trimEnd(), text].filter(Boolean).join(' ').slice(0, 4000));
    },
  });

  if (prevKey !== currentKey) {
    setPrevKey(currentKey);
    setUserInput(savedState?.userInput ?? editableTextData?.sourceText ?? '');
    setShowExample(savedState?.showExample || false);
  }

  useEffect(() => {
    reported.current = Boolean(savedState?.isCompleted);
    submitting.current = false;
  }, [currentKey, savedState?.isCompleted]);

  const { result, loading } = state;
  const isCompleted = result?.accepted === true;
  const isExhausted = Boolean((assessmentMode && state.attemptCount > 0) || (state?.gradingPolicy && state.attemptCount >= state.gradingPolicy.max_retries));
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

  if (!card || (!freeTextData && !editableTextData)) return null;
  const isEditable = Boolean(editableTextData);
  const isModified = isEditable && userInput !== editableTextData.sourceText;
  const exampleAnswer = freeTextData?.exampleAnswer;
  const canShowExample = !isEditable && !assessmentMode && !isCompleted && canRevealFreeTextAnswer(state);
  const sameRejectedAnswer = userInput === state.lastAnswer && result?.verdict !== 'unavailable';

  const handleSubmit = async event => {
    event.preventDefault();
    if (submitting.current || isStopping || loading || isCompleted || isExhausted) return;
    submitting.current = true;
    let answer = userInput;
    if (isListening || isPaused) {
      const transcript = await stop();
      // Navigation or editing while flushing cancels the pending submission.
      if (transcript == null) { submitting.current = false; return; }
      answer = [dictationBase.current.trimEnd(), transcript].filter(Boolean).join(' ').slice(0, 4000);
      setUserInput(answer);
    }
    const outcome = await submit(answer);
    submitting.current = false;
    if (!outcome) return;
    if (assessmentMode && outcome.result.verdict !== 'unavailable') {
      reported.current = true;
      onTrainerAnswer?.(card.id, { isCorrect: outcome.result.accepted, completed: true, isFirstTry: true,
        attemptCount: 1, mistakeCount: outcome.result.accepted ? 0 : 1,
        gradingSummary: { final_verdict: outcome.result.verdict, final_evaluator: outcome.result.evaluator,
          error_types_seen: outcome.result.error_type ? [outcome.result.error_type] : [],
          error_codes_seen: outcome.result.error_code ? [outcome.result.error_code] : [] } });
      return;
    }
    if (outcome.evidence) {
      if (outcome.evidence.isCorrect) {
        playSuccessSound();
        triggerHaptic('success');
      } else {
        playErrorSound();
        triggerHaptic('error');
      }
      reported.current = true;
      onTrainerAnswer?.(card.id, outcome.evidence);
    } else if (outcome.result.verdict !== 'unavailable') {
      playErrorSound();
      triggerHaptic('error');
    }
  };

  return (
    <form className={`interactive-mode-container free-text-exercise${isEditable ? ' editable-text-exercise' : ''}`}
      onClick={event => event.stopPropagation()} onSubmit={handleSubmit} aria-busy={loading}>
      <div className="free-text-heading"><PenLine size={16} />{tr(isEditable ? 'Редактируемый текст' : 'Свободный ответ / Письмо')}</div>
      {isEditable
        ? <p id={`edit-help-${card.id}`} className="free-text-dictation-help">{tr('Исправьте текст прямо в поле и проверьте ответ.')}</p>
        : <div className="text-front free-text-prompt" style={cardStyle}>{freeTextData.prompt}</div>}
      {renderAudioPlayer && <div className="free-text-audio">{renderAudioPlayer()}</div>}
      <div className={isEditable ? `editable-text-field${isModified ? ' is-modified' : ''}` : 'free-text-input-wrapper'}>
        {isEditable && <div className="editable-text-toolbar">
          <label htmlFor={`edit-input-${card.id}`}><PenLine size={18} aria-hidden="true" />{tr('Исправленный текст')}</label>
          <span role="status">{tr(isModified ? 'Текст изменён' : 'Исходный текст')}</span>
        </div>}
        <textarea
          id={isEditable ? `edit-input-${card.id}` : undefined}
          aria-label={tr(isEditable ? 'Исправленный текст' : 'Ваш ответ')}
          value={userInput}
          onChange={event => { cancel(); setUserInput(event.target.value); }}
          placeholder={tr(isEditable ? 'Исправьте текст здесь...' : 'Напишите ваш ответ здесь...')}
          disabled={isCompleted || isExhausted || loading}
          maxLength={4000} rows={3} style={contextStyle}
          aria-describedby={`${isEditable ? `edit-help-${card.id}` : `dictation-help-${card.id}`}${result ? ` answer-feedback-${card.id}` : ''}`.trim() || undefined}
        />
        {isEditable && <button type="button" className="btn btn-secondary editable-text-reset"
          disabled={!isModified || isCompleted || isExhausted || loading}
          onClick={() => { cancel(); setUserInput(editableTextData.sourceText); }}>
          <RotateCcw size={16} aria-hidden="true" />{tr('Сбросить изменения')}
        </button>}
      </div>
      {!isEditable && !isCompleted && !isExhausted && <button type="button"
        className="btn btn-secondary free-text-action free-text-dictate" aria-pressed={isListening}
        disabled={loading || isStopping}
        onClick={() => {
          if (isListening) void pause();
          else if (isPaused) resume();
          else { dictationBase.current = userInput; start(); }
        }}>
        {isListening ? <Pause size={16} /> : isPaused ? <Play size={16} /> : <Mic size={16} />}
        {isListening ? tr('Пауза') : isPaused ? tr('Продолжить') : tr('Диктовать')}
      </button>}
      {!isEditable && <p id={`dictation-help-${card.id}`} className="free-text-dictation-help" role="status">
        {speechError || (isStopping ? tr('Завершаем распознавание…') : isListening ? tr('Слушаю… Говорите на языке задания.') : tr('Можно исправить текст перед проверкой.'))}
      </p>}
      {result && (
        <div id={`answer-feedback-${card.id}`} className={`free-text-feedback ${isCompleted ? 'is-success' : ''}`}
          role="status" aria-live="polite">
          {result.verdict === 'correct' && <p><Check size={16} />{tr('Верно!')}</p>}
          {result.verdict === 'accepted_minor' && <>
            <p><Check size={16} />{result.error_type === 'typo' ? tr('Верно. Небольшая опечатка.') : tr('Верно. Небольшая неточность в написании.')}</p>
            {!isEditable && result.corrected_answer && <p className="free-text-correction">{result.corrected_answer}</p>}
          </>}
          {result.verdict === 'unavailable' && <>
            <p>{tr('Не удалось проверить ответ. Попробуйте ещё раз — попытка не засчитана.')}</p>
            <p>{tr(failureMessage(result.error_code))} {result.error_code && <code>{result.error_code}</code>}</p>
          </>}
          {['needs_retry', 'incorrect'].includes(result.verdict) && <>
            <p>{result.hint || tr('Проверьте смысл и полноту ответа. Попробуйте ещё раз.')}</p>
            {result.explanation && <p>{result.explanation}</p>}
          </>}
        </div>
      )}
      {!isCompleted && !isExhausted && <button type="submit" className="btn btn-primary free-text-action"
        disabled={isStopping || loading || (!isListening && (!userInput.trim() || sameRejectedAnswer))}>
        {loading && <LoaderCircle size={16} className="spin" />}
        {loading ? tr('Проверяем ответ…') : (isListening || isPaused) ? tr('Отправить') : result ? tr('Проверить ещё раз') : tr('Проверить ответ')}
      </button>}
      {isAdmin && <div className="free-text-diagnostics">
        <label><input type="checkbox" checked={diagnosticsEnabled} disabled={loading}
          onChange={event => setDiagnosticsEnabled(event.target.checked)} />{tr('Диагностика Free Text (администратор)')}</label>
        {diagnosticsEnabled && diagnostics && <details>
          <summary>{tr('Фактический запрос и результат проверки')}</summary>
          {!diagnostics.ai_called && <p>{tr(diagnostics.result?.verdict !== 'unavailable'
            ? 'Локальная проверка: ИИ не вызывался.' : 'ИИ не вызывался.')}</p>}
          <pre>{JSON.stringify(diagnostics, null, 2)}</pre>
        </details>}
      </div>}
      {canShowExample && exampleAnswer && <button type="button" className="btn free-text-action"
        onClick={() => { setShowExample(value => !value); triggerHaptic('light'); }}>
        <Eye size={16} />{showExample ? tr('Скрыть пример ответа') : tr('Показать пример ответа')}
      </button>}
      {showExample && canShowExample && <div className="free-text-example" style={contextStyle}>
        <strong>{tr('Пример правильного ответа:')}</strong><MarkdownRenderer>{exampleAnswer}</MarkdownRenderer>
      </div>}
      {isCompleted && isPureTrainerMode && <button type="button" className="btn btn-primary free-text-action" onClick={onNextCard}>
        {tr('Дальше →')}
      </button>}
    </form>
  );
});

function failureMessage(code) {
  const reason = code?.replace('evaluator.', '');
  if (reason === 'timeout') return 'Сервис проверки не успел ответить.';
  if (['missing_model', 'invalid_model', 'invalid_provider', 'missing_api_key', 'missing_configuration', 'configuration_error'].includes(reason)) return 'Сервис проверки не настроен. Обратитесь к администратору.';
  if (reason === 'authentication' || reason === 'access_denied') return 'Нет доступа к сервису проверки.';
  if (reason === 'rate_limited' || reason === 'provider_unavailable') return 'Сервис проверки временно перегружен.';
  if (['missing_expected_answer', 'invalid_card'].includes(reason)) return 'Проверьте настройки задания с преподавателем.';
  if (['low_confidence', 'policy_violation', 'model_unavailable'].includes(reason)) return 'ИИ не смог дать надёжную оценку. Ответ сохранён.';
  return 'Сервис проверки вернул ошибку. Ответ сохранён.';
}
