import { CapacitorSQLite } from '@capacitor-community/sqlite';

/**
 * Thin driver adapter over @capacitor-community/sqlite opening an unencrypted
 * standard SQLite v3 database compatible with Python sqlite3.
 */
export function createCapacitorSqliteDriver({
  database = 'lerne_app',
  plugin = CapacitorSQLite,
  readonly = false,
} = {}) {
  let writeChain = Promise.resolve();
  let opened = false;

  const serialize = (task) => {
    const next = writeChain.then(task, task);
    writeChain = next.catch(() => {});
    return next;
  };

  const txHandle = {
    async execute(statements) {
      return plugin.execute({ database, statements, transaction: false });
    },
    async run(statement, values = []) {
      return plugin.run({ database, statement, values, transaction: false });
    },
    async query(statement, values = []) {
      const res = await plugin.query({ database, statement, values, readonly });
      return Array.isArray(res?.values) ? res.values : [];
    },
  };

  return {
    databaseName: database,

    async open() {
      if (opened) return;
      const connCheck = typeof plugin.isConnection === 'function'
        ? await plugin.isConnection({ database, readonly })
        : { result: false };
      if (!connCheck?.result) {
        await plugin.createConnection({
          database,
          version: 1,
          encrypted: false,
          mode: 'no-encryption',
          readonly,
        });
      }
      const openCheck = typeof plugin.isDBOpen === 'function'
        ? await plugin.isDBOpen({ database, readonly })
        : { result: false };
      if (!openCheck?.result) {
        await plugin.open({ database, readonly });
      }
      await plugin.execute({ database, statements: 'PRAGMA foreign_keys = ON;', transaction: false });
      if (!readonly) {
        await plugin.execute({ database, statements: 'PRAGMA journal_mode = WAL;', transaction: false });
      }
      opened = true;
    },

    async close() {
      if (!opened) return;
      try {
        await plugin.close({ database, readonly });
      } finally {
        await plugin.closeConnection({ database, readonly });
        opened = false;
      }
    },

    async isOpen() {
      const res = await plugin.isDBOpen({ database, readonly });
      return Boolean(res?.result);
    },

    async getUrl() {
      if (typeof plugin.getUrl === 'function') {
        const res = await plugin.getUrl({ database });
        return res?.url || null;
      }
      return null;
    },

    async execute(statements) {
      return serialize(() => txHandle.execute(statements));
    },

    async run(statement, values = []) {
      return serialize(() => txHandle.run(statement, values));
    },

    async query(statement, values = []) {
      return txHandle.query(statement, values);
    },

    async transaction(fn) {
      return serialize(async () => {
        await plugin.beginTransaction({ database });
        try {
          const result = await fn(txHandle);
          await plugin.commitTransaction({ database });
          return result;
        } catch (error) {
          try {
            await plugin.rollbackTransaction({ database });
          } catch {
            // Preserve original transaction failure.
          }
          throw error;
        }
      });
    },
  };
}
