import { prepareLocalDb } from '../services/localDb.js';
import { getUserId } from '../utils/auth.js';
import { studySideText } from '../utils/structuredStudyCard.js';
import { nativeV2Version, validateNativeV2Content } from '../utils/nativeV2Contract.js';
import { getStandalonePack } from './standalonePack.js';

export const STANDALONE_SEED_MANIFEST_KEY = 'standalone_seed_manifest';

let defaultSeedFlight = null;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateStandalonePack(pack) {
  if (!pack || typeof pack !== 'object') {
    throw new Error('Standalone pack is missing');
  }
  if (!isNonEmptyString(pack.packId) || !Number.isInteger(pack.packVersion) || pack.packVersion < 1) {
    throw new Error('Standalone pack metadata is invalid');
  }
  if (!Array.isArray(pack.decks) || pack.decks.length === 0) {
    throw new Error('Standalone pack must contain at least one deck');
  }
  if (!Array.isArray(pack.cards) || pack.cards.length === 0) {
    throw new Error('Standalone pack must contain at least one card');
  }

  const deckIds = new Set();
  const deckSlugs = new Set();
  for (const deck of pack.decks) {
    if (!Number.isInteger(deck.id) || deck.id <= 0) {
      throw new Error(`Invalid bundled deck id: ${deck.id}`);
    }
    if (deckIds.has(deck.id)) {
      throw new Error(`Duplicate bundled deck id: ${deck.id}`);
    }
    deckIds.add(deck.id);
    if (!isNonEmptyString(deck.slug) || deckSlugs.has(deck.slug)) {
      throw new Error(`Invalid or duplicate bundled deck slug: ${deck.slug}`);
    }
    deckSlugs.add(deck.slug);
    if (deck.document?.schema_version !== nativeV2Version || !isNonEmptyString(deck.document?.deck?.name)) {
      throw new Error(`Bundled deck "${deck.slug}" is not a valid Native JSON V2 document`);
    }
  }

  const cardIds = new Set();
  const cardKeys = new Set();
  for (const entry of pack.cards) {
    if (!Number.isInteger(entry.id) || entry.id <= 0) {
      throw new Error(`Invalid bundled card id: ${entry.id}`);
    }
    if (cardIds.has(entry.id)) {
      throw new Error(`Duplicate bundled card id: ${entry.id}`);
    }
    cardIds.add(entry.id);
    if (!deckIds.has(entry.deckId)) {
      throw new Error(`Bundled card ${entry.id} references unknown deck ${entry.deckId}`);
    }
    if (!isNonEmptyString(entry.cardKey) || cardKeys.has(entry.cardKey)) {
      throw new Error(`Invalid or duplicate bundled card key: ${entry.cardKey}`);
    }
    cardKeys.add(entry.cardKey);
    try {
      validateNativeV2Content({ schema_version: nativeV2Version, card: entry.card }, { writable: true });
    } catch (error) {
      throw new Error(`Card ${entry.cardKey}: ${error.message}`, { cause: error });
    }
  }
}

function buildDeckMetadata(deckEntry) {
  const docDeck = deckEntry.document.deck;
  const passport = docDeck.passport ? structuredClone(docDeck.passport) : null;
  return {
    ...(docDeck.metadata || {}),
    ...(passport?.intro ? { intro: passport.intro } : {}),
    ...(passport?.pedagogy ? { pedagogy: passport.pedagogy } : {}),
    ...(passport ? { passport } : {}),
    deck_type: 'standard',
    resources: [],
    standalone_slug: deckEntry.slug,
  };
}

