import { extractCardMediaRefs, extractDeckMediaRefs, extractInlineMediaRefs } from './mediaContract.js';

// Only Android-specific attributes absent from the shared schema live in app_state.
// The canonical columns own content, hierarchy, progress and media references.
const provenance = ['standalone_source_id', 'standalone_source_author', 'standalone_local_created',
  'standalone_local_edited_at', 'hard_deleted_locally'];
const origin = {
  standalone_origin_key: 'origin_key',
  standalone_local_edit: 'local_edited',
};
const source = { ...origin, standalone_source: 'source_key' };
const materialFlags = ['standalone_local_edit', 'is_global_readonly', 'is_builtin', 'is_pinned', 'is_learning', 'standalone_is_default'];
const materialDefaults = { position: 0, target_language: 'de', is_deleted: 0, standalone_local_edit: false };
const materialDates = ['created_at', 'updated_at'];
function withInlineMedia(refs, document) {
  const paths = new Set(refs.map(ref => ref.relPath));
  return [...refs, ...extractInlineMediaRefs(document).filter(ref => !paths.has(ref.relPath))];
}

function rows(table, key, fields, options = {}) {
  const names = fields.split(' ');
  return {
    table, key, ...options,
    fields: Object.fromEntries(names.map(name => [name, options.aliases?.[name] ?? name])),
    json: new Set(options.json),
    flags: new Set(options.flags),
  };
}

export const androidRows = {
  folders: rows('folders', ['id'],
    'id name parent_id color target_language position is_global_readonly is_deleted standalone_origin_key standalone_source_id standalone_local_edit created_at updated_at', {
      aliases: { ...origin, standalone_source_id: 'source_id', is_global_readonly: 'is_readonly' },
      flags: materialFlags, defaults: materialDefaults, dates: materialDates, owned: true,
      extra: [...provenance.filter(field => field !== 'standalone_source_id'), 'standalone_source', 'is_pinned', 'metadata'],
    }),
  decks: rows('decks', ['id'],
    'id folder_id standalone_deck_scope name level topic target_language color position standalone_is_default is_pinned is_learning is_builtin is_global_readonly is_deleted metadata standalone_origin_key standalone_source standalone_local_edit created_at updated_at', {
      aliases: { ...source, standalone_deck_scope: 'scope', standalone_is_default: 'is_default',
        is_global_readonly: 'is_readonly', metadata: 'metadata_json' },
      flags: materialFlags, defaults: { ...materialDefaults, standalone_deck_scope: 'personal', metadata: { resources: [] } },
      dates: materialDates, owned: true, json: ['metadata'],
      extra: [...provenance, 'standalone_deck_key', 'standalone_category_id', 'standalone_knowledge_version'],
      media: row => withInlineMedia(extractDeckMediaRefs(row.metadata), row.metadata),
    }),
  cards: rows('cards', ['id'],
    'id deck_id content_v2 front_text back_text image_path audio_path audio_back_path video_front_path video_back_path difficulty source position revision is_deleted standalone_origin_key standalone_source standalone_local_edit created_at updated_at', {
      aliases: { ...source, content_v2: 'content_v2_json', front_text: 'front_preview', back_text: 'back_preview' },
      flags: materialFlags, defaults: { position: 0, revision: 1, source: 'user', is_deleted: 0, standalone_local_edit: false,
        front_text: '', back_text: '' },
      dates: materialDates, json: ['content_v2'], extra: [...provenance, 'standalone_card_key', 'target_language'],
      media: row => withInlineMedia(extractCardMediaRefs(row, row.content_v2), row.content_v2),
    }),
  progress: rows('card_progress', ['card_id'],
    'card_id queue interval ease_factor repetitions lapses step_index next_review last_reviewed flag want_to_learn updated_at', {
      defaults: { queue: 'new', interval: 0, ease_factor: 2.5, repetitions: 0, lapses: 0,
        flag: 0, want_to_learn: false },
      flags: ['want_to_learn'], userKey: true, userScoped: true,
    }),
  card_notes: rows('card_notes', ['id'], 'id card_id text revision is_deleted created_at updated_at', {
    dates: materialDates, defaults: { revision: 1, is_deleted: 0 }, userScoped: true,
  }),
  knowledge_items: rows('knowledge_items', ['rule_code'],
    'rule_code language kind name revision parent_key prerequisite_keys cefr_level', {
      aliases: { prerequisite_keys: 'prerequisite_keys_json' }, json: ['prerequisite_keys'],
      defaults: { revision: 1, prerequisite_keys: [] }, dates: materialDates,
      virtual: { id: 'rule_code' },
    }),
  card_knowledge_items: rows('card_knowledge_items', ['card_id', 'knowledge_item_id'],
    'card_id knowledge_item_id role complexity ability example_key weight', { aliases: { knowledge_item_id: 'rule_code' } }),
  knowledge_attempt_outbox: rows('knowledge_attempts', ['client_event_id'],
    'client_event_id card_id knowledge_item_id event_time evaluation_data created_at review_id', {
      aliases: { knowledge_item_id: 'rule_code', evaluation_data: 'evaluation_data_json' },
      json: ['evaluation_data'], dates: ['created_at'], userScoped: true, event: true,
    }),
  user_knowledge_state: rows('user_knowledge_state', ['knowledge_item_id'],
    'knowledge_item_id attempts_count last_attempt_at calculation_version state_data positive_evidence negative_evidence evidence_mass proficiency confidence evidence_event_count objective_event_count self_rating_event_count last_evidence_at updated_at', {
      aliases: { knowledge_item_id: 'rule_code', state_data: 'state_data_json' },
      json: ['state_data'], userKey: true, userScoped: true,
    }),
  syncState: rows('app_state', ['key'], 'key value_json updated_at', { state: true }),
};

