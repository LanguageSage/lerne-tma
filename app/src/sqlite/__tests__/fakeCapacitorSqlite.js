import { DatabaseSync } from 'node:sqlite';

export function createTestSqlitePlugin() {
  const database = new DatabaseSync(':memory:');
  let connected = false;
  let opened = false;
  const plugin = {
    async createConnection({ database: name }) {
      if (connected) throw new Error(`CreateConnection: Connection ${name} already exists`);
      connected = true;
    },
    async isDBOpen() { return { result: opened }; },
    async open() { opened = true; },
    async close() { opened = false; },
    async closeConnection() { connected = false; },
    async execute({ statements }) { database.exec(statements); },
    async run({ statement, values }) { return database.prepare(statement).run(...values); },
    async query({ statement, values }) { return { values: database.prepare(statement).all(...values) }; },
    async beginTransaction() { database.exec('BEGIN IMMEDIATE'); },
    async commitTransaction() { database.exec('COMMIT'); },
    async rollbackTransaction() { database.exec('ROLLBACK'); },
  };
  return { database, plugin };
}
