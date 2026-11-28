// SQLite passes a connection bound to the transaction. Dexie binds its
// transaction to the existing database through its own promise context.
export function localTransaction(database, mode, ...tablesAndWork) {
  const work = tablesAndWork.pop();
  return database.withTransaction
    ? database.withTransaction(mode, work)
    : database.transaction(mode, ...tablesAndWork, async () => work(database));
}
