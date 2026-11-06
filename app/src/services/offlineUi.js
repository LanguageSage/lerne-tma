import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useUiStore } from '../store/useUiStore';
import { getSessionIdentity, getUserId } from '../utils/auth';
import { getLocalDb } from './localDb';
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
  const cards = items => items
    .filter(item => !confirmedCard || item.id === confirmedCard.id || id('cards', item.id) !== confirmedCard.id
      || !items.some(existing => existing.id === confirmedCard.id))
    .map(card);
  const state = useDeckStore.getState();
  useDeckStore.setState({
    decks: state.decks.map(deck), currentDeck: deck(state.currentDeck),
    deckCards: cards(state.deckCards), duplicateCards: cards(state.duplicateCards),
    cardsByDeck: Object.fromEntries(Object.entries(state.cardsByDeck).map(([key, items]) =>
      [id('decks', key), cards(items)])),
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
  if (confirmedCard && !confirmedCard.offline_edit && !detail.silent) ui.showToast(tr('Карточка синхронизирована'), 'success');
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
  const { card, confirmed, deliveredRequestId } = detail;
  const update = item => {
    if (item?.id !== card.id) return item;
    const next = { ...item, ...card };
    if (!card.offline_edit) delete next.offline_edit;
    return next;
  };
  const updateEditor = item => {
    if (!deliveredRequestId) return update(item);
    if (item?.id !== card.id || item.offline_edit?.requestId !== deliveredRequestId) return item;
    // Delivery updates the base of an open form without replacing its input.
    const next = { ...item, revision: card.revision, offline_edit: card.offline_edit };
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
    editingCard: updateEditor(state.editingCard),
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

export function offlineMoveLabel(move) {
  if (move.status === 'pending') return tr('Перенос ожидает синхронизации');
  if (['card_revision_conflict', 'card_location_changed'].includes(move.code)) {
    return tr('Конфликт версий. Перенос сохранён на устройстве.');
  }
  return tr('Сервер отклонил перенос. Перенос сохранён на устройстве.');
}

export async function refreshOfflineUi({ detail }) {
  const identity = getSessionIdentity();
  if (detail.userId !== getUserId()) return;
  try {
    const state = useDeckStore.getState();
    await state.fetchDecks(true);
    if (detail.userId !== getUserId() || identity !== getSessionIdentity()) return;
    const current = useDeckStore.getState().currentDeck;
    if (current && useDeckStore.getState().decks.some(d => d.id === current.id)) await state.fetchDeckCards(current.id);
  } catch (error) {
    console.warn('Offline view refresh:', error.message);
  }
}

export async function refreshPeerOfflineUi({ data }) {
  const identity = getSessionIdentity();
  const { type, userId, id, mappings, deliveredRequestId } = data;
  const isCurrent = () => userId === getUserId() && identity === getSessionIdentity();
  if (!isCurrent()) return;
  try {
    const card = id == null ? null : await getLocalDb().cards.get(id);
    if (!isCurrent()) return;
    if (type === 'lerne:card-edit-changed' && card) {
      updateOfflineEditUi({ detail: { userId, card, deliveredRequestId } });
    } else if (type === 'lerne:card-create-error' && card?.offline_create_status === 'error') {
      markOfflineCreateError({ detail: { userId, id } });
    } else if (type === 'lerne:ids-remapped') {
      remapOfflineUi({ detail: { userId, mappings, confirmedCard: card, silent: true } });
      if (id != null) await refreshOfflineUi({ detail: { userId } });
    } else if (type === 'lerne:synced') {
      await refreshOfflineUi({ detail: { userId } });
    }
  } catch (error) {
    if (isCurrent()) console.warn('Offline tab refresh:', error.message);
  }
}
