import deA2Alltag from './decks/de_a2_alltag.json' with { type: 'json' };
import deB1Vergangenheit from './decks/de_b1_vergangenheit.json' with { type: 'json' };
import deB1Nebensaetze from './decks/de_b1_nebensaetze.json' with { type: 'json' };
import { sha256Hex } from './sha256.js';

export const STANDALONE_PACK_ID = 'lerne-offline-pilot-de-v1';
export const STANDALONE_PACK_VERSION = 1;
export const SUPPORTED_OFFLINE_CARD_TYPES = [
  'theory',
  'standard',
  'trainer',
  'quiz',
  'match',
  'puzzle',
  'word_bank',
];

const DEFAULT_DECK_SPECS = [
  {
    id: 9101,
    slug: 'de-a2-alltag',
    targetLanguage: 'de',
    color: '#4f46e5',
    position: 0,
    cardIdBase: 910100,
    document: deA2Alltag,
  },
  {
    id: 9102,
    slug: 'de-b1-vergangenheit',
    targetLanguage: 'de',
    color: '#0d9488',
    position: 1,
    cardIdBase: 910200,
    document: deB1Vergangenheit,
  },
  {
    id: 9103,
    slug: 'de-b1-nebensaetze',
    targetLanguage: 'de',
    color: '#7c3aed',
    position: 2,
    cardIdBase: 910300,
    document: deB1Nebensaetze,
  },
];

export function computeCardSetFingerprint(cards) {
  const canonicalLines = [...cards]
    .sort((a, b) => a.id - b.id)
    .map(card => `${card.id}:${card.cardKey}`)
    .join('\n');
  return sha256Hex(canonicalLines);
}

export function buildStandalonePack({
  packId = STANDALONE_PACK_ID,
  packVersion = STANDALONE_PACK_VERSION,
  deckSpecs = DEFAULT_DECK_SPECS,
} = {}) {
  const decks = [];
  const cards = [];

  for (const spec of deckSpecs) {
    const doc = structuredClone(spec.document);
    decks.push({
      id: spec.id,
      slug: spec.slug,
      targetLanguage: spec.targetLanguage || doc?.deck?.metadata?.target_language || 'de',
      color: spec.color || '#6366f1',
      position: spec.position ?? decks.length,
      document: doc,
    });

    const docCards = Array.isArray(doc?.cards) ? doc.cards : [];
    docCards.forEach((card, index) => {
      const cardId = spec.cardIdBase + index + 1;
      const authorId = typeof card?.id === 'string' && card.id.trim()
        ? card.id.trim()
        : `card-${index + 1}`;
      cards.push({
        id: cardId,
        deckId: spec.id,
        slug: spec.slug,
        position: index,
        targetLanguage: spec.targetLanguage || doc?.deck?.metadata?.target_language || 'de',
        cardKey: `${spec.slug}:${authorId}`,
        card,
      });
    });
  }

  return {
    packId,
    packVersion,
    decks,
    cards,
    cardSetFingerprint: computeCardSetFingerprint(cards),
  };
}

let cachedDefaultPack = null;

export function getStandalonePack() {
  if (!cachedDefaultPack) {
    cachedDefaultPack = buildStandalonePack();
  }
  return cachedDefaultPack;
}

export function getStandaloneCardLookup(pack = getStandalonePack()) {
  const byId = new Map();
  const byKey = new Map();
  for (const card of pack.cards) {
    byId.set(card.id, card);
    byKey.set(card.cardKey, card);
  }
  return { byId, byKey };
}
