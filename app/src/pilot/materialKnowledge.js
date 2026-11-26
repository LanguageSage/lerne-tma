import { isKnowledgeKey } from '../utils/knowledgeEvidence.js';
const KINDS = ['language', 'domain', 'topic', 'skill'];
const ABILITIES = ['theory', 'recognition', 'understanding', 'guided_application',
  'reproduction', 'application', 'retention'];
const itemFields = ['rule_code', 'language', 'kind', 'name', 'revision', 'parent_key', 'prerequisite_keys', 'cefr_level'];
const mappingFields = ['card_id', 'rule_code', 'role', 'complexity', 'ability', 'example_key'];

const validFields = (value, fields) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).every(key => fields.includes(key));
const label = (value, length) => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= length;
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const fail = message => { throw new Error(`Knowledge: ${message}`); };

function readItem(item) {
  if (!validFields(item, itemFields) || !isKnowledgeKey(item.rule_code)
    || item.language !== item.rule_code.split('.')[0] || !KINDS.includes(item.kind)
    || !label(item.name, 240) || !integer(item.revision, 1, Number.MAX_SAFE_INTEGER)
    || (item.parent_key != null && !isKnowledgeKey(item.parent_key))
    || (item.cefr_level != null && !/^[ABC][12]$/.test(item.cefr_level))) {
    fail('invalid item definition');
  }
  const prerequisites = item.prerequisite_keys ?? [];
  if (!Array.isArray(prerequisites) || prerequisites.some(key => !isKnowledgeKey(key))
    || new Set(prerequisites).size !== prerequisites.length) fail('invalid prerequisites');
  return {
    rule_code: item.rule_code, language: item.language, kind: item.kind, name: item.name,
    revision: item.revision, parent_key: item.parent_key ?? null,
    prerequisite_keys: [...prerequisites].sort(), cefr_level: item.cefr_level ?? null,
  };
}

function readLinks(rows, cardIds, language, items) {
  const links = new Map();
  for (const row of rows) {
    if (!validFields(row, mappingFields) || !cardIds.has(row.card_id)
      || items.get(row.rule_code)?.kind !== 'skill' || items.get(row.rule_code)?.language !== language
      || !['primary', 'secondary'].includes(row.role)
      || (row.complexity != null && !integer(row.complexity, 1, 5))
      || (row.ability != null && !ABILITIES.includes(row.ability))
      || (row.example_key != null && !label(row.example_key, 128))) fail('invalid card binding');
    const group = links.get(row.card_id) ?? [];
    if (group.some(link => link.rule_code === row.rule_code || (link.role === 'primary' && row.role === 'primary'))) {
      fail('duplicate card binding or multiple primary skills');
    }
    group.push({
      rule_code: row.rule_code, role: row.role, complexity: row.complexity ?? null,
      ability: row.ability ?? null, example_key: row.example_key ?? null,
    });
    links.set(row.card_id, group);
  }
  return links;
}

function validateGraph(items, references, name) {
  const incoming = new Map();
  const dependents = new Map();
  for (const [key, item] of items) {
    const refs = references(item);
    incoming.set(key, refs.length);
    for (const ref of refs) {
      const target = items.get(ref);
      if (!target || target.language !== item.language
        || (name === 'hierarchy' ? target.kind === 'skill' : target.kind !== 'skill' || item.kind !== 'skill')) {
        fail(`invalid ${name} reference: ${key} → ${ref}`);
      }
      const children = dependents.get(ref) ?? [];
      children.push(key);
      dependents.set(ref, children);
    }
  }
  const ready = [...incoming].filter(([, count]) => count === 0).map(([key]) => key);
  for (let i = 0; i < ready.length; i += 1) {
    for (const key of dependents.get(ready[i]) ?? []) {
      const count = incoming.get(key) - 1;
      incoming.set(key, count);
      if (count === 0) ready.push(key);
    }
  }
  if (ready.length !== items.size) fail(`cycle in ${name}`);
}

function validateCatalog(items) {
  validateGraph(items, item => item.parent_key ? [item.parent_key] : [], 'hierarchy');
  validateGraph(items, item => item.prerequisite_keys, 'prerequisites');
}

function mergeItem(items, next) {
  const current = items.get(next.rule_code);
  if (current && (current.kind !== next.kind
    || (current.revision === next.revision && JSON.stringify(current) !== JSON.stringify(next)))) {
    fail(`conflicting definition: ${next.rule_code}`);
  }
  if (!current || next.revision > current.revision) items.set(next.rule_code, next);
}

