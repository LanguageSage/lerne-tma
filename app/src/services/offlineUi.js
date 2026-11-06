import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useUiStore } from '../store/useUiStore';
import { getUserId } from '../utils/auth';
import { tr } from '../i18n/locale';

export function remapOfflineUi({ detail }) {
  if (detail.userId !== getUserId()) return;
  const { mappings, confirmedCard } = detail;
  const id = (kind, value) => mappings[kind]?.[String(value)] ?? value;
  const card = item => {
    if (!item) return item;
    const next = { ...item, id: id('cards', item.id), deck_id: id('decks', item.deck_id) };
    if (confirmedCard && next.id === confirmedCard.id && item.id !== next.id) {
      delete next.offline_create_status;
      Object.assign(next, confirmedCard);
    }
    return next;
  };
  const deck = item => item && ({ ...item, id: id('decks', item.id), folder_id: id('folders', item.folder_id) });
  const state = useDeckStore.getState();
  useDeckStore.setState({
    decks: state.decks.map(deck), currentDeck: deck(state.currentDeck),
    deckCards: state.deckCards.map(card), duplicateCards: state.duplicateCards.map(card),
    cardsByDeck: Object.fromEntries(Object.entries(state.cardsByDeck).map(([key, cards]) =>
      [id('decks', key), cards.map(card)])),
    folders: state.folders.map(f => ({ ...f, id: id('folders', f.id), parent_id: id('folders', f.parent_id) })),
  });
  if (state.currentDeck) localStorage.setItem('lerne_current_deck_id', String(id('decks', state.currentDeck.id)));
  const session = useSessionStore.getState();
  useSessionStore.setState({ card: card(session.card), editingCard: card(session.editingCard), studyHistory: session.studyHistory.map(card) });
  const ui = useUiStore.getState();
  useUiStore.setState({
    activeFolderId: id('folders', ui.activeFolderId),
    actionCard: card(ui.actionCard),
    lastSelectedCardId: id('cards', ui.lastSelectedCardId),
    deckToRename: deck(ui.deckToRename),
  });
  if (confirmedCard) ui.showToast(tr('Карточка синхронизирована'), 'success');
}

export function markOfflineCreateError({ detail }) {
  if (detail.userId !== getUserId()) return;
  const card = item => item.id === detail.id ? { ...item, offline_create_status: 'error' } : item;
  useDeckStore.setState(state => ({
    deckCards: state.deckCards.map(card),
    cardsByDeck: Object.fromEntries(Object.entries(state.cardsByDeck).map(([key, cards]) => [key, cards.map(card)])),
  }));
}

export function updateOfflineEditUi({ detail }) {
  if (detail.userId !== getUserId()) return;
  const { card, confirmed } = detail;
  const update = item => {
    if (item?.id !== card.id) return item;
    const next = { ...item, ...card };
    if (!card.offline_edit) delete next.offline_edit;
    return next;
  };
  useDeckStore.setState(state => ({
    deckCards: state.deckCards.map(update),
    duplicateCards: state.duplicateCards.map(update),
    cardsByDeck: Object.fromEntries(Object.entries(state.cardsByDeck).map(([key, cards]) => [key, cards.map(update)])),
  }));
  useSessionStore.setState(state => ({
    card: update(state.card),
    editingCard: state.editingCard?.id === card.id && state.editingCard.offline_edit?.status === 'conflict'
      && card.offline_edit?.status === 'conflict'
      ? { ...state.editingCard, offline_edit: card.offline_edit }
      : update(state.editingCard),
    studyHistory: state.studyHistory.map(update),
  }));
  if (confirmed) useUiStore.getState().showToast(tr('Карточка синхронизирована'), 'success');
}

export function offlineEditLabel(edit) {
  if (edit.status === 'conflict') return tr('Конфликт версий');
  if (edit.status === 'pending') return tr('Ожидает синхронизации');
  if (edit.httpStatus === 401) return tr('Войдите снова, чтобы синхронизировать правку. Черновик на устройстве.');
  if (edit.httpStatus === 403) return tr('Сервер запретил изменение. Черновик на устройстве.');
  return tr('Ошибка синхронизации. Карточка сохранена на устройстве.');
}

export async function refreshOfflineUi({ detail }) {
  if (detail.userId !== getUserId()) return;
  try {
    const state = useDeckStore.getState();
    await state.fetchDecks(true);
    if (detail.userId !== getUserId()) return;
    const current = useDeckStore.getState().currentDeck;
    if (current && useDeckStore.getState().decks.some(d => d.id === current.id)) await state.fetchDeckCards(current.id);
  } catch (error) {
    console.warn('Offline view refresh:', error.message);
  }
}
