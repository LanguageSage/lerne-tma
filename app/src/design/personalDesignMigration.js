import { DEFAULT_DESIGN_SETTINGS, DESIGN_STORAGE_MAP, migrateLegacyDesignSettings } from './legacyAdapter.js';
import { normalizeDesignConfig } from './designConfig.js';
import { localStorageKey } from '../utils/localMode.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const read = key => localStorage.getItem(localStorageKey(key));
const write = (key, value) => {
  const raw = JSON.stringify(value);
  localStorage.setItem(localStorageKey(key), raw);
  if (read(key) !== raw) throw new Error('Design backup could not be verified');
};
const recordKey = owner => `lerne:personal-design:v2:${owner}`;
const CLAIM_KEY = 'lerne:design-v1-source';
const EXTRA_KEYS = ['lerne_user_design', 'lerne_design_version', 'lerne_settings_version',
  'lerne:admin-draft:v2', 'lerne:local-design-preview'];

export function isPersonalDesignDocument(doc) {
  return object(doc) && doc.schemaVersion === 2 && Number.isInteger(doc.revision) && doc.revision >= 0
    && object(doc.config) && (doc.preset === null || object(doc.preset));
}

export function legacyFromRaw(raw = {}) {
  const flat = {};
  for (const [key, storageKey] of Object.entries(DESIGN_STORAGE_MAP)) {
    if (raw[storageKey] == null) continue;
    const value = raw[storageKey];
    flat[key] = typeof DEFAULT_DESIGN_SETTINGS[key] === 'number' ? Number(value) : value;
  }
  if (raw.lerne_user_design != null) {
    try { flat.userDesign = JSON.parse(raw.lerne_user_design); } catch { /* raw backup retains invalid JSON */ }
  }
  return flat;
}

export function documentFromLegacy(flat) {
  return { schemaVersion: 2, revision: 0,
    config: migrateLegacyDesignSettings(flat),
    preset: object(flat?.userDesign) ? migrateLegacyDesignSettings(flat.userDesign) : null };
}

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

/** One atomic record contains source backup and target. Never remove the source keys.
 * The unscoped V1 source is claimed once, so a later login cannot inherit another account's design.
 */
export function openPersonalDesignRecord(owner) {
  if (owner == null) return null;
  const existing = readPersonalDesignRecord(owner);
  if (existing) return existing;
  let claim;
  const claimed = read(CLAIM_KEY);
  if (claimed) {
    claim = JSON.parse(claimed);
    if (!object(claim.raw) || typeof claim.owner !== 'string') throw new Error('Invalid design source backup');
  } else {
    const raw = Object.fromEntries([...Object.values(DESIGN_STORAGE_MAP), ...EXTRA_KEYS]
      .map(key => [key, read(key)]));
    claim = { owner: String(owner), raw };
    write(CLAIM_KEY, claim);
  }
  const local = claim.owner === String(owner) ? claim.raw : {};
  const document = documentFromLegacy(legacyFromRaw(local));
  return savePersonalDesignRecord({ version: 1, owner: String(owner), document,
    backups: { local }, pending: true, edited: false, serverSeen: false, base: structuredClone(document) });
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
    next.backups.server = structuredClone(settings);
    next.serverSeen = true;
    const target = remote ? structuredClone(remote) : documentFromLegacy({
      ...legacyFromRaw(next.backups.local), ...settings,
    });
    next.document = next.edited ? { ...target,
      config: mergeEdits(next.base.config, next.document.config, target.config),
      preset: mergeEdits(next.base.preset, next.document.preset, target.preset) } : target;
    next.pending = next.edited || !remote;
    next.base = structuredClone(target);
  } else if (remote) {
    const sameContent = equal(next.document.config, remote.config) && equal(next.document.preset, remote.preset);
    if (remote.revision < next.document.revision) {
      next.backups.serverRestores ??= [];
      next.backups.serverRestores.push({ settings: structuredClone(settings), document: next.document });
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
  } else if (next.document.revision === 0 && next.base?.revision === 0) {
    const target = documentFromLegacy({ ...legacyFromRaw(next.backups.local), ...settings });
    if (!equal(target, next.base)) {
      next.backups.serverUpdates ??= [];
      next.backups.serverUpdates.push({ settings: structuredClone(settings), document: next.document });
      next.document = next.edited ? { ...target,
        config: mergeEdits(next.base.config, next.document.config, target.config),
        preset: mergeEdits(next.base.preset, next.document.preset, target.preset) } : target;
      next.base = structuredClone(target);
    }
  } else if (next.document.revision > 0) {
    // Restoring a server snapshot from before migration must not strand a newer local design.
    next.backups.serverRestores ??= [];
    next.backups.serverRestores.push({ settings: structuredClone(settings), document: next.document });
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