export function readMaterialKnowledge(content, metadataByDeck) {
  const sections = content.deck.filter(deck => Object.hasOwn(metadataByDeck.get(deck.id) ?? {}, 'knowledge'));
  if (!sections.length) return null;
  const cardsByDeck = new Map(sections.map(deck => [deck.id, new Set()]));
  for (const { id, values } of content.card) cardsByDeck.get(values.deck_id)?.add(id);

  const items = new Map();
  const linksByCard = new Map();
  for (const { id, values } of sections) {
    const section = metadataByDeck.get(id).knowledge;
    if (!validFields(section, ['version', 'items', 'mappings']) || section.version !== 1
      || !Array.isArray(section.items) || !Array.isArray(section.mappings)) fail('invalid material section');
    const definitions = new Map();
    const language = values.target_language || 'de';
    for (const raw of section.items) {
      const item = readItem(raw);
      if (item.language !== language || definitions.has(item.rule_code)) fail('duplicate item or language mismatch');
      definitions.set(item.rule_code, item);
      const previous = items.get(item.rule_code);
      if (previous && JSON.stringify(previous) !== JSON.stringify(item)) fail(`conflicting archive definition: ${item.rule_code}`);
      items.set(item.rule_code, item);
    }
    validateCatalog(definitions);
    const cardIds = cardsByDeck.get(id);
    const links = readLinks(section.mappings, cardIds, language, definitions);
    for (const cardId of cardIds) linksByCard.set(cardId, links.get(cardId) ?? []);
  }
  validateCatalog(items);
  return { items, linksByCard };
}

// Import and export share the existing material transaction and stable archive row IDs.
export async function applyMaterialKnowledge(database, knowledge, importedCards) {
  const catalog = new Map((await database.knowledge_items.toArray())
    .filter(item => typeof item.id === 'string' && item.id === item.rule_code)
    .map(({ id, ...item }) => [id, item]));
  const replacements = [];
  for (const item of knowledge.items.values()) {
    const previous = catalog.get(item.rule_code);
    mergeItem(catalog, item);
    if (catalog.get(item.rule_code) !== previous) replacements.push({ id: item.rule_code, ...item });
  }
  validateCatalog(catalog);
  if (replacements.length) await database.knowledge_items.bulkPut(replacements);
  const cardIds = [];
  const mappings = [];
  for (const [sourceId, localId] of importedCards) {
    const links = knowledge.linksByCard.get(sourceId);
    if (!links) continue;
    cardIds.push(localId);
    for (const { rule_code, ...link } of links) {
      mappings.push({ card_id: localId, knowledge_item_id: rule_code, ...link });
    }
  }
  if (cardIds.length) await database.card_knowledge_items.where('card_id').anyOf(cardIds).delete();
  if (mappings.length) await database.card_knowledge_items.bulkPut(mappings);
}

export function exportMaterialKnowledge(decks, cards, links, rows, exportId) {
  const cardsById = new Map(cards.map(card => [card.id, card]));
  const catalog = new Map(rows.map(({ id, ...item }) => [id, item]));
  const sections = new Map(decks.filter(deck => deck.standalone_knowledge_version === 1)
    .map(deck => [deck.id, { items: new Map(), mappings: [] }]));
  for (const { card_id, knowledge_item_id, role, complexity, ability, example_key } of links) {
    const card = cardsById.get(card_id);
    if (!card || !isKnowledgeKey(knowledge_item_id)) continue;
    if (!sections.has(card.deck_id)) sections.set(card.deck_id, { items: new Map(), mappings: [] });
    const section = sections.get(card.deck_id);
    section.mappings.push({ card_id: exportId(card), rule_code: knowledge_item_id, role, complexity, ability, example_key });
    const pending = [knowledge_item_id];
    while (pending.length) {
      const id = pending.pop();
      if (section.items.has(id)) continue;
      const item = catalog.get(id);
      if (!item) fail(`missing item: ${id}`);
      section.items.set(id, item);
      if (item.parent_key) pending.push(item.parent_key);
      pending.push(...item.prerequisite_keys);
    }
  }
  return new Map([...sections].map(([deckId, { items, mappings }]) => [
    deckId, { version: 1, items: [...items.values()], mappings },
  ]));
}
