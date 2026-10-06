import {
  LERNE_CARD_SEPARATOR,
  extractContextMetadata,
  parseBatchCardsText,
  parseImportedCardSections,
  splitImportedCards
} from './batchCardParser.js';
import { getLevelInfo } from './levelUtils.js';
import { getDescendantFolderIds, getSortedFolderAndDeckTree } from './deckUtils.js';
import { tr } from '../i18n/locale.js';
import { cardTextMetadata, persistentTextId } from './cardTextMetadata.js';

export const CARD_TEXT_EXPORT_WARNINGS = {
  'import-normalization': 'Импорт изменяет пустые ответы и формат или метаданные CONTEXT.',
  media: 'Изображения и видео не восстанавливаются текстовым импортом.',
  tags: 'Произвольные теги не восстанавливаются текстовым импортом.',
  unsynced: 'Для обновления карточек сначала синхронизируйте их и экспортируйте заново.'
};

const textValue = value => String(value ?? '').replace(/\r\n?/g, '\n').trim();
const headingValue = value => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();

const withImportNotes = (result, folder = false) => {
  const notes = [
    ...(folder ? [tr('Заголовки колод служат для навигации. Импорт добавляет все карточки в выбранную колоду.')] : []),
    ...result.warnings.map(code => tr(CARD_TEXT_EXPORT_WARNINGS[code]))
  ];
  return { ...result, text: notes.length ? notes.map(note => `# ${note}`).join('\n') + '\n\n' + result.text : result.text };
};

export class CardTextExportError extends Error {
  constructor(deckName, cardNumber) {
    super('Card content conflicts with the import format');
    this.name = 'CardTextExportError';
    this.deckName = deckName;
    this.cardNumber = cardNumber;
  }
}

/** Keep the stored source intact; exercise syntax belongs to the existing parser. */
export function serializeCard(card, deckName = '', cardNumber = 1, deckId = card.deck_id) {
  const front = textValue(card.front ?? card.front_text);
  const back = textValue(card.back ?? card.back_text);
  const context = textValue(card.context);
  const level = getLevelInfo(card)?.level;
  const topic = textValue(card.topics);
  const contextText = [level && `::level ${level}`, topic && `::topic ${topic}`, context]
    .filter(Boolean).join('\n');
  const text = `FRONT:\n${front}\n\nBACK:\n${back}\n\nCONTEXT:\n${contextText}`;

  // Let the importer validate its own delimiters, instead of duplicating its grammar.
  const blocks = splitImportedCards(text);
  const sections = blocks.length === 1 ? parseImportedCardSections(blocks[0]) : null;
  if (!sections
    || sections.front !== front || sections.back !== back || sections.context !== contextText) {
    throw new CardTextExportError(deckName, cardNumber);
  }

  const imported = parseBatchCardsText(text)[0];
  const warnings = [];
  if (imported.context !== context || imported.back !== back
    || (level && imported.level !== level) || imported.topics !== topic
    || extractContextMetadata(context).cleanContext !== context) {
    warnings.push('import-normalization');
  }
  if (card.image_path || card.image_url || card.image_data || card.video_front_path
    || card.video_front_url || card.video_back_path || card.video_back_url) {
    warnings.push('media');
  }
  // CEFR is supported in CONTEXT; arbitrary tags have no text import representation.
  if (textValue(card.tags) && textValue(card.tags) !== imported.tags) {
    warnings.push('tags');
  }
  if ((card.id != null && !persistentTextId(card.id)) || (deckId != null && !persistentTextId(deckId))) {
    warnings.push('unsynced');
  }
  const metadata = cardTextMetadata(card.id, deckId);
  return { text: metadata ? `${metadata}\n${text}` : text, warnings };
}

/** Input order is the canonical API/store order, never a study queue or UI filter. */
export function serializeDeck(deck, cards) {
  const serialized = cards.filter(card => !card.is_deleted)
    .map((card, index) => serializeCard(card, deck.name, index + 1, deck.id));
  return withImportNotes({
    text: serialized.map(card => card.text).join(`\n\n${LERNE_CARD_SEPARATOR}\n\n`),
    cardCount: serialized.length,
    warnings: [...new Set(serialized.flatMap(card => card.warnings))]
  });
}

/** Same folder-first tree and sibling order as the folder navigation, fully expanded. */
export function getFolderExportDecks(folder, folders, decks) {
  const activeFolders = folders.filter(item => !item.is_deleted);
  const activeDecks = decks.filter(item => !item.is_deleted);
  const ids = new Set([folder.id, ...getDescendantFolderIds(folder.id, activeFolders)]);
  // A shared/search result may have ancestors absent from the local snapshot.
  const scopedFolders = [
    { ...folder, parent_id: null },
    ...activeFolders.filter(item => ids.has(item.id) && item.id !== folder.id)
  ];
  const scopedDecks = activeDecks.filter(deck => ids.has(deck.folder_id));
  const expanded = Object.fromEntries(scopedFolders.map(item => [item.id, true]));
  const byId = new Map(scopedDecks.map(deck => [deck.id, deck]));
  return getSortedFolderAndDeckTree(scopedFolders, scopedDecks, expanded)
    .filter(item => item.type === 'deck' && byId.has(item.id))
    .map(item => byId.get(item.id));
}

/** Preamble headings are already ignored before FRONT by the legacy importer. */
export function serializeFolder(sections) {
  const serialized = sections.map(({ deck, cards }) => ({ deck, ...serializeDeck(deck, cards) }));
  return withImportNotes({
    text: serialized.map(({ deck, text }) => `# Deck: ${headingValue(deck.name)}\n\n${text}`)
      .join(`\n\n${LERNE_CARD_SEPARATOR}\n\n`),
    cardCount: serialized.reduce((total, deck) => total + deck.cardCount, 0),
    warnings: [...new Set(serialized.flatMap(deck => deck.warnings))]
  }, true);
}

export function cardTextFilename(name) {
  const safeName = [...headingValue(name)]
    .map(character => character.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(character) ? '_' : character).join('')
    .replace(/[. ]+$/g, '').slice(0, 120).trim();
  // Windows reserved device names remain reserved even with a .txt extension.
  const basename = safeName && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safeName)
    ? safeName : 'Lerne';
  return `${basename}.txt`;
}
