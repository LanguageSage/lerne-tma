import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useUiStore } from '../store/useUiStore';
import { getUserId } from '../utils/auth';

export function remapOfflineUi({ detail }) {
  if (detail.userId !== getUserId()) return;
  const { mappings } = detail;
  const id = (kind, value) => mappings[kind]?.[String(value)] ?? value;
  const card = item => item && ({ ...item, id: id('cards', item.id), deck_id: id('decks', item.deck_id) });
  const deck = item => item && ({ ...item, id: id('decks', item.id), folder_id: id('folders', item.folder_id) });
  const state = useDeckStore.getState();
  useDeckStore.setState({
    decks: state.decks.map(deck), currentDeck: deck(state.currentDeck),
    deckCards: state.deckCards.map(card), duplicateCards: state.duplicateCards.map(card),
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