export async function ensureStandaloneSeed({ db = null, userId = null, pack = null } = {}) {
  const useDefaultFlight = !db && userId == null && !pack;
  if (useDefaultFlight && defaultSeedFlight) {
    return defaultSeedFlight;
  }

  const run = async () => {
    const resolvedPack = pack || getStandalonePack();
    validateStandalonePack(resolvedPack);
    const database = db || await prepareLocalDb();
    const resolvedUserId = userId ?? getUserId();
    if (resolvedUserId == null) {
      throw new Error('Cannot seed standalone pack without active user ID');
    }

    return database.transaction('rw', database.decks, database.cards, database.syncState, async () => {
      const existingManifest = await database.syncState.get(STANDALONE_SEED_MANIFEST_KEY);
      const existingDecks = await database.decks.bulkGet(resolvedPack.decks.map(d => d.id));
      const existingCards = await database.cards.bulkGet(resolvedPack.cards.map(c => c.id));
      const cacheMarkers = await database.syncState.bulkGet(resolvedPack.decks.map(d => `deck-cards:${d.id}`));

      const allDecksPresent = existingDecks.every(deck => (
        deck
        && !deck.is_deleted
        && deck.role === 'viewer'
        && deck.is_owner === false
        && deck.is_global_readonly === true
      ));
      const allCardsPresent = existingCards.every(card => (
        card
        && (card.standalone_local_edit || (!card.is_deleted && card.content_v2?.schema_version === nativeV2Version))
      ));
      const allCacheComplete = cacheMarkers.every(marker => marker?.complete === true);

      if (
        existingManifest
        && existingManifest.pack_id === resolvedPack.packId
        && existingManifest.pack_version >= resolvedPack.packVersion
        && existingManifest.card_set_fingerprint === resolvedPack.cardSetFingerprint
        && allDecksPresent
        && allCardsPresent
        && allCacheComplete
      ) {
        return {
          seeded: false,
          skipped: true,
          reason: 'already_seeded',
          manifest: existingManifest,
          insertedDecks: 0,
          insertedCards: 0,
          updatedCards: 0,
        };
      }

      const nowIso = new Date().toISOString();
      const nowMs = Date.now();
      let insertedDecks = 0;
      let insertedCards = 0;
      let updatedCards = 0;

      const decksToPut = [];
      const syncEntriesToPut = [];

      resolvedPack.decks.forEach((deckEntry, idx) => {
        const existing = existingDecks[idx];
        const metadata = buildDeckMetadata(deckEntry);
        if (!existing) {
          insertedDecks += 1;
          decksToPut.push({
            id: deckEntry.id,
            user_id: resolvedUserId,
            folder_id: null,
            name: deckEntry.document.deck.name,
            color: deckEntry.color,
            position: deckEntry.position,
            target_language: deckEntry.targetLanguage,
            role: 'viewer',
            is_owner: false,
            is_global_readonly: true,
            is_pinned: false,
            is_learning: false,
            is_deleted: 0,
            is_dirty: 0,
            metadata,
            created_at: nowIso,
            updated_at: nowIso,
          });
        } else {
          const needsDeckUpgrade = resolvedPack.packVersion > (existingManifest?.pack_version ?? 0)
            || existing.is_deleted
            || existing.name !== deckEntry.document.deck.name
            || existing.role !== 'viewer'
            || existing.is_owner !== false
            || existing.is_global_readonly !== true;
          if (needsDeckUpgrade) {
            decksToPut.push({
              ...existing,
              user_id: existing.user_id ?? resolvedUserId,
              name: deckEntry.document.deck.name,
              color: deckEntry.color,
              position: existing.position ?? deckEntry.position,
              target_language: deckEntry.targetLanguage,
              role: 'viewer',
              is_owner: false,
              is_global_readonly: true,
              is_learning: Boolean(existing.is_learning),
              is_deleted: 0,
              is_dirty: 0,
              metadata: { ...(existing.metadata || {}), ...metadata },
              updated_at: nowIso,
            });
          }
        }
        syncEntriesToPut.push({
          key: `deck-cards:${deckEntry.id}`,
          complete: true,
          fetched_at: nowMs,
        });
      });

      const cardsToPut = [];
      resolvedPack.cards.forEach((cardEntry, idx) => {
        const existing = existingCards[idx];
        const contentV2 = {
          schema_version: nativeV2Version,
          card: structuredClone(cardEntry.card),
        };
        const frontText = studySideText(cardEntry.card, 'front');
        if (!existing) {
          insertedCards += 1;
          cardsToPut.push({
            id: cardEntry.id,
            deck_id: cardEntry.deckId,
            position: cardEntry.position,
            target_language: cardEntry.targetLanguage,
            content_v2: contentV2,
            front_text: frontText,
            revision: resolvedPack.packVersion,
            standalone_card_key: cardEntry.cardKey,
            is_deleted: 0,
            is_dirty: 0,
            created_at: nowIso,
            updated_at: nowIso,
          });
        } else if (!existing.standalone_local_edit && (resolvedPack.packVersion > (existing.revision ?? 0) || existing.is_deleted)) {
          updatedCards += 1;
          cardsToPut.push({
            ...existing,
            deck_id: cardEntry.deckId,
            position: cardEntry.position,
            target_language: cardEntry.targetLanguage,
            content_v2: contentV2,
            front_text: frontText,
            revision: resolvedPack.packVersion,
            standalone_card_key: cardEntry.cardKey,
            is_deleted: 0,
            is_dirty: 0,
            updated_at: nowIso,
          });
        }
      });

      if (decksToPut.length > 0) {
        await database.decks.bulkPut(decksToPut);
      }
      if (cardsToPut.length > 0) {
        await database.cards.bulkPut(cardsToPut);
      }

      const manifest = {
        key: STANDALONE_SEED_MANIFEST_KEY,
        pack_id: resolvedPack.packId,
        pack_version: resolvedPack.packVersion,
        seeded_at: existingManifest?.seeded_at || nowIso,
        upgraded_at: existingManifest ? nowIso : null,
        deck_ids: resolvedPack.decks.map(d => d.id),
        card_ids: resolvedPack.cards.map(c => c.id),
        card_set_fingerprint: resolvedPack.cardSetFingerprint,
      };
      await database.syncState.bulkPut([...syncEntriesToPut, manifest]);

      return {
        seeded: true,
        skipped: false,
        upgraded: Boolean(existingManifest),
        insertedDecks,
        insertedCards,
        updatedCards,
        manifest,
      };
    });
  };

  if (!useDefaultFlight) {
    return run();
  }

  defaultSeedFlight = run().finally(() => {
    defaultSeedFlight = null;
  });
  return defaultSeedFlight;
}
