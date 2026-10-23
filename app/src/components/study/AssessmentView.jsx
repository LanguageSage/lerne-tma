import React, { useCallback, useRef, useState } from 'react';
import { tr } from '../../i18n/locale.js';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale.js';
import { useSessionStore } from '../../store/useSessionStore.js';
import { useDeckStore } from '../../store/useDeckStore.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { ExerciseRenderer } from './ExerciseRenderer.jsx';
import { assessmentSummary, recordAssessmentResult } from '../../utils/assessment.js';
import { saveAssessment } from '../../services/assessmentService.js';
import { returnToDeckIntro } from '../../utils/navigation.js';
import { getUserId } from '../../utils/auth.js';
import { detectExerciseType } from '../../utils/exerciseDetector.js';
import { useStudyNavigation } from '../../hooks/useStudyNavigation.js';
import './AssessmentView.css';

export function AssessmentView() {
  useInterfaceLocale();
  const session = useSessionStore(state => state.assessment);
  const { currentDeck, decks } = useDeckStore();
  const settings = useSettingsStore();
  const { startStudy } = useStudyNavigation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const pendingResult = useRef(null);
  const card = session.cards[session.index];
  const result = card && session.results[card.id];
  const finished = session.index >= session.cards.length;
  const summary = assessmentSummary(session);
  const save = useCallback(async (cardId, evidence) => {
    const active = useSessionStore.getState().assessment;
    if (pending.current || active !== session || String(getUserId()) !== String(session.userId)) return;
    const next = recordAssessmentResult(active, cardId, evidence);
    if (next === active) return;
    pending.current = true;
    pendingResult.current = { cardId, evidence };
    setBusy(true);
    setError('');
    try {
      await saveAssessment(next, next.results[cardId]);
      if (useSessionStore.getState().assessment === active) useSessionStore.getState().setAssessment(next);
      pendingResult.current = null;
    } catch {
      setError(tr('Не удалось сохранить ответ. Повторите сохранение; новая попытка не требуется.'));
    } finally { pending.current = false; setBusy(false); }
  }, [session]);

  const advance = async () => {
    if (busy || error || !result || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const next = { ...session, index: session.index + 1 };
      await saveAssessment(next);
      if (useSessionStore.getState().assessment === session) useSessionStore.getState().setAssessment(next);
    } catch { setError(tr('Не удалось сохранить переход. Попробуйте ещё раз.')); }
    finally { pending.current = false; setBusy(false); }
  };

  return <main className="assessment-view" aria-busy={busy}>
    <header className="assessment-header">
      <button type="button" className="btn" onClick={returnToDeckIntro} disabled={busy}>{tr('Вернуться к колоде')}</button>
      <h1>{currentDeck?.name}</h1>
      <p>{tr('Экзамен: учитывается первая проверка. Пропуск — 0 баллов; бонус отдельно.')}</p>
    </header>
    {error && <div role="alert"><p>{error}</p><button type="button" className="btn" disabled={busy}
      onClick={() => { setError(''); if (pendingResult.current) save(pendingResult.current.cardId, pendingResult.current.evidence); }}>{tr('Повторить сохранение')}</button></div>}
    {finished ? <section className="assessment-results" aria-label={tr('Результат экзамена')}>
      <h2>{tr('Результат экзамена')}</h2>
      <p className="assessment-score">{summary.score} / {summary.total}</p>
      <p>{tr('Бонус')}: +{summary.bonus} / {summary.bonusTotal}</p>
      <p>{summary.band}</p><p>{tr('Пропущено')}: {summary.skipped}</p>
      <p>{tr('Результат этой попытки; он не равен долгосрочному освоению навыков.')}</p>
      <h3>{tr('Что повторить')}</h3>
      {summary.recommendations.length ? <ul>{summary.recommendations.map(route => <li key={route.id}>
        <strong>{route.title}</strong>
        {route.deck_ids.map(id => { const deck = decks.find(d => d.id === id); return deck
          ? <button key={id} type="button" className="btn" onClick={() => startStudy(deck, { reviewContext: 'forced' })}>{deck.name}</button>
          : <p key={id}>{tr('Колода')}: {id}</p>; })}
      </li>)}</ul> : <p>{tr('Ошибок в проверенных заданиях не выявлено.')}</p>}
      <details><summary>{tr('Ответы и ошибки')}</summary><ol>{summary.results.map(item => <li key={item.cardId}>
        {tr('Задание')} {item.ordinal}: {tr(item.status === 'correct' ? 'Верно' : item.status === 'skipped' ? 'Пропущено' : 'Ошибка')}
        {' — '}{item.competencyIds.map(id => currentDeck && session.config.competency_titles?.[id] || id).join(', ')}
      </li>)}</ol></details>
    </section> : <>
      <p role="status">{tr('Задание')} {session.index + 1} / {session.cards.length}
        {session.index >= session.config.required_count ? ` · ${tr('Бонус')}` : ''}</p>
      {['trainer', 'free_text', 'editable_text'].includes(detectExerciseType(card)) ? <ExerciseRenderer
        key={`${session.id}:${card.id}`} reviewKey={`${session.id}:${card.id}`} card={card}
        studyMode="classic" assessmentMode styles={settings} onTrainerAnswer={save} />
        : <p role="alert">{tr('Механика задания не поддерживается в экзамене. Вернитесь к колоде.')}</p>}
      <div className="assessment-actions">
        {result ? <button type="button" className="btn btn-primary" disabled={busy || Boolean(error)} onClick={advance}>
          {session.index === session.cards.length - 1 ? tr('Завершить экзамен') : tr('Следующее задание')}
        </button> : <button type="button" className="btn" disabled={busy || Boolean(error)} onClick={() => save(card.id, { skipped: true })}>{tr('Пропустить задание')}</button>}
      </div>
    </>}
  </main>;
}
