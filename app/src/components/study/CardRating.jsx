import React, { useEffect, useRef, useState } from 'react';
import { ThumbsDown, ThumbsUp, X } from 'lucide-react';
import api from '../../services/api.js';
import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import { useCardRating } from '../../hooks/useCardRating';
import { useUiStore } from '../../store/useUiStore';
import './CardRating.css';

const REASONS = [
  ['unclear', () => tr('Непонятное задание')],
  ['error', () => tr('Ошибка в карточке')],
  ['too_hard', () => tr('Слишком сложно')],
  ['boring', () => tr('Неинтересно')],
];
const UNDO_MS = 5000;

/**
 * Like/dislike for the card being studied, available before and after the answer.
 * The vote is saved on tap and can be undone; the optional text reuses the existing
 * "suggest an improvement" message flow (`/messages`).
 */
export function CardRating({ card, deckId }) {
  const account = useUiStore(s => s.userProfile?.user_id);
  return <CardRatingControls key={`${account}:${card?.id}`} card={card} deckId={deckId} />;
}

function CardRatingControls({ card, deckId }) {
  useInterfaceLocale();
  const isGuest = useUiStore(s => s.userProfile?.is_guest);
  const { userId, value, busy, save } = useCardRating(card?.id, deckId);
  const [panel, setPanel] = useState(null); // 'like' | 'dislike'
  const [notice, setNotice] = useState(null); // { previous } while a like can be undone
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const draft = useRef({ id: null, text: '' });
  const mounted = useRef(true);
  const actionPending = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  // Temporary offline card IDs are negative; the server cannot rate them.
  if (!(Number(card?.id) > 0)) return null;

  const rating = value?.rating ?? null;
  const run = async action => {
    if (actionPending.current) return;
    actionPending.current = true;
    setError('');
    try { await action(); }
    catch {
      if (!mounted.current) return;
      setError(tr('Не удалось сохранить оценку. Повторите попытку.'));
      setPanel(null);
      setNotice(null);
    }
    finally { actionPending.current = false; }
  };
  const vote = next => {
    if (userId == null || isGuest) {
      useUiStore.getState().setIsAuthModalOpen(true, tr('Вход в аккаунт'));
      return;
    }
    if (busy) return;
    run(async () => {
      if (rating === next) {
        setPanel(null); setNotice(null);
        await save(null);
        return;
      }
      await save(next);
      if (!mounted.current) return;
      setPanel(next === -1 ? 'dislike' : null);
      setNotice(next === 1 ? { previous: value } : null);
    });
  };
  const undo = () => run(async () => {
    setNotice(null);
    await save(notice.previous?.rating ?? null, notice.previous?.reason);
  });
  const toggleReason = reason => !busy && run(() => save(-1, value?.reason === reason ? null : reason));
  const send = async event => {
    event.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    // An unchanged retry keeps its UUID, so a lost response cannot create a duplicate.
    if (draft.current.text !== body) draft.current = { id: crypto.randomUUID(), text: body };
    setSending(true); setError('');
    try {
      await api.put(`/messages/${draft.current.id}`, { text: body, card_id: card.id });
      if (!mounted.current) return;
      draft.current = { id: null, text: '' };
      setText(''); setPanel(null);
      useUiStore.getState().showToast(tr('Предложение отправлено'), 'success');
    } catch { if (mounted.current) setError(tr('Не удалось отправить предложение. Повторите попытку.')); }
    finally { if (mounted.current) setSending(false); }
  };

  return (
    <div className="study-card-rating" role="group" aria-label={tr('Оценка карточки')}>
      <div className="card-rating-pill" aria-busy={busy}>
        <button type="button" className={`card-rating-btn is-like ${rating === 1 ? 'is-on' : ''}`}
          aria-pressed={value ? rating === 1 : undefined} aria-label={tr('Нравится')} title={tr('Нравится')}
          disabled={busy} onClick={() => vote(1)}>
          <ThumbsUp size={18} aria-hidden="true" />
          <span className="card-rating-count">{value?.likes ?? '—'}</span>
        </button>
        <button type="button" className={`card-rating-btn is-dislike ${rating === -1 ? 'is-on' : ''}`}
          aria-pressed={value ? rating === -1 : undefined} aria-label={tr('Не нравится')} title={tr('Не нравится')}
          disabled={busy} onClick={() => vote(-1)}>
          <ThumbsDown size={18} aria-hidden="true" />
          <span className="card-rating-count">{value?.dislikes ?? '—'}</span>
        </button>
      </div>
      {!value && !error && <p className="card-rating-note" role="status">{tr('Оценка пока не подтверждена сервером')}</p>}
      {error && <p className="card-rating-error" role="alert">{error}</p>}
      {notice && !panel && (
        <div className="card-rating-notice" role="status">
          <span>{tr('Спасибо! Оценка сохранена')}</span>
          <button type="button" className="card-rating-link" disabled={busy} onClick={undo}>{tr('Отменить')}</button>
          <button type="button" className="card-rating-link is-muted" onClick={() => { setPanel('like'); setNotice(null); }}>
            {tr('Добавить комментарий')}
          </button>
        </div>
      )}
      {panel && (
        <form className="card-rating-panel" onSubmit={send}>
          <div className="card-rating-panel-head">
            <strong>{panel === 'dislike' ? tr('Что не так?') : tr('Комментарий')}</strong>
            <span>{tr('необязательно')}</span>
            <button type="button" className="card-rating-close" aria-label={tr('Закрыть')} onClick={() => setPanel(null)}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          {panel === 'dislike' && (
            <div className="card-rating-chips">
              {REASONS.map(([code, label]) => (
                <button key={code} type="button" className={`card-rating-chip ${value?.reason === code ? 'is-on' : ''}`}
                  aria-pressed={value?.reason === code} disabled={busy} onClick={() => toggleReason(code)}>
                  {label()}
                </button>
              ))}
            </div>
          )}
          <textarea value={text} rows={3} maxLength={2000} disabled={sending}
            aria-label={tr('Что улучшить')} placeholder={tr('Напишите, что улучшить…')}
            onChange={event => setText(event.target.value)} />
          <div className="card-rating-actions">
            <button type="button" className="card-rating-link is-muted" onClick={() => setPanel(null)}>{tr('Не сейчас')}</button>
            <button type="submit" className="card-rating-send" disabled={sending || !text.trim()}>{tr('Отправить')}</button>
          </div>
          <p className="card-rating-note">{tr('Оценка уже сохранена. Текст уйдёт как предложение по карточке.')}</p>
        </form>
      )}
    </div>
  );
}
