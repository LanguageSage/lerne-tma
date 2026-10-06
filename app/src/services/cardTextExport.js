import api from './api';
import {
  cardTextFilename, getFolderExportDecks, serializeDeck, serializeFolder
} from '../utils/cardTextSerializer';

/** Authenticated reads also use the existing offline API when offline. */
export async function loadCardTextExport({ deck, folder, folders, decks }) {
  const readCards = async item => {
    const response = await api.get(`/decks/${item.id}/cards`);
    if (!Array.isArray(response.data)) throw new Error('Invalid cards response');
    return response.data;
  };
  if (deck) return { ...serializeDeck(deck, await readCards(deck)), filename: cardTextFilename(deck.name) };

  const sections = [];
  for (const item of getFolderExportDecks(folder, folders, decks)) {
    sections.push({ deck: item, cards: await readCards(item) });
  }
  // No partial file is downloaded if any deck could not be read or serialized.
  return { ...serializeFolder(sections), filename: cardTextFilename(folder.name) };
}

export function downloadCardText({ text, filename }) {
  const url = URL.createObjectURL(new Blob([text + '\n'], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Allow the browser to begin the download before revoking the object URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
