import schema from './nativeV2Schema.generated.js';

const contentSchema = schema.properties.card;
export const nativeV2Version = schema.properties.schema_version.const;

const getDefinition = (root, ref) => root.$defs[ref.slice('#/$defs/'.length)];
export function nativeV2Field(type, field) {
  const card = getDefinition(schema, contentSchema.discriminator.mapping[type]);
  const data = getDefinition(schema, card.properties.data.$ref).properties[field];
  return data?.$ref ? { ...getDefinition(schema, data.$ref), ...data } : data;
}

export class NativeV2ValidationError extends Error {
  constructor(path, message) {
    super([path.join('.'), message].filter(Boolean).join(': '));
    this.path = path;
  }
}

const fail = (path, message) => { throw new NativeV2ValidationError(path, message); };
const at = (value, path) => path.reduce((subject, key) => subject[key], value);
const matches = (value, conditions = {}) => Object.entries(conditions)
  .every(([key, choices]) => choices.includes(value[key]));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const spaces = String.raw`[\p{White_Space}${'\u001c-\u001f'}]`;
const trim = value => value.replace(new RegExp(`^${spaces}+|${spaces}+$`, 'gu'), '');
const patterns = new Map();

function fitsLength(value, min = 0, max = Infinity) {
  if (value.length < min) return false;
  if (min <= 1 && value.length <= max) return true;
  let length = 0;
  for (let i = 0; i < value.length; length += 1) {
    if (length >= max) return false;
    i += value.codePointAt(i) > 0xffff ? 2 : 1;
  }
  return length >= min;
}

function jsonBytes(value, path, writable) {
  let adjustment = 0;
  const invalid = text => /[\ud800-\udfff]/u.test(text) || (writable && text.includes('\0'));
  const encoded = JSON.stringify(value, (key, item) => {
    if (invalid(key) || (typeof item === 'string' && invalid(item))) fail(path, 'Invalid Unicode text');
    if (typeof item === 'number' && item !== 0 && Math.abs(item) < 0.0001) {
      // Match Python JSON float spelling for numbers received from a JS JSON document.
      adjustment += item.toExponential().replace(/e-(\d)$/, 'e-0$1').length - String(item).length;
    }
    return item;
  });
  return new TextEncoder().encode(encoded).length + adjustment;
}

function applyRule(rule, value, path, mode) {
  const relative = rule.path ?? [];
  const subject = at(value, relative);
  const location = [...path, ...relative];
  let valid;
  switch (rule.kind) {
    case 'unique': {
      if (subject === null) return;
      const keys = rule.key ? subject.map(item => item[rule.key]) : subject;
      valid = new Set(keys).size === keys.length;
      break;
    }
    case 'count': {
      if (subject === null || !matches(value, rule.when)) return;
      const count = subject.filter(item => matches(item, rule.where)).length;
      valid = count >= (rule.min ?? 0) && count <= (rule.max ?? Infinity);
      break;
    }
    case 'references': {
      if (subject === null) return;
      const length = at(value, rule.target).length;
      const seen = new Set();
      subject.forEach((item, index) => {
        if (!matches(item, rule.where)) return;
        const ref = item[rule.key];
        const position = [...location, index, ...(rule.at ?? [rule.key])];
        if (!mode.draft && seen.has(ref)) fail(position, rule.duplicate ?? rule.message);
        if (ref < 0 || ref >= length) fail(position, rule.missing ?? rule.message);
        seen.add(ref);
      });
      valid = mode.draft || !rule.complete || seen.size === length;
      break;
    }
    case 'distinct_text': {
      const [left, right] = rule.fields.map(field => trim(at(value, field)));
      valid = left !== right;
      break;
    }
    case 'visible_text': {
      if (trim(subject)) return;
      const selection = rule.selection;
      const items = at(value, selection.path);
      const visible = items === null ? null : new Set(items
        .filter(item => matches(item, selection.where)).map(item => item[selection.key]));
      valid = at(value, rule.alternative).some((item, index) =>
        (visible === null || visible.has(index)) && matches(item, rule.where));
      break;
    }
    case 'reserved_keys':
      valid = !rule.keys.some(key => Object.hasOwn(subject, key));
      break;
    case 'json_bytes':
      valid = jsonBytes(subject, location, mode.writable) <= rule.max;
      break;
    default:
      throw new Error(`Unknown Native V2 rule: ${rule.kind}`);
  }
  if (!valid) fail(location, rule.message);
}

function validateJson(value, path) {
  if (Array.isArray(value)) value.forEach((item, index) => validateJson(item, [...path, index]));
  else if (object(value)) Object.entries(value).forEach(([key, item]) => validateJson(item, [...path, key]));
  else if (value !== null && !['boolean', 'string'].includes(typeof value) && !Number.isFinite(value)) {
    fail(path, 'Expected a finite JSON value');
  }
}

