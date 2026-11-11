/** Keep recovery state in the account's existing Dexie; never discard a draft. */
import { tr } from '../i18n/locale.js';

export const isGenerationConflict = error => error?.response?.data?.detail?.code === 'database_generation_conflict';

export const generationError = state => Object.assign(new Error(
  tr('База данных восстановлена. Локальные данные сохранены; перед синхронизацией нужна сверка.')),
{ response: { status: 409, data: { detail: { code: 'database_generation_conflict', ...state } } } });

export async function observeServerGeneration(db, state, isCurrent) {
  if (!/^[a-f0-9]{64}$/.test(state?.server_generation || '')) throw new Error(tr('Не удалось проверить состояние синхронизации. Повторите попытку.'));
  // An already-used client without a generation must not adopt a restored server.
  const hasLocalData = state.restored && (await Promise.all(
    ['cards', 'progress', 'decks', 'folders', 'card_notes', 'knowledge_attempt_outbox']
      .filter(name => db[name]).map(name => db[name].count()))).some(Boolean);
  let blocked;
  await db.transaction('rw', db.syncState, async () => {
    if (!isCurrent()) throw new Error('Session changed');
    const previous = await db.syncState.get('serverGeneration');
    const conflict = await db.syncState.get('serverGenerationConflict');
    if (conflict || (previous && previous.generation !== state.server_generation) || (!previous && hasLocalData)) {
      blocked = { previous: previous?.generation, ...state };
      await db.syncState.put({ key: 'serverGenerationConflict', ...blocked });
    } else if (!previous) {
      await db.syncState.put({ key: 'serverGeneration', generation: state.server_generation });
    }
    if (!isCurrent()) throw new Error('Session changed');
  });
  if (blocked) throw generationError(blocked);
  return state.server_generation;
}
