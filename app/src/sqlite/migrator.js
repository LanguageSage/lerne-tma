import { SQLITE_SCHEMA_MANIFEST } from './schema.generated.js';

export class SqliteMigrationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SqliteMigrationError';
  }
}

export class SqliteIntegrityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SqliteIntegrityError';
  }
}

export function splitSqlStatements(sqlText) {
  const statements = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sqlText.length; i += 1) {
    const ch = sqlText[i];
    const next = sqlText[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === '-' && next === '-') {
        inLineComment = true;
        i += 1;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        i += 1;
        continue;
      }
    }

    current += ch;
    if (ch === "'" && !inDouble) {
      if (inSingle && next === "'") {
        current += next;
        i += 1;
      } else {
        inSingle = !inSingle;
      }
    } else if (ch === '"' && !inSingle) {
      if (inDouble && next === '"') {
        current += next;
        i += 1;
      } else {
        inDouble = !inDouble;
      }
    } else if (ch === ';' && !inSingle && !inDouble) {
      const trimmed = current.trim();
      if (trimmed && trimmed !== ';') {
        statements.push(trimmed);
      }
      current = '';
    }
  }

  const tail = current.trim();
  if (tail) {
    statements.push(tail);
  }
  return statements;
}

export async function verifyIntegrity(driver) {
  const integrityRows = await driver.query('PRAGMA integrity_check');
  const values = integrityRows.map(row => Object.values(row)[0]);
  if (values.length !== 1 || values[0] !== 'ok') {
    throw new SqliteIntegrityError(`SQLite integrity_check failed: ${JSON.stringify(values)}`);
  }
  const fkRows = await driver.query('PRAGMA foreign_key_check');
  if (fkRows.length > 0) {
    throw new SqliteIntegrityError(`SQLite foreign_key_check failed: ${JSON.stringify(fkRows.slice(0, 10))}`);
  }
  return { integrity: 'ok', foreignKeyViolations: 0 };
}

export async function getMigrationStatus(driver, manifest = SQLITE_SCHEMA_MANIFEST) {
  const tableRows = await driver.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
  );
  const applied = tableRows.length
    ? await driver.query('SELECT version, name, sha256, applied_at FROM schema_migrations ORDER BY version')
    : [];
  const appliedSet = new Set(applied.map(row => row.version));
  const pendingVersions = manifest.migrations
    .map(m => m.version)
    .filter(version => !appliedSet.has(version));
  return {
    schemaFormat: manifest.format,
    targetVersion: manifest.schema_version,
    currentVersion: applied.length ? applied[applied.length - 1].version : 0,
    applied,
    pendingVersions,
  };
}

export async function migrateSqlite(driver, { manifest = SQLITE_SCHEMA_MANIFEST, verify = true } = {}) {
  if (!manifest?.migrations?.length) {
    throw new SqliteMigrationError('Invalid SQLite schema manifest');
  }
  const byVersion = new Map(manifest.migrations.map(entry => [entry.version, entry]));
  const maxVersion = manifest.schema_version;

  await driver.execute('PRAGMA foreign_keys = ON');

  const appliedNow = await driver.transaction(async (tx) => {
    await tx.execute(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
        applied_at TEXT NOT NULL
      )`
    );

    const appliedRows = await tx.query(
      'SELECT version, name, sha256, applied_at FROM schema_migrations ORDER BY version'
    );
    const appliedVersions = new Set();
    for (const row of appliedRows) {
      const expected = byVersion.get(row.version);
      if (!expected) {
        throw new SqliteMigrationError(
          `Database contains unknown migration version ${row.version} (supported up to ${maxVersion})`
        );
      }
      if (row.name !== expected.name || row.sha256 !== expected.sha256) {
        throw new SqliteMigrationError(
          `Applied migration v${row.version} (${row.name}) checksum/name mismatch against manifest`
        );
      }
      appliedVersions.add(row.version);
    }

    const applied = [];
    const nowIso = new Date().toISOString();
    for (const entry of manifest.migrations) {
      if (appliedVersions.has(entry.version)) continue;
      for (const stmt of splitSqlStatements(entry.sql)) {
        await tx.execute(stmt);
      }
      await tx.run(
        'INSERT INTO schema_migrations (version, name, sha256, applied_at) VALUES (?, ?, ?, ?)',
        [entry.version, entry.name, entry.sha256, nowIso]
      );
      applied.push(entry.version);
    }

    await tx.execute(`PRAGMA user_version = ${Number(maxVersion)}`);
    return applied;
  });

  if (verify) {
    await verifyIntegrity(driver);
  }
  return {
    schemaVersion: maxVersion,
    appliedNow,
    totalApplied: manifest.migrations.length,
  };
}
