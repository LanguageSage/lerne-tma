import { normalizeDesignConfig } from './designConfig.js';
import { localStorageKey } from '../utils/localMode.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const read = key => localStorage.getItem(localStorageKey(key));
const write = (key, value) => {
  const raw = JSON.stringify(value);
  localStorage.setItem(localStorageKey(key), raw);
  if (read(key) !== raw) throw new Error('Design record could not be verified');
};
const retiredStorageKeys = [
  'lerne_card_bg_front',
  'lerne_card_bg_back',
  'lerne_card_font',
  'lerne_card_text_color',
  'lerne_card_font_size',
  'lerne_card_text_align',
  'lerne_back_text_color',
  'lerne_context_font',
  'lerne_context_text_color',
  'lerne_context_font_size',
  'lerne_context_text_align',
  'lerne_card_text_shadow',
  'lerne_context_text_shadow',
  'lerne_card_font_weight',
  'lerne_card_font_style',
  'lerne_context_font_weight',
  'lerne_context_font_style',
  'lerne_preview_card_font',
  'lerne_preview_card_text_color',
  'lerne_preview_back_text_color',
  'lerne_preview_card_font_size',
  'lerne_preview_back_font_size',
  'lerne_preview_card_font_weight',
  'lerne_preview_card_font_style',
  'lerne_preview_text_shadow',
  'lerne_preview_card_text_align',
  'lerne_preview_card_lines',
  'lerne_preview_card_bg',
  'lerne_user_design',
  'lerne_design_version',
  'lerne_settings_version',
  'lerne:design-v1-source',
  'lerne_back_card_font',
  'lerne_back_card_font_size',
  'lerne_back_card_font_weight',
  'lerne_back_card_font_style',
  'lerne_back_card_text_shadow',
];
const discardRetiredStorage = () => {
  for (const key of retiredStorageKeys) localStorage.removeItem(localStorageKey(key));
};
const recordKey = owner => `lerne:personal-design:v2:${owner}`;
export function isPersonalDesignDocument(doc) {
  return object(doc) && doc.schemaVersion === 2 && Number.isInteger(doc.revision) && doc.revision >= 0
    && object(doc.config) && (doc.preset === null || object(doc.preset));
}

const emptyDocument = () => ({ schemaVersion: 2, revision: 0,
  config: normalizeDesignConfig(null), preset: null });

export function readPersonalDesignRecord(owner) {
  const raw = read(recordKey(owner));
  if (!raw) return null;
  const record = JSON.parse(raw);
  if (record.version !== 1 || record.owner !== String(owner) || !isPersonalDesignDocument(record.document)
      || !object(record.backups)) throw new Error('Invalid personal design record; original retained');
  return record;
}

export function savePersonalDesignRecord(record) {
  write(recordKey(record.owner), record);
  return record;
}

/** New accounts start directly in V2; V1 sources are never read. */
export function openPersonalDesignRecord(owner) {
  if (owner == null) return null;
  const existing = readPersonalDesignRecord(owner);
  if (existing) {
    const { local, server, serverUpdates, ...backups } = existing.backups;
    const hadRestoreSources = backups.serverRestores?.some(item => Object.hasOwn(item, 'settings'));
    if (hadRestoreSources) backups.serverRestores = backups.serverRestores.map(({ document }) => ({ document }));
    if (local !== undefined || server !== undefined || serverUpdates !== undefined || hadRestoreSources) {
      existing.backups = backups;
      savePersonalDesignRecord(existing);
    }
    discardRetiredStorage();
    return existing;
  }
  const document = emptyDocument();
  const record = savePersonalDesignRecord({ version: 1, owner: String(owner), document,
    backups: {}, pending: true, edited: false, serverSeen: false, base: structuredClone(document) });
  discardRetiredStorage();
  return record;
}

/** Rebase only local edits onto a newer server revision. Remote and original local
 * documents are retained for recovery, including same-field offline conflicts.
 */
