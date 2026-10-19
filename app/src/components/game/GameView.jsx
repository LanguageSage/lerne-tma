import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, Lightbulb, RotateCcw, Send, Volume2, Mic, MicOff, Pause } from 'lucide-react';
import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import { gameService, gameVisitorId, gameStorage } from '../../services/gameService';
import { useGameVoice } from './useGameVoice';
import './GameView.css';

const ERROR_COPY = {
  game_ai_not_configured: 'ИИ не настроен. Администратор может выбрать провайдера и модель в настройках Lerne.',
  game_ai_unavailable: 'ИИ временно недоступен. Ваш текст сохранён в поле ввода — попробуйте отправить его снова.',
  game_turn_limit: 'Достигнут лимит этого разговора. Начните новый диалог.',
  game_daily_limit: 'Достигнут дневной лимит Game Mode. Продолжите завтра.',
  game_rate_limit: 'Подождите секунду и повторите отправку.',
  game_request_in_progress: 'Предыдущая реплика ещё обрабатывается. Подождите и повторите отправку.',
  game_state_changed: 'Разговор обновлён в другом окне. История загружена заново; повторите отправку.',
  game_conversation_ended: 'Разговор завершён. Можно начать новый диалог.',
};

function errorText(error) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return tr('Для разговора нужен интернет. История останется доступна на этом экране.');
  return tr(ERROR_COPY[error.response?.data?.detail] || 'Не удалось выполнить запрос. Попробуйте ещё раз.');
}

export function GameView() {
  const [mode, setMode] = useState(() => gameStorage.get('lerne_game_mode') === 'b1_exam' ? 'b1_exam' : 'neighbor');
  useInterfaceLocale();
  return <>
    <nav className="game-tabs" aria-label={tr('Режим разговора')}>
      {[["neighbor", 'Свободный разговор'], ['b1_exam', 'Экзаменационный диалог']].map(([value, label]) =>
        <button key={value} className="game-button" aria-pressed={mode === value} onClick={() => {
          gameStorage.set('lerne_game_mode', value); setMode(value);
        }}>{tr(label)}</button>)}
    </nav>
    <GameConversation key={mode} mode={mode} />
  </>;
}

