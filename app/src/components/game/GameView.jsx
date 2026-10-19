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
  useInterfaceLocale();
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
  const storageKey = `lerne_game_attempt_${ownerId}`;
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
        const id = gameStorage.get(storageKey);
        let data;
        if (id) {
          try { data = await gameService.load(id); }
          catch (err) { if (err.response?.status !== 404) throw err; }
        }
        if (!data) {
          startId.current ||= crypto.randomUUID();
          data = await gameService.start(startId.current);
        }
        if (alive) {
          gameStorage.set(storageKey, data.id);
          setScene(info);
          setAttempt(data);
          setError('');
          startId.current = null;
        }
      } catch (err) { if (alive) setError(errorText(err)); }
      finally { if (alive) setBusy(false); }
    }
    initialize();
    return () => { alive = false; mounted.current = false; };
  }, [storageKey, setupRetry]);

  useEffect(() => {
    if (conversation.current) conversation.current.scrollTop = conversation.current.scrollHeight;
  }, [attempt?.version, repeated]);

  const lastNpc = attempt?.history?.slice().reverse().find(message => message.role === 'npc')?.text;
  const aiReady = scene && ['live', 'mock'].includes(scene.ai_mode);

  async function send(action = 'message', spokenText) {
    const message = action === 'message' ? (spokenText ?? draft).trim() : '';
    if (locked.current || !attempt || ended || attempt.turn_count >= attempt.max_turns || (action === 'message' && (!message || !aiReady))) return;
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
      const data = await gameService.turn(attempt.id, request);
      if (!mounted.current) return;
      setAttempt(data);
      pending.current = null;
      if (action === 'message') setDraft('');
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
      const data = await gameService.start(startId.current);
      const info = await gameService.scene();
      if (!mounted.current) return;
      gameStorage.set(storageKey, data.id);
      setAttempt(data);
      setScene(info);
      setDraft('');
      setRepeated('');
      pending.current = null;
      startId.current = null;
    } catch (err) { if (mounted.current) setError(errorText(err)); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }

  const voiceStatus = {
    off: 'Микрофон выключен', waiting: 'Ожидаю вашу реплику…', listening: 'Вы говорите…',
    recognizing: 'Распознаём речь…', thinking: 'Frau Müller обдумывает ответ…',
    speaking: 'Frau Müller говорит…', paused: 'Голосовой разговор приостановлен', error: 'Голосовой разговор приостановлен',
  };

  return (
    <main className="game-view">
      <header className="game-header">
        <div><span className="game-eyebrow">Game Mode · {tr('Эксперимент')}</span><h1>{activeScene?.scene.name || 'Frau Müller · Kennenlernen'}</h1></div>
        <button className="game-button" onClick={newConversation} disabled={busy || !attempt}>{tr('Новый диалог')}</button>
      </header>
      <section className="game-npc" aria-label="Frau Müller">
        <svg className="game-portrait" viewBox="0 0 80 80" role="img" aria-label={tr('Временный портрет Frau Müller')}>
          <rect width="80" height="80" rx="20" fill="#333b43" />
          <path d="M15 80c0-22 11-31 25-31s25 9 25 31" fill="#64776e" />
          <path d="M19 35C17 8 61 7 61 35v13H19z" fill="#aaa498" />
          <ellipse cx="40" cy="35" rx="15" ry="19" fill="#c8b6a0" />
          <path d="M22 27c2-19 35-21 37 1-11-1-19-6-23-11-2 6-7 9-14 10" fill="#aaa498" />
          <g fill="none" stroke="#4b514f" strokeWidth="2"><rect x="27" y="32" width="11" height="7" rx="3" /><rect x="42" y="32" width="11" height="7" rx="3" /><path d="M38 35h4M35 46q5 4 10 0" /></g>
        </svg>
        <div><h2>{activeScene?.npc.name || 'Frau Müller'}</h2><p>{tr(isNeighbor ? 'Соседка · доброжелательная и немного любопытная' : 'Библиотекарь · спокойная и терпеливая')}</p></div>
        {!isNeighbor && <BookOpen size={24} aria-hidden="true" />}
      </section>
      <section className="game-task">
        <strong>{tr('Возможная цель разговора')}</strong>
        <p>{tr(isNeighbor ? 'Вы недавно переехали и встретили соседку Frau Müller. Поздоровайтесь, познакомьтесь, расскажите о себе и задайте ей вопросы. Можно завершить разговор в любой момент.' : 'Можно поискать книгу о выращивании овощей на балконе для начинающих. Или выбрать другую книгу, поговорить о работе и жизни — тему выбираете вы.')}</p>
        {isNeighbor && <span>{tr('Ориентир: 6–10 обменов репликами. Необязательно выполнять все цели.')}{' '}</span>}
        <span>{tr('Говорите по-немецки своими словами. Ошибки не мешают, если смысл понятен.')}</span>
      </section>
      {scene?.ai_mode === 'mock' && <p className="game-notice" role="status">{tr('MOCK: демонстрация с ограниченными ответами. Это не свободный ИИ-диалог.')}</p>}
      {scene && !aiReady && <p className="game-notice" role="status">{tr(scene.ai_mode === 'unconfigured' ? ERROR_COPY.game_ai_not_configured : ERROR_COPY.game_ai_unavailable)}</p>}
      {attempt?.turn_count >= attempt?.max_turns && <p className="game-notice" role="status">{tr(ERROR_COPY.game_turn_limit)}</p>}
      {ended && <p className="game-result" role="status">{tr('Разговор завершён. Можно начать новый диалог.')}</p>}
      {attempt?.outcome === 'success' && <p className="game-result" role="status">{tr('Задача решена: вы получили подходящую книгу.')} <span lang="de">{attempt.book?.title}</span></p>}
      {attempt?.outcome === 'other_book' && <p className="game-notice" role="status">{tr('Вы получили книгу. Можно продолжить разговор.')} <span lang="de">{attempt.book?.title}</span></p>}
      <section ref={conversation} className="game-conversation" aria-label={tr('История разговора')} role="log" aria-live="polite" aria-relevant="additions text">
        {attempt?.history?.map((message, index) => (
          <article key={index} className={`game-message game-message-${message.role}`}>
            <span className="game-message-author">{message.role === 'npc' ? 'Frau Müller' : tr(message.role === 'hint' ? 'Подсказка' : 'Вы')}</span>
            <p lang="de">{message.text}</p>
          </article>
        ))}
        {repeated && <article className="game-message game-message-npc"><span className="game-message-author">Frau Müller · {tr('Повтор')}</span><p lang="de">{repeated}</p></article>}
        {busy && <p className="game-secondary" role="status">{tr(attempt ? 'Frau Müller обдумывает ответ…' : 'Открываем разговор…')}</p>}
      </section>
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
        <p className="game-secondary" role="status">{tr(busy && attempt ? voiceStatus.thinking : voiceStatus[voice.phase])}</p>
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
        <textarea id="game-message" ref={input} value={draft} onFocus={() => { if (voice.enabled) voice.pause(); }} onChange={event => setDraft(event.target.value)} maxLength={1000} rows={3} lang="de" placeholder={isNeighbor ? 'Guten Tag! Ich heiße …' : 'Ich suche ein Buch …'} disabled={!attempt || busy || ended || !aiReady} />
        <div className="game-compose-footer"><span className="game-secondary">{tr('Можно попросить:')} <span lang="de">„Bitte einfacher“ · „Bitte langsamer“</span></span><button className="game-button game-send" type="submit" disabled={!draft.trim() || busy || ended || !aiReady || attempt?.turn_count >= attempt?.max_turns}><Send size={17} />{tr('Отправить')}</button></div>
      </form>
      <p className="game-footnote">{tr('Сохраняются ограниченный контекст разговора и результат попытки. Game Mode работает с интернетом.')}</p>
      {attempt?.previous_attempt_at && <p className="game-footnote">{tr('Предыдущая попытка:')} {new Date(attempt.previous_attempt_at).toLocaleString()}</p>}
    </main>
  );
}