function mergeEdits(base, local, remote) {
  if (equal(base, local)) return structuredClone(remote);
  if (object(base) && object(local) && object(remote)) {
    const result = structuredClone(remote);
    for (const key of Object.keys(local)) result[key] = mergeEdits(base[key], local[key], remote[key]);
    return result;
  }
  return structuredClone(local);
}

export function reconcilePersonalDesign(record, settings) {
  if (!object(settings)) throw new Error('Invalid settings response');
  if (settings.designV2 !== undefined && !isPersonalDesignDocument(settings.designV2)) {
    throw new Error('Unsupported personal design document; original retained');
  }
  const next = structuredClone(record);
  const remote = settings.designV2;
  if (!next.serverSeen) {
    next.serverSeen = true;
    const target = remote ? structuredClone(remote) : emptyDocument();
    next.document = next.edited ? { ...target,
      config: mergeEdits(next.base.config, next.document.config, target.config),
      preset: mergeEdits(next.base.preset, next.document.preset, target.preset) } : target;
    next.pending = next.edited || !remote;
    next.base = structuredClone(target);
  } else if (remote) {
    const sameContent = equal(next.document.config, remote.config) && equal(next.document.preset, remote.preset);
    if (remote.revision < next.document.revision) {
      next.backups.serverRestores ??= [];
      next.backups.serverRestores.push({ document: next.document });
      next.document = { ...next.document, revision: remote.revision };
      next.pending = true;
    } else if (!next.pending || sameContent || !next.edited && remote.revision > next.document.revision) {
      next.document = structuredClone(remote);
      next.pending = false;
    } else if (next.document.revision !== remote.revision) {
      next.backups.conflicts ??= [];
      next.backups.conflicts.push({ local: next.document, remote: structuredClone(remote) });
      next.document = next.base
        ? { ...remote, config: mergeEdits(next.base.config, next.document.config, remote.config),
          preset: mergeEdits(next.base.preset, next.document.preset, remote.preset) }
        : { ...next.document, revision: remote.revision };
    }
  } else if (next.document.revision > 0) {
    // Restoring a server snapshot from before migration must not strand a newer local design.
    next.backups.serverRestores ??= [];
    next.backups.serverRestores.push({ document: next.document });
    next.document = { ...next.document, revision: 0 };
    next.pending = true;
  }
  if (remote) next.base = structuredClone(remote);
  return next;
}

export function editPersonalDesign(record, config, preset = record.document.preset) {
  return { ...record, pending: true, edited: true, document: { ...record.document,
    config: normalizeDesignConfig(config), preset: preset === null ? null : normalizeDesignConfig(preset) } };
}

export function acknowledgePersonalDesign(record, sent, remote) {
  if (!isPersonalDesignDocument(remote)) throw new Error('Server did not confirm personal design');
  if (!equal(sent.config, remote.config) || !equal(sent.preset, remote.preset)) {
    throw new Error('Server confirmed a different personal design');
  }
  if (record.document.revision > remote.revision) return record;
  const next = structuredClone(record);
  // An edit made during the POST remains pending at the newly acknowledged revision.
  next.pending = !equal(next.document, sent);
  next.edited = next.pending;
  next.document = next.pending ? { ...next.document, revision: remote.revision } : structuredClone(remote);
  next.base = structuredClone(remote);
  return next;
}

/** Existing product precedence: preview > published > personal. Empty V2 backgrounds
 * inherit personal backgrounds rather than erasing them during normalization.
 */
export function resolveActiveDesign(state) {
  const personal = state.personalDesignV2?.config;
  const source = state.isLocalDesignPreviewActive && state.adminDraftDesignV2
    ? state.adminDraftDesignV2 : state.publishedDesignV2?.config || personal;
  const config = normalizeDesignConfig(source);
  for (const side of ['front', 'back']) {
    if (!config[side].card.background && personal?.[side]?.card?.background) {
      config[side].card.background = personal[side].card.background;
    }
  }
  return config;
}
