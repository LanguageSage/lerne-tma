import { cardDuplicateKey } from '../utils/search.js';
import { isKnowledgeKeyForLanguage, isPortableKnowledgeAttempt } from '../utils/knowledgeEvidence.js';
import { getCardKnowledgeMappings } from './knowledgeDbService.js';
import { projectKnowledgeMastery } from '../utils/knowledgeMastery.js';
import { isDeckActiveInCache, loadFolderMap } from './cardOfflineQueue.js';

const LOCAL = 'local';
export function portableLocalAttempt(row) {
  const { user_id: _user, card_id: _card, sync_status: _status, ...event } = row;
  return event;
}

export async function resolveStudyKnowledgeAttempt(database, cardId, language, observe) {
  const mappings = await getCardKnowledgeMappings(cardId, database);
  const primary = mappings.find(link => link.role === 'primary' && isKnowledgeKeyForLanguage(link.knowledge_item_id, language));
  if (!primary) return null;
  const observation = observe();
  if (!observation) return null;
  return bindKnowledgeObservation(observation, primary);
}

function bindKnowledgeObservation(observation, primary) {
  return {
    ...observation,
    knowledge_item_id: primary.knowledge_item_id,
    complexity: primary.complexity ?? null,
    ability: primary.ability ?? null,
    example_key: primary.example_key ?? null,
  };
}

/** The caller's Dexie transaction owns the commit for Study and other sources. */
export async function writeLocalKnowledgeAttempt(database, userId, cardId, event) {
  if (userId == null || !isPortableKnowledgeAttempt(event)) throw new Error('Invalid local knowledge attempt');
  const existing = await database.knowledge_attempt_outbox.get(event.client_event_id);
  if (existing) {
    if (existing.sync_status !== LOCAL || existing.user_id !== String(userId)
      || cardDuplicateKey(portableLocalAttempt(existing)) !== cardDuplicateKey(event)) {
      throw new Error('Knowledge action already used with different data');
    }
    if (existing.card_id == null && cardId != null) {
      await database.knowledge_attempt_outbox.update(event.client_event_id, { card_id: cardId });
    }
    return false;
  }
  await database.knowledge_attempt_outbox.add({ ...event, card_id: cardId ?? null, user_id: String(userId), sync_status: LOCAL });
  return true;
}

export function readLocalKnowledgeAttempts(database, userId) {
  return database.knowledge_attempt_outbox.where('user_id').equals(String(userId))
    .filter(event => event.sync_status === LOCAL).toArray();
}

export function pendingKnowledgeReceipts(database) {
  return database.syncState.where('key').startsWith('grade:').filter(receipt => receipt.knowledge_pending).toArray();
}

/** Historical bindings are trusted point-in-time records keyed by action ID. */
export async function recoverLocalKnowledgeAttempts(database, userId, historicalBindings = new Map()) {
  const receipts = await pendingKnowledgeReceipts(database);
  let remaining = 0;
  for (const { key: receiptKey, knowledge_pending: pending } of receipts) {
    const historical = historicalBindings.get(pending.observation?.client_event_id);
    if (!pending.event && !historical) {
      remaining += 1;
      continue;
    }
    try {
      await database.transaction('rw', database.syncState,
        database.knowledge_attempt_outbox, async () => {
          const receipt = await database.syncState.get(receiptKey);
          if (!receipt?.knowledge_pending) return;
          const { knowledge_pending: pending, ...resolved } = receipt;
          const { card_id: cardId, observation } = pending;
          let event = pending.event;
          if (!event) {
            if (!historical || historical.role !== 'primary' || historical.card_id !== cardId
              || historical.task_key !== observation.task_key || historical.example_fingerprint !== observation.example_fingerprint
              || (pending.language && !isKnowledgeKeyForLanguage(historical.knowledge_item_id, pending.language))) {
              throw new Error('Historical Knowledge binding does not match the observation');
            }
            event = bindKnowledgeObservation(observation, historical);
          }
          await writeLocalKnowledgeAttempt(database, userId, cardId, event);
          await database.syncState.put(resolved);
        });
    } catch (error) {
      remaining += 1;
      console.error('[Knowledge] Local grade evidence still pending', receiptKey, error);
    }
  }
  return remaining;
}

export async function readLocalKnowledgeProfile(database, userId, now = new Date()) {
  return database.transaction('r', database.knowledge_items, database.knowledge_attempt_outbox, database.syncState,
    database.card_knowledge_items, database.cards, database.decks, database.folders, async () => {
      const [catalog, attempts, pending] = await Promise.all([
        database.knowledge_items.toArray(), readLocalKnowledgeAttempts(database, userId), pendingKnowledgeReceipts(database),
      ]);
      const profile = projectKnowledgeMastery({ skills: catalog, attempts, now });
      const byKey = new Map(profile.skills.map(skill => [skill.skill_key, skill]));
      const weak = profile.skills.flatMap(skill => skill.dimensions.filter(dimension => dimension.status === 'weak')
        .map(dimension => ({ skill, dimension })));
      const materials = new Map();
      if (weak.length) {
        const mappings = await database.card_knowledge_items.where('knowledge_item_id')
          .anyOf([...new Set(weak.map(({ skill }) => skill.skill_key))]).toArray();
        const cardIds = [...new Set(mappings.map(link => link.card_id))];
        const rows = await database.cards.bulkGet(cardIds);
        const cards = new Map(rows.filter(card => card && !card.is_deleted).map(card => [card.id, card]));
        const [deckRows, folders] = await Promise.all([
          database.decks.bulkGet([...new Set([...cards.values()].map(card => card.deck_id))]),
          loadFolderMap(database),
        ]);
        const decks = new Map(deckRows.filter(deck => deck && isDeckActiveInCache(deck, folders)).map(deck => [deck.id, deck]));
        for (const link of mappings) {
          const card = cards.get(link.card_id);
          const deck = decks.get(card?.deck_id);
          if (!deck) continue;
          const group = materials.get(link.knowledge_item_id) ?? [];
          group.push({ card_id: card.id, deck_id: deck.id, deck_name: deck.name, role: link.role, ability: link.ability });
          materials.set(link.knowledge_item_id, group);
        }
      }
      const rawById = new Map(attempts.map(row => [row.client_event_id, row]));
      return {
        ...profile,
        catalog: catalog.filter(item => item.id === item.rule_code),
        pending_attempts: pending.length,
        unresolved_attempts: pending.filter(row => !row.knowledge_pending.event).map(({ knowledge_pending: { observation } }) => ({
          event_id: observation.client_event_id, task_key: observation.task_key,
          checked_at: observation.event_time, reason: 'historical_binding_required',
        })),
        weaknesses: weak.map(({ skill, dimension }) => ({
          skill_key: skill.skill_key, name: skill.name, ability: dimension.ability, confidence: dimension.confidence,
          last_checked_at: dimension.last_checked_at,
          evidence: dimension.evidence.filter(item => item.error).map(item => {
            const raw = rawById.get(item.event_id);
            return { ...item, card_id: raw.card_id, evaluation_data: raw.evaluation_data };
          }),
          prerequisites_to_check: skill.prerequisite_keys.map(key => {
            const prerequisite = byKey.get(key);
            return { skill_key: key, name: prerequisite?.name ?? key,
              status: prerequisite?.dimensions.find(item => item.ability === dimension.ability)?.status ?? 'not_checked' };
          }).filter(item => item.status !== 'mastered'),
          related_materials: materials.get(skill.skill_key) ?? [],
        })),
      };
    });
}
