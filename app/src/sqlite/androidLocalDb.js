import { openAndroidDatabase } from './androidDatabase.js';
import { androidRows, encodeAndroidRow, decodeAndroidRow, extraKeyPrefix, extraRow } from './androidRows.js';
import { isCanonicalMediaFilename } from './mediaContract.js';

const MAX_PARAMETERS = 900;
const placeholders = count => Array(count).fill('?').join(', ');
const whereSql = clauses => clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
const batches = function* (rows, size) {
  for (let i = 0; i < rows.length; i += size) yield rows.slice(i, i + size);
};

function bindTable(name, spec, userId, read, write) {
  const keys = spec.key.map(key => spec.fields[key]);
  const mediaOwner = name === 'cards' ? 'card' : 'deck';
  const toKey = row => spec.key.map(key => row[key]);
  const select = `SELECT a.*${spec.extra ? ', aux.value_json AS android_extra' : ''} FROM ${spec.table} AS a`
    + (spec.extra ? ` LEFT JOIN app_state AS aux ON aux.key = '${extraKeyPrefix(spec)}' || a.${keys[0]}` : '');
  const order = keys.map(key => `a.${key}`).join(', ');
  const publicKey = row => spec.userKey
    ? (spec.table === 'card_progress' ? [row.card_id, userId] : [userId, row.knowledge_item_id])
    : (keys.length === 1 ? row[spec.key[0]] : toKey(row));
  const sqlKey = key => {
    if (!spec.userKey) return Array.isArray(key) ? key : [key];
    if (!Array.isArray(key)) return [];
    const [id, owner] = spec.table === 'card_progress' ? key : [...key].reverse();
    return String(owner) === String(userId) ? [id] : [];
  };

  async function rowsByKeys(sql, input) {
    const requested = input.map(sqlKey);
    const valid = requested.filter(key => key.length === keys.length && key.every(value => value != null));
    const found = new Map();
    for (const batch of batches(valid, Math.floor(MAX_PARAMETERS / keys.length))) {
      const condition = batch.map(() => `(${keys.map(key => `a.${key} = ?`).join(' AND ')})`).join(' OR ');
      const predicate = keys.length === 1 ? `a.${keys[0]} IN (${placeholders(batch.length)})` : condition;
      for (const raw of await sql.query(`${select} WHERE ${predicate}`, batch.flat())) {
        const row = decodeAndroidRow(spec, raw, userId);
        found.set(JSON.stringify(toKey(row)), row);
      }
    }
    return requested.map(key => found.get(JSON.stringify(key)));
  }

  async function persist(sql, input, upsert) {
    if (!input.length) return;
    const now = new Date().toISOString();
    const rows = input.map(row => encodeAndroidRow(spec, row, now));
    const groups = new Map();
    for (const row of rows) {
      const columns = Object.keys(row).join(', ');
      if (!groups.has(columns)) groups.set(columns, []);
      groups.get(columns).push(Object.values(row));
    }
    for (const [columnList, values] of groups) {
      const columns = columnList.split(', ');
      const set = columns.filter(column => !keys.includes(column)).map(column => `${column} = excluded.${column}`);
      const conflict = !upsert ? '' : ` ON CONFLICT (${keys.join(', ')}) ${set.length ? `DO UPDATE SET ${set.join(', ')}` : 'DO NOTHING'}`;
      for (const batch of batches(values, Math.floor(MAX_PARAMETERS / columns.length))) {
        const tuples = batch.map(() => `(${placeholders(columns.length)})`).join(', ');
        await sql.run(`INSERT INTO ${spec.table} (${columnList}) VALUES ${tuples}${conflict}`, batch.flat());
      }
    }
    if (spec.extra) {
      const extras = input.map(row => [`${extraKeyPrefix(spec)}${row.id}`, extraRow(spec, row)]);
      for (const batch of batches(extras, Math.floor(MAX_PARAMETERS / 3))) {
        const values = batch.map(([key, value]) => [key, JSON.stringify(value), now]);
        await sql.run(`INSERT INTO app_state (key, value_json, updated_at)
          VALUES ${batch.map(() => '(?, ?, ?)').join(', ')}
          ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`, values.flat());
      }
    }
    if (spec.media) {
      await removeMediaLinks(sql, input.map(row => String(row.id)));
      const links = input.flatMap(row => spec.media(row).flatMap(({ slot, filename }) => {
        if (!isCanonicalMediaFilename(filename)) return [];
        const sha256 = filename.slice('archive_'.length, 'archive_'.length + 64);
        return [[mediaOwner, String(row.id), slot, sha256]];
      }));
      for (const batch of batches(links, Math.floor(MAX_PARAMETERS / 4))) {
        await sql.run(`INSERT OR IGNORE INTO media_links (owner_type, owner_id, slot, media_sha256)
          VALUES ${batch.map(() => '(?, ?, ?, ?)').join(', ')}`, batch.flat());
      }
    }
  }

  async function removeMediaLinks(sql, ids) {
    for (const batch of batches(ids, MAX_PARAMETERS - 1)) {
      await sql.run(`DELETE FROM media_links WHERE owner_type = ? AND owner_id IN (${placeholders(batch.length)})`,
        [mediaOwner, ...batch]);
    }
  }

  async function remove(sql, input) {
    const requested = input.map(sqlKey).filter(key => key.length === keys.length);
    for (const batch of batches(requested, Math.floor(MAX_PARAMETERS / keys.length))) {
      const condition = keys.length === 1 ? `${keys[0]} IN (${placeholders(batch.length)})`
        : batch.map(() => `(${keys.map(key => `${key} = ?`).join(' AND ')})`).join(' OR ');
      if (spec.media) {
        await removeMediaLinks(sql, batch.map(([id]) => String(id)));
      }
      if (spec.extra) {
        await sql.run(`DELETE FROM app_state WHERE key IN (${placeholders(batch.length)})`, batch.map(([id]) => `${extraKeyPrefix(spec)}${id}`));
      }
      await sql.run(`DELETE FROM ${spec.table} WHERE ${condition}`, batch.flat());
    }
  }

  function collection({
    clauses = [], values = [], matches = () => true, descending = false, limit = Infinity,
  } = {}) {
    const fetch = async (sql) => {
      const stateClause = spec.state ? ["a.key NOT GLOB 'android:*'"] : [];
      const rows = await sql.query(`${select}${whereSql([...stateClause, ...clauses])}
        ORDER BY ${descending ? keys.map(key => `a.${key} DESC`).join(', ') : order}`, values);
      return rows.map(row => decodeAndroidRow(spec, row, userId)).filter(matches).slice(0, limit);
    };
    const refine = predicate => collection({ clauses, values, matches: row => matches(row) && predicate(row), descending, limit });
    return {
      toArray: () => read(fetch),
      count: () => read(async sql => (await fetch(sql)).length),
      first: () => read(async sql => (await fetch(sql))[0]),
      primaryKeys: () => read(async sql => (await fetch(sql)).map(publicKey)),
      delete: () => write(async sql => {
        const matched = await fetch(sql);
        await remove(sql, matched.map(publicKey));
        return matched.length;
      }),
      filter: refine,
      and: refine,
      reverse: () => collection({ clauses, values, matches, descending: !descending, limit }),
      limit: count => collection({ clauses, values, matches, descending, limit: count }),
    };
  }

  return {
    name,
    async get(key) { return (await read(sql => rowsByKeys(sql, [key])))[0]; },
    bulkGet: input => read(sql => rowsByKeys(sql, input)),
    put: row => write(async sql => { await persist(sql, [row], true); return publicKey(row); }),
    add: row => write(async sql => { await persist(sql, [row], false); return publicKey(row); }),
    bulkPut: input => write(sql => persist(sql, input, true)),
    delete: key => write(sql => remove(sql, [key])),
    bulkDelete: input => write(sql => remove(sql, input)),
    update: (key, patch) => write(async sql => {
      const [row] = await rowsByKeys(sql, [key]);
      if (!row) return 0;
      await persist(sql, [{ ...row, ...patch }], true);
      return 1;
    }),
    toArray: () => collection().toArray(),
    count: () => collection().count(),
    filter: predicate => collection({ matches: predicate }),
    where(field) {
      const column = spec.fields[field === ':id' ? spec.key[0] : field] ?? spec.fields[spec.virtual?.[field]];
      const search = (clause, values, matches) => collection({
        clauses: clause ? [clause] : [], values, matches,
      });
      const col = column ? `a.${column}` : null;
      return {
        equals: value => col ? search(`${col} = ?`, [value]) : search(null, [], row => row[field] === value),
        anyOf: values => {
          if (!values.length) return search('0', []);
          if (col && values.length <= MAX_PARAMETERS) return search(`${col} IN (${placeholders(values.length)})`, values);
          const allowed = new Set(values);
          return search(null, [], row => allowed.has(row[field]));
        },
        startsWith: value => search(`${col} >= ? AND ${col} < ?`,
          [value, value.slice(0, -1) + String.fromCharCode(value.charCodeAt(value.length - 1) + 1)]),
        between: (lower, upper, includeLower = true, includeUpper = false) =>
          search(`${col} ${includeLower ? '>=' : '>'} ? AND ${col} ${includeUpper ? '<=' : '<'} ?`, [lower, upper]),
      };
    },
  };
}