const eventFields = ['task_key', 'example_fingerprint', 'card_type', 'ability', 'example_key',
  'complexity', 'grade_fingerprint', 'grade_fingerprint_version'];
const pickDefined = (source, names) => Object.fromEntries(
  names.filter(name => source[name] !== undefined).map(name => [name, source[name]]),
);
export const extraKeyPrefix = spec => `android:${spec.table}:`;
export const extraRow = (spec, row) => pickDefined(row, spec.extra);

export function encodeAndroidRow(spec, row, now) {
  if (spec.state) {
    const { key, ...state } = row;
    return { key, value_json: JSON.stringify(state), updated_at: now };
  }
  const fields = { ...spec.fields };
  for (const timestamp of spec.dates ?? []) fields[timestamp] = timestamp;
  return Object.fromEntries(Object.entries(fields).flatMap(([name, column]) => {
    let value = row[name];
    if (name === 'rule_code') value ??= row.id;
    if (name === 'evaluation_data' && spec.event) {
      value = { ...value, ...pickDefined(row, eventFields) };
    }
    value ??= spec.defaults?.[name];
    if (spec.flags.has(name)) value ??= false;
    if (spec.dates?.includes(name) && !value) value = row.event_time || now;
    if (value === undefined && spec.table === 'user_knowledge_state') return [];
    if (value != null && spec.json.has(name)) value = JSON.stringify(value);
    if (value != null && (spec.flags.has(name) || typeof value === 'boolean')) value = Number(value);
    return [[column, value ?? null]];
  }));
}

export function decodeAndroidRow(spec, raw, userId) {
  if (spec.state) return { ...JSON.parse(raw.value_json), key: raw.key };
  const row = {};
  for (const [name, column] of Object.entries(spec.fields)) {
    const value = raw[column];
    row[name] = value == null ? value : spec.json.has(name) ? JSON.parse(value)
      : spec.flags.has(name) ? Boolean(value) : value;
  }
  if (spec.virtual?.id) row.id = row[spec.virtual.id];
  if (raw.android_extra) Object.assign(row, JSON.parse(raw.android_extra));
  if (spec.owned || spec.userScoped) row.user_id = spec.event ? String(userId) : userId;
  if (spec.owned) {
    const readonly = Boolean(row.is_global_readonly || row.is_builtin);
    row.role = readonly ? 'viewer' : 'owner';
    row.is_owner = !readonly;
    row.is_builtin ??= false;
    row.is_shared = false;
  }
  if (spec.owned || spec.userScoped || spec.table === 'cards') row.is_dirty = 0;
  if (spec.table === 'decks') row.learning_dirty = 0;
  if (spec.event) {
    const { evaluation_data, ...event } = row;
    if (evaluation_data?.evaluation_type === 'assessment') {
      return { ...event, evaluation_data, sync_status: 'pending', created_locally_at: raw.created_at, retry_count: 0 };
    }
    const evidence = { ...evaluation_data };
    for (const name of eventFields) delete evidence[name];
    return { ...pickDefined(event, ['client_event_id', 'card_id', 'knowledge_item_id', 'event_time', 'user_id']),
      ...pickDefined(evaluation_data, eventFields), sync_status: 'local', evaluation_data: evidence };
  }
  return row;
}
