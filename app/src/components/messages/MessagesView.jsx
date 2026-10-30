import React from 'react';
import { ChevronLeft, RefreshCw, Send } from 'lucide-react';
import { networkApi } from '../../services/api.js';
import { getUserId } from '../../utils/auth.js';
import { tr } from '../../i18n/locale.js';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale.js';
import { useUiStore } from '../../store/useUiStore.js';
import { useDeckStore } from '../../store/useDeckStore.js';
import { navigateUp } from '../../utils/navigation.js';
import './MessagesView.css';

const errorText = error => error?.response?.status === 503
  ? tr('Сообщения пока недоступны: требуется миграция базы данных №90. Остальные разделы работают как обычно.')
  : tr('Не удалось загрузить сообщения. Проверьте соединение и повторите попытку.');

export function MessagesView() {
  useInterfaceLocale();
  const messageDraftCard = useUiStore(state => state.messageDraftCard);
  const roots = useUiStore(state => state.messageRoots);
  const setRoots = useUiStore(state => state.setMessageRoots);
  const clearDraftCard = useUiStore(state => state.clearMessageDraftCard);
  const [selectedId, setSelectedId] = React.useState(null);
  const [isComposing, setIsComposing] = React.useState(false);
  const [messages, setMessages] = React.useState([]);
  const [text, setText] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [threadLoading, setThreadLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [unavailable, setUnavailable] = React.useState(false);
  const pendingId = React.useRef(null);
  const userId = getUserId();

  const refresh = React.useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data } = await networkApi.get('/messages');
      if (getUserId() === userId) { setRoots(data); setError(''); setUnavailable(false); }
    } catch (e) {
      if (getUserId() === userId) {
        setError(errorText(e));
        setUnavailable(e?.response?.status === 503);
      }
    } finally { setLoading(false); }
  }, [setRoots, userId]);

  React.useEffect(() => { refresh(); }, [refresh]);

  const openThread = async id => {
    setSelectedId(id);
    setIsComposing(false);
    setMessages([]);
    clearDraftCard();
    setError('');
    setThreadLoading(true);
    try {
      const { data } = await networkApi.get(`/messages/${id}`);
      if (getUserId() !== userId) return;
      setMessages(data);
      if (data.some(row => row.sender !== 'user' && !row.read_at)) {
        await networkApi.put(`/messages/${id}/read`, { read: true });
        await refresh();
      }
    } catch (e) { setError(errorText(e)); }
    finally { setThreadLoading(false); }
  };

  const markRead = async (id, read) => {
    setBusy(true); setError('');
    try {
      await networkApi.put(`/messages/${id}/read`, { read });
      await refresh();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };

  const send = async event => {
    event.preventDefault();
    const value = text.trim();
    if (!value || busy || unavailable || !userId) return;
    setBusy(true); setError('');
    const id = pendingId.current || crypto.randomUUID();
    pendingId.current = id;
    try {
      await networkApi.put(`/messages/${id}`, {
        text: value,
        ...(selectedId ? { thread_id: selectedId } : messageDraftCard?.id ? { card_id: messageDraftCard.id } : {}),
      });
      if (getUserId() !== userId) return;
      pendingId.current = null;
      setText('');
      clearDraftCard();
      await refresh();
      await openThread(selectedId || id);
    } catch (e) {
      setError(e?.response?.status === 503 ? errorText(e) : tr('Не удалось отправить сообщение. Текст сохранён, повторите попытку.'));
      setUnavailable(e?.response?.status === 503);
    } finally { setBusy(false); }
  };

  const openCard = async () => {
    setBusy(true); setError('');
    try {
      const { data } = await networkApi.get(`/messages/${selectedId}/card`);
      const deckState = useDeckStore.getState();
      const deck = deckState.decks.find(row => String(row.id) === String(data.deck_id));
      if (!deck) throw new Error('Card unavailable');
      const cards = await deckState.fetchDeckCards(deck.id);
      if (!cards.some(row => String(row.id) === String(data.id))) throw new Error('Card unavailable');
      deckState.setCurrentDeck(deck);
      const ui = useUiStore.getState();
      ui.setCardsScrollTop(0);
      ui.setLastSelectedCardId(data.id);
      ui.setView('cards');
    } catch (e) {
      setError(e?.response?.status === 404 ? tr('Карточка больше не существует.') : tr('Не удалось открыть карточку. Возможно, доступ к ней изменился.'));
    } finally { setBusy(false); }
  };

  const selectedRoot = roots.find(row => row.id === selectedId);
  const back = () => {
    if (useUiStore.getState().returnFromCardMessage()) return;
    if (selectedId || messageDraftCard || isComposing) {
      setSelectedId(null); setIsComposing(false); setMessages([]); setText(''); setError('');
      pendingId.current = null; clearDraftCard();
    } else navigateUp();
  };

  return <div className="messages-view view">
    <header className="messages-header">
      <button type="button" className="back-btn" onClick={back} aria-label={tr('Назад')}><ChevronLeft size={24} /></button>
      <h1>{tr('Мои сообщения')}</h1>
      <button type="button" className="header-action-btn" onClick={() => {
        if (selectedId) openThread(selectedId);
        else refresh();
      }} disabled={loading || busy} aria-label={tr('Обновить')} title={tr('Обновить')}><RefreshCw size={19} /></button>
    </header>
    {!userId && <p role="alert">{tr('Войдите в аккаунт, чтобы просматривать сообщения.')}</p>}
    {error && <p className="messages-error" role="alert">{error}</p>}
    {loading && <p role="status">{tr('Загрузка...')}</p>}
    {userId && !selectedId && !messageDraftCard && !isComposing && <>
      <button type="button" className="btn-primary messages-new" disabled={unavailable}
        onClick={() => { setIsComposing(true); setMessages([]); clearDraftCard(); setText(''); }}>
        {tr('Написать модератору')}
      </button>
      {!loading && !roots.length && !error && <p className="messages-empty">{tr('Сообщений пока нет')}</p>}
      <div className="messages-list">
        {roots.map(root => <article key={root.id} className="messages-list-row">
          <button type="button" onClick={() => openThread(root.id)}>
            <strong>{root.card_id ? tr('Предложение по карточке № {{p0}}', { p0: root.card_id }) : root.kind === 'system' ? tr('Уведомление') : tr('Переписка с модератором')}</strong>
            <span>{root.text}</span>
            <small>{new Date(root.created_at).toLocaleString()}</small>
          </button>
          {!!root.incoming_count && <button type="button" className="btn-secondary messages-read" disabled={busy}
            onClick={() => markRead(root.id, !!root.unread_count)}>
            {root.unread_count ? tr('Прочитано') : tr('Не прочитано')}
            {!!root.unread_count && <span className="message-unread-count">{root.unread_count}</span>}
          </button>}
        </article>)}
      </div>
    </>}
    {userId && (selectedId || messageDraftCard || isComposing) && <>
      <div className="messages-thread-heading">
        <h2>{messageDraftCard ? tr('Предложить улучшение') : selectedRoot?.card_id ? tr('Предложение по карточке № {{p0}}', { p0: selectedRoot.card_id }) : tr('Переписка с модератором')}</h2>
        {selectedRoot?.card_id && <button type="button" className="btn-secondary" disabled={busy} onClick={openCard}>{tr('Открыть карточку')}</button>}
      </div>
      {messageDraftCard && <p className="messages-card-reference">{tr('Карточка № {{p0}}', { p0: messageDraftCard.id })}</p>}
      {threadLoading && <p role="status">{tr('Загрузка...')}</p>}
      <div className="messages-thread">
        {messages.map(row => <article key={row.id} className={`messages-bubble ${row.sender === 'user' ? 'mine' : ''}`}>
          <strong>{tr(row.sender === 'user' ? 'Вы' : row.sender === 'admin' ? 'Модератор' : 'Система')}</strong>
          <p>{row.text}</p><small>{new Date(row.created_at).toLocaleString()}</small>
        </article>)}
      </div>
      <form onSubmit={send} className="messages-compose">
        <label htmlFor="message-text">{tr(selectedId ? 'Ответить' : 'Сообщение модератору')}</label>
        <textarea id="message-text" rows={4} maxLength={10000} required disabled={busy || unavailable}
          value={text} onChange={event => { setText(event.target.value); pendingId.current = null; }} />
        <button type="submit" className="btn-primary" disabled={busy || unavailable || !text.trim()}>
          <Send size={17} /> {tr('Отправить')}
        </button>
      </form>
      {selectedId && !!selectedRoot?.incoming_count && <button type="button" className="btn-secondary" disabled={busy}
        onClick={() => markRead(selectedId, !!selectedRoot?.unread_count)}>
        {selectedRoot?.unread_count ? tr('Отметить прочитанным') : tr('Отметить непрочитанным')}
      </button>}
    </>}
  </div>;
}