export function createAndroidLocalDb(userId, open = openAndroidDatabase) {
  const noteListeners = new Set();
  let opened = false;
  const prepare = async () => { const sql = await open(); opened = true; return sql; };

  function bind(sql = null, writable = false, changes = null) {
    const database = { name: 'lerne_app', isAndroidSqlite: true, isOpen: () => opened, open: prepare, sqlite: sql };
    database.subscribeToNotes = notify => {
      noteListeners.add(notify);
      return () => noteListeners.delete(notify);
    };
    database.withTransaction = async (mode, work) => {
      if (sql) {
        if (mode === 'rw' && !writable) throw new Error('Cannot write inside a read transaction');
        return work(database);
      }
      const changed = new Set();
      const driver = await prepare();
      const result = await driver.transaction(tx => work(bind(tx, mode === 'rw', changed)));
      if (['card_notes', 'cards', 'decks', 'folders'].some(name => changed.has(name))) {
        for (const notify of noteListeners) notify();
      }
      return result;
    };
    for (const [name, spec] of Object.entries(androidRows)) {
      database[name] = bindTable(name, spec, userId,
        async work => work(sql || await prepare()),
        async work => {
          if (!sql) return database.withTransaction('rw', tx => tx.writeTable(name, work));
          return database.writeTable(name, work);
        });
    }
    if (sql) {
      database.writeTable = async (name, work) => {
        if (!writable) throw new Error('Cannot write inside a read transaction');
        const result = await work(sql);
        changes.add(name);
        return result;
      };
    }
    return database;
  }
  return bind();
}
