let opening;

export function openAndroidDatabase() {
  opening ??= (async () => {
    const { createCapacitorSqliteDriver } = await import('./capacitorDriver.js');
    const { migrateSqlite } = await import('./migrator.js');
    const driver = createCapacitorSqliteDriver();
    await driver.open();
    try {
      await migrateSqlite(driver);
    } catch (error) {
      await driver.close().catch(() => {});
      throw error;
    }
    return driver;
  })().catch(error => {
    opening = undefined;
    throw error;
  });
  return opening;
}