const types = {
  object, array: Array.isArray, string: value => typeof value === 'string',
  boolean: value => typeof value === 'boolean', null: value => value === null,
  number: Number.isFinite, integer: Number.isInteger,
};

// Execute the schema vocabulary emitted by card-core. Branch selection is also
// used for normalization, so defaults never leak from an unselected model.
function normalize(root, node, value, path, mode) {
  if (node.$ref) return normalize(root, getDefinition(root, node.$ref), value, path, mode);
  if (node.discriminator) {
    const { propertyName, mapping } = node.discriminator;
    const tag = value?.[propertyName];
    if (typeof tag !== 'string' || !Object.hasOwn(mapping, tag)) fail([...path, propertyName], 'Unknown type');
    return normalize(root, getDefinition(root, mapping[tag]), value, path, mode);
  }
  if (node.anyOf) {
    const selected = node.anyOf.find(branch => {
      const type = branch.$ref ? getDefinition(root, branch.$ref).type : branch.type;
      return types[type]?.(value);
    });
    if (!selected) fail(path, 'Unexpected value type');
    return normalize(root, selected, value, path, mode);
  }
  if (Object.hasOwn(node, 'const') && value !== node.const) fail(path, `Expected ${node.const}`);
  if (!mode.draft && node.enum && !node.enum.includes(value)) fail(path, `Expected one of ${node.enum.join(', ')}`);
  if (node.type && !types[node.type](value)) fail(path, `Expected ${node.type}`);

  let normalized = value;
  if (node.type === 'object') {
    const properties = node.properties ?? {};
    for (const key of node.required ?? []) {
      if (!Object.hasOwn(value, key) && !((mode.draft || mode.stored) && properties[key]?.['x-legacy-blank'])) {
        fail([...path, key], 'Required field');
      }
    }
    if (node['x-normalize-choice'] && Array.isArray(value.options)) {
      const [option] = value.options;
      if (value.options.length === 1 && object(option)) {
        value = { ...value, options: [{ correct: true, ...option }] };
      } else if (!mode.draft && value.distractors === 'auto') {
        fail([...path, 'options'], 'Legacy auto distractors require one option');
      }
    }
    const entries = Object.entries(value).map(([key, item]) => {
      const child = Object.hasOwn(properties, key) ? properties[key] : node.additionalProperties;
      if (child === false) {
        if (!mode.draft) fail([...path, key], 'Additional field');
        return [key, item];
      }
      return [key, normalize(root, child, item, [...path, key], mode)];
    });
    for (const [key, child] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) continue;
      if (Object.hasOwn(child, 'default')) entries.push([key, structuredClone(child.default)]);
      else if (mode.stored && child['x-legacy-blank']) entries.push([key, '']);
    }
    normalized = Object.fromEntries(entries);
    if (node['x-normalize-choice']) delete normalized.distractors;
  } else if (node.type === 'array') {
    if (!mode.draft && (value.length < (node.minItems ?? 0) || value.length > (node.maxItems ?? Infinity))) fail(path, 'Invalid item count');
    normalized = value.map((item, index) => normalize(root, node.items, item, [...path, index], mode));
  } else if (node.type === 'string' && !mode.draft
      && !(mode.stored && node['x-legacy-blank'] && !trim(value))) {
    if (!fitsLength(value, node.minLength, node.maxLength)) fail(path, 'Invalid text length');
    if (node.pattern) {
      if (!patterns.has(node.pattern)) patterns.set(node.pattern, new RegExp(node.pattern, 'u'));
      if (!patterns.get(node.pattern).test(value)) fail(path, 'Text does not match the required format');
    }
  } else if (!mode.draft && (node.type === 'integer' || node.type === 'number')) {
    if (value < (node.minimum ?? -Infinity) || value > (node.maximum ?? Infinity)) fail(path, 'Number out of range');
  } else if (!node.type && !mode.draft) {
    validateJson(value, path);
  }

  for (const rule of node['x-rules'] ?? []) {
    // The visual editor must be able to resolve indices in unfinished drafts.
    if (!mode.draft || rule.kind === 'references') applyRule(rule, normalized, path, mode);
  }
  return normalized;
}

// The normalized copy is for rule evaluation and parity tests. Write callers
// keep the submitted JSON, including omissions in historical drafts.
export function validateNativeV2Content(content, { writable = false, contract = schema } = {}) {
  return normalize(contract, contract, content, [], { writable });
}

export function validateReadableNativeV2(content) {
  normalize(schema, schema, content, [], { draft: true });
}

// Material archives restore already stored cards, including older Puzzle records.
export function validateStoredNativeV2Content(content) {
  return normalize(schema, schema, content, [], { stored: true, writable: true });
}