function GameConversation({ mode }) {
  useInterfaceLocale();
  const isExam = mode === 'b1_exam';
  const topicKey = `lerne_game_topic_${gameVisitorId}`;
  const [topic, setTopic] = useState(() => gameStorage.get(topicKey) || '');
  const [savedAttempts, setSavedAttempts] = useState([]);
  const [scene, setScene] = useState(null);
  const [attempt, setAttempt] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [repeated, setRepeated] = useState('');
  const [setupRetry, setSetupRetry] = useState(0);
  const pending = useRef(null);
  const locked = useRef(false);
  const mounted = useRef(false);
  const conversation = useRef(null);
  const input = useRef(null);
  const startId = useRef(null);
  const ownerId = gameVisitorId;
  const storageKey = `lerne_game_attempt_${ownerId}${isExam ? '_b1_exam' : ''}`;
  const activeScene = attempt?.scenario ? { ...scene, ...attempt.scenario } : scene;
  const isNeighbor = activeScene?.scene.situation_id === 'neighbor_introduction_v1';
  const ended = Boolean(attempt?.ended);
  const voice = useGameVoice({ scene: activeScene, attempt, busy, draft, onDraft: setDraft,
    onSend: message => send('message', message) });

  useEffect(() => {
    let alive = true;
    mounted.current = true;
    async function initialize() {
      try {
        const info = await gameService.scene();
        const saved = isExam ? await gameService.examAttempts() : [];
        const id = gameStorage.get(storageKey);
        let data;
        if (id) {
          try { data = await gameService.load(id); }
          catch (err) { if (err.response?.status !== 404) throw err; }
        }
        if (!data && !isExam) {
          startId.current ||= crypto.randomUUID();
          data = await gameService.start(startId.current);
        }
        if (alive) {
          if (data) gameStorage.set(storageKey, data.id);
          setScene(info);
          setSavedAttempts(saved);
          setAttempt(data || null);
          if (data?.scene.exam_topic) setTopic(data.scene.exam_topic);
          setError('');
          startId.current = null;
        }
      } catch (err) { if (alive) setError(errorText(err)); }
      finally { if (alive) setBusy(false); }
    }
    initialize();
    return () => { alive = false; mounted.current = false; };
  }, [storageKey, setupRetry, isExam]);

  useEffect(() => {
    if (conversation.current) conversation.current.scrollTop = conversation.current.scrollHeight;
  }, [attempt?.version, repeated]);

  const lastNpc = attempt?.history?.slice().reverse().find(message => message.role === 'npc')?.text;
  const aiReady = scene && ['live', 'mock'].includes(scene.ai_mode);

  async function send(action = 'message', spokenText) {
    const message = action === 'message' ? (spokenText ?? draft).trim() : '';
    if (locked.current || !attempt || (action !== 'review' && (ended || attempt.turn_count >= attempt.max_turns)) || (action === 'message' && (!message || !aiReady))) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setRepeated('');
    voice.beforeSend();
    const previous = pending.current;
    const request = previous?.action === action && previous?.message === message && previous?.version === attempt.version
      ? previous : { request_id: crypto.randomUUID(), version: attempt.version, action, message };
    pending.current = request;
    try {
      let data = await gameService.turn(attempt.id, request);
      if (!mounted.current) return;
      setAttempt(data);
      pending.current = null;
      if (action === 'message') setDraft('');
      if (isExam && data.ended && !data.learning_result) {
        const reviewRequest = { request_id: crypto.randomUUID(), version: data.version, action: 'review', message: '' };
        pending.current = reviewRequest;
        data = await gameService.turn(data.id, reviewRequest);
        if (!mounted.current) return;
        setAttempt(data);
        pending.current = null;
      }
      if (!voice.enabled && !data.ended) input.current?.focus();
    } catch (err) {
      if (!mounted.current) return;
      if (['game_state_changed', 'game_conversation_ended'].includes(err.response?.data?.detail)) {
        try { setAttempt(await gameService.load(attempt.id)); pending.current = null; } catch { /* retain retry */ }
      }
      setError(errorText(err));
      voice.pause();
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function newConversation() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    voice.pause();
    // Preserve the ID after an unknown outcome so retry does not create another attempt.
    startId.current ||= crypto.randomUUID();
    try {
      const data = await gameService.start(startId.current, isExam ? { mode: 'b1_exam', topic } : {});
      const info = await gameService.scene();
      if (!mounted.current) return;
      gameStorage.set(storageKey, data.id);
      setAttempt(data);
      setScene(info);
      if (isExam) {
        setTopic(data.scene.exam_topic);
        setSavedAttempts(items => [{ id: data.id, created_at: data.created_at, topic: data.scene.exam_topic.slice(0, 120) }, ...items.filter(item => item.id !== data.id)].slice(0, 20));
      }
      setDraft('');
      setRepeated('');
      pending.current = null;
      startId.current = null;
    } catch (err) { if (mounted.current) setError(errorText(err)); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }

  async function restoreExam(id) {
    if (!id || locked.current) return;
    locked.current = true;
    setBusy(true); setError(''); voice.pause();
    try {
      const data = await gameService.load(id);
      if (!mounted.current) return;
      gameStorage.set(storageKey, data.id);
      setAttempt(data); setTopic(data.scene.exam_topic); setDraft(''); setRepeated('');
      pending.current = null; startId.current = null;
    } catch (err) { if (mounted.current) setError(errorText(err)); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }

  const voiceStatus = {
    off: 'Микрофон выключен', waiting: 'Ожидаю вашу реплику…', listening: 'Вы говорите…',
    recognizing: 'Распознаём речь…', thinking: 'Frau Müller обдумывает ответ…',
    speaking: isExam ? 'Партнёр говорит…' : 'Frau Müller говорит…', paused: 'Голосовой разговор приостановлен', error: 'Голосовой разговор приостановлен',
  };

  return (
    <main className="game-view">
      <header className="game-header">
        <div><span className="game-eyebrow">Game Mode · {tr('Эксперимент')}</span><h1>{isExam ? 'Gemeinsam etwas planen · B1' : activeScene?.scene.name || 'Frau Müller · Kennenlernen'}</h1></div>
        {!isExam && <button className="game-button" onClick={newConversation} disabled={busy || !attempt}>{tr('Новый диалог')}</button>}
      </header>
      {isExam && savedAttempts.length > 0 && <div className="game-exam-topic"><label>{tr('Сохранённые попытки')}
          <select aria-label={tr('Сохранённые попытки')} disabled={busy} value={attempt?.id || ''} onChange={event => restoreExam(event.target.value)}>
            <option value="" disabled>{tr('Выберите попытку')}</option>
            {savedAttempts.map(item => <option key={item.id} value={item.id}>{new Date(item.created_at).toLocaleString()} · {item.topic}</option>)}
          </select>
        </label></div>}
      {isExam && <details className="game-compose game-exam-topic" open={!attempt}>
        <summary>{tr('Тема и повторное прохождение')}</summary>
        <label htmlFor="exam-topic">{tr('Экзаменационная тема из PDF')}</label>
        <textarea id="exam-topic" lang="de" rows={6} maxLength={6000} value={topic} disabled={busy || (attempt && !ended)}
          placeholder="Sie möchten gemeinsam ein Fest organisieren. Planen Sie: Wann? Wo? Essen und Getränke? Wer macht was?"
          onChange={event => { setTopic(event.target.value); gameStorage.set(topicKey, event.target.value); }} />
        <p className="game-secondary">{tr('Вставьте ситуацию и все пункты задания. Партнёр обсуждает план без исправлений; после завершения — разбор на русском.')}</p>
        <button className="game-button game-send" disabled={busy || !topic.trim() || (attempt && !ended)} onClick={newConversation}>
          {tr(attempt ? 'Пройти ещё раз' : 'Начать экзаменационный диалог')}
        </button>
      </details>}
      <section className="game-npc" aria-label={isExam ? 'Alex' : 'Frau Müller'}>
        {!isExam && <svg className="game-portrait" viewBox="0 0 80 80" role="img" aria-label={tr('Временный портрет Frau Müller')}>
          <rect width="80" height="80" rx="20" fill="#333b43" />
          <path d="M15 80c0-22 11-31 25-31s25 9 25 31" fill="#64776e" />
          <path d="M19 35C17 8 61 7 61 35v13H19z" fill="#aaa498" />
          <ellipse cx="40" cy="35" rx="15" ry="19" fill="#c8b6a0" />
          <path d="M22 27c2-19 35-21 37 1-11-1-19-6-23-11-2 6-7 9-14 10" fill="#aaa498" />
          <g fill="none" stroke="#4b514f" strokeWidth="2"><rect x="27" y="32" width="11" height="7" rx="3" /><rect x="42" y="32" width="11" height="7" rx="3" /><path d="M38 35h4M35 46q5 4 10 0" /></g>
        </svg>}
        <div><h2>{isExam ? 'Alex' : activeScene?.npc.name || 'Frau Müller'}</h2><p>{tr(isExam ? 'Партнёр по экзамену B1 · Gemeinsam etwas planen' : isNeighbor ? 'Соседка · доброжелательная и немного любопытная' : 'Библиотекарь · спокойная и терпеливая')}</p></div>
        {!isNeighbor && !isExam && <BookOpen size={24} aria-hidden="true" />}
      </section>
      {isExam ? <section className="game-task"><strong>{tr('Совместное планирование')}</strong>
        <p>{tr('Предлагайте идеи, обсуждайте варианты и договаривайтесь. Ориентир: 8–12 обменов репликами; можно завершить раньше.')}</p>
      </section> : <section className="game-task">
        <strong>{tr('Возможная цель разговора')}</strong>
        <p>{tr(isNeighbor ? 'Вы недавно переехали и встретили соседку Frau Müller. Поздоровайтесь, познакомьтесь, расскажите о себе и задайте ей вопросы. Можно завершить разговор в любой момент.' : 'Можно поискать книгу о выращивании овощей на балконе для начинающих. Или выбрать другую книгу, поговорить о работе и жизни — тему выбираете вы.')}</p>
        {isNeighbor && <span>{tr('Ориентир: 6–10 обменов репликами. Необязательно выполнять все цели.')}{' '}</span>}
        <span>{tr('Говорите по-немецки своими словами. Ошибки не мешают, если смысл понятен.')}</span>
      </section>}
      {scene?.ai_mode === 'mock' && <p className="game-notice" role="status">{tr('MOCK: демонстрация с ограниченными ответами. Это не свободный ИИ-диалог.')}</p>}
      {scene && !aiReady && <p className="game-notice" role="status">{tr(scene.ai_mode === 'unconfigured' ? ERROR_COPY.game_ai_not_configured : ERROR_COPY.game_ai_unavailable)}</p>}
      {attempt?.turn_count >= attempt?.max_turns && <p className="game-notice" role="status">{tr(ERROR_COPY.game_turn_limit)}</p>}
      {ended && <p className="game-result" role="status">{tr('Разговор завершён. Можно начать новый диалог.')}</p>}
      {attempt?.outcome === 'success' && <p className="game-result" role="status">{tr('Задача решена: вы получили подходящую книгу.')} <span lang="de">{attempt.book?.title}</span></p>}
      {attempt?.outcome === 'other_book' && <p className="game-notice" role="status">{tr('Вы получили книгу. Можно продолжить разговор.')} <span lang="de">{attempt.book?.title}</span></p>}
      <section ref={conversation} className="game-conversation" aria-label={tr('История разговора')} role="log" aria-live="polite" aria-relevant="additions text">
        {attempt?.history?.map((message, index) => (
          <article key={index} className={`game-message game-message-${message.role}`}>
            <span className="game-message-author">{message.role === 'npc' ? (isExam ? 'Alex' : 'Frau Müller') : tr(message.role === 'hint' ? 'Подсказка' : 'Вы')}</span>
            <p lang="de">{message.text}</p>
          </article>
        ))}
        {repeated && <article className="game-message game-message-npc"><span className="game-message-author">{isExam ? 'Alex' : 'Frau Müller'} · {tr('Повтор')}</span><p lang="de">{repeated}</p></article>}
        {busy && <p className="game-secondary" role="status">{tr(isExam ? (ended ? 'Готовим разбор…' : 'Партнёр обдумывает ответ…') : attempt ? 'Frau Müller обдумывает ответ…' : 'Открываем разговор…')}</p>}
      </section>
      {isExam && ended && !attempt.learning_result && <button className="game-button" disabled={busy || !aiReady} onClick={() => send('review')}>{tr('Получить разбор')}</button>}
      {isExam && attempt?.learning_result?.kind === 'b1_exam' && <section className="game-review" lang="ru" aria-label="Разбор экзамена">
        <h2>Разбор экзамена</h2>
        <p className="game-secondary">Предварительная оценка ИИ по тексту разговора. Это не официальный результат экзамена; распознавание речи может искажать слова.</p>
        <h3>Выполнение задания</h3><p>{attempt.learning_result.task_completion}</p>
        {['grammar', 'vocabulary'].map(key => <div key={key}><h3>{key === 'grammar' ? 'Грамматика' : 'Словарь'}</h3>
          {attempt.learning_result[key].length ? <ul>{attempt.learning_result[key].map((item, index) => <li key={index}>
            <q lang="de">{item.evidence}</q> → <span lang="de">{item.correction}</span><p>{item.explanation}</p>
          </li>)}</ul> : <p>Надёжных примеров ошибок не обнаружено.</p>}</div>)}
        <h3>Полезные выражения</h3><ul>{attempt.learning_result.useful_expressions.map((text, i) => <li key={i}>{text}</li>)}</ul>
        <h3>Рекомендации</h3><p>{attempt.learning_result.recommendations}</p>
      </section>}
      {error && <div className="game-error" role="alert"><p>{error}</p>{!attempt && <button className="game-button" onClick={() => { setBusy(true); setSetupRetry(value => value + 1); }} disabled={busy}>{tr('Попробовать снова')}</button>}</div>}
      <div className="game-dialogue-actions">
        <button className="game-button" disabled={!lastNpc || busy} onClick={() => { setRepeated(lastNpc); voice.speak(lastNpc); }}><RotateCcw size={16} />{tr('Повторить')}</button>
        <button className="game-button" disabled={!attempt || busy || ended || attempt.turn_count >= attempt.max_turns} onClick={() => send('hint')}><Lightbulb size={16} />{tr('Подсказка')}</button>
        <button className="game-button" disabled={!lastNpc || busy} onClick={() => voice.phase === 'speaking' ? voice.pause() : voice.speak(lastNpc)}><Volume2 size={16} />{tr(voice.phase === 'speaking' ? 'Остановить' : 'Слушать')}</button>
        <button className="game-button" disabled={!attempt || busy || ended || attempt.turn_count >= attempt.max_turns} onClick={() => send('end')}>{tr('Завершить разговор')}</button>
      </div>
      <section className="game-voice" aria-label={tr('Голосовой разговор')}>
        <div className="game-voice-controls">
          <button className="game-button" aria-pressed={voice.enabled} disabled={!voice.enabled && (!attempt || busy || ended || !aiReady || attempt.turn_count >= attempt.max_turns)} onClick={voice.toggle}>
            {voice.enabled ? <MicOff size={16} /> : <Mic size={16} />}{tr(voice.enabled ? 'Выключить голос' : 'Включить голос')}
          </button>
          {voice.enabled && <button className="game-button" disabled={ended || (busy && ['paused', 'error'].includes(voice.phase))} onClick={() => ['paused', 'error'].includes(voice.phase) ? voice.resume() : voice.pause()}><Pause size={16} />{tr(['paused', 'error'].includes(voice.phase) ? 'Продолжить' : 'Пауза')}</button>}
          {voice.enabled && ['waiting', 'listening', 'recognizing'].includes(voice.phase) && <button className="game-button game-send" onClick={voice.finish}>{tr('Завершить реплику')}</button>}
          {voice.enabled && !busy && <button className="game-button" onClick={voice.cancel}>{tr('Отменить реплику')}</button>}
        </div>
        <p className="game-secondary" role="status">{tr(busy && attempt ? (isExam ? (ended ? 'Готовим разбор…' : 'Партнёр обдумывает ответ…') : voiceStatus.thinking) : voiceStatus[voice.phase])}</p>
        {voice.error && <p className="game-error" role="alert">{voice.error}</p>}
        {voice.transcript && <p className="game-transcript"><span>{tr('Распознано:')}</span> <span lang="de">{voice.transcript}</span></p>}
        <div className="game-voice-settings">
          <label><input type="checkbox" checked={voice.autoplay} onChange={event => voice.setAutoplay(event.target.checked)} />{tr('Озвучивать ответы автоматически')}</label>
          <label><input type="checkbox" checked={voice.automatic} onChange={event => voice.setAutomatic(event.target.checked)} />{tr('Отправлять после паузы')}</label>
          {voice.automatic && <label>{tr('Пауза перед отправкой')}<select value={voice.silenceSeconds} onChange={event => voice.setSilenceSeconds(Number(event.target.value))}>{[2, 3, 4, 5].map(seconds => <option key={seconds} value={seconds}>{seconds} {tr('сек.')}</option>)}</select></label>}
        </div>
        <p className="game-footnote">{tr(voice.automatic ? 'Реплика отправится после выбранной паузы. Можно завершить раньше или отменить.' : 'Говорите с паузами. Нажмите «Завершить реплику», когда закончите — удерживать кнопку не нужно.')}</p>
        <p className="game-footnote">{tr('Браузер может прерывать распознавание. Мы пытаемся возобновить его, сохраняя текст; слова во время перезапуска могут быть пропущены.')}</p>
        <p className="game-footnote">{tr('Распознавание может передавать звук сервису браузера. Lerne не сохраняет голосовые записи.')}</p>
      </section>
      <form className="game-compose" onSubmit={event => { event.preventDefault(); send(); }}>
        <label htmlFor="game-message">{tr('Ваша реплика на немецком')}</label>
        <textarea id="game-message" ref={input} value={draft} onFocus={() => { if (voice.enabled) voice.pause(); }} onChange={event => setDraft(event.target.value)} maxLength={1000} rows={3} lang="de" placeholder={isExam ? 'Ich schlage vor, dass wir …' : isNeighbor ? 'Guten Tag! Ich heiße …' : 'Ich suche ein Buch …'} disabled={!attempt || busy || ended || !aiReady} />
        <div className="game-compose-footer"><span className="game-secondary">{tr('Можно попросить:')} <span lang="de">„Bitte einfacher“ · „Bitte langsamer“</span></span><button className="game-button game-send" type="submit" disabled={!draft.trim() || busy || ended || !aiReady || attempt?.turn_count >= attempt?.max_turns}><Send size={17} />{tr('Отправить')}</button></div>
      </form>
      <p className="game-footnote">{tr('Сохраняются ограниченный контекст разговора и результат попытки. Game Mode работает с интернетом.')}</p>
      {attempt?.previous_attempt_at && <p className="game-footnote">{tr('Предыдущая попытка:')} {new Date(attempt.previous_attempt_at).toLocaleString()}</p>}
    </main>
  );
}
