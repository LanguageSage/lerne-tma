import { networkApi } from './api.js';
import { getUserId } from '../utils/auth.js';
import { tr } from '../i18n/locale.js';

const active = new Map();

// Keep the operation before sending its first request: even a lost first
// response can be reconciled with the same server receipt after a reload.
export function reclassifyDeck(deck, { showToast, refresh }) {
  const userId = getUserId();
  const key = `lerne-classify:${userId}:${deck.id}:${deck.target_language || 'de'}`;
  if (active.has(key)) return active.get(key);
  const run = async () => {
    let pending;
    let completed = 0;
    let total = '?';
    let saved = false;
    const reload = async () => {
      try { await refresh?.(deck.id); return true; }
      catch { return false; }
    };
    try {
      pending = JSON.parse(localStorage.getItem(key) || 'null') || {
        operation_id: crypto.randomUUID(), batch_index: 0,
      };
      localStorage.setItem(key, JSON.stringify(pending));
      saved = true;
      showToast(tr('Обновление уровней колоды...'), 'info');
      while (true) {
        if (getUserId() !== userId) throw new Error('Account changed');
        const { data } = await networkApi.post('/cards/classify-batch', {
          deck_id: deck.id, target_language: deck.target_language || 'de', ...pending,
        }, { timeout: 35000 });
        if (getUserId() !== userId) return;
        if (!data || data.operation_id !== pending.operation_id ||
            !Number.isInteger(data.completed_count) || !Number.isInteger(data.total_count) ||
            data.completed_count < 0 || data.total_count < data.completed_count ||
            !Number.isInteger(data.next_batch) || data.next_batch < pending.batch_index) {
          throw new Error('Invalid classification progress');
        }
        completed = data.completed_count;
        total = data.total_count;
        if (data.status === 'ok' && data.complete === true && completed === total && data.remaining_count === 0) {
          localStorage.removeItem(key);
          if (await reload()) {
            showToast(tr('✨ Уровни карточек обновлены! ({{p0}} шт.)', { p0: completed }), 'success');
          } else {
            showToast(tr('Уровни обновлены. Не удалось загрузить список; обновите страницу.'), 'error');
          }
          return data;
        }
        const advanced = data.next_batch > pending.batch_index;
        if (advanced) {
          pending.batch_index = data.next_batch;
          localStorage.setItem(key, JSON.stringify(pending));
        }
        if (data.status !== 'more' || data.complete || !advanced || data.updated_count <= 0) {
          // No automatic retry of failed/unknown work, busy leases or AI errors.
          if (data.error_code === 'classification.attempt_limit') {
            showToast(tr('Достигнут лимит попыток. Подождите 5 минут и продолжите; прогресс сохранён.'), 'error');
          } else {
            showToast(tr('Обработано {{done}} из {{total}}. Повторите «Обновить CEFR-уровни», чтобы продолжить.', { done: completed, total }), 'error');
          }
          await reload();
          return data;
        }
        showToast(tr('Обработано {{done}} из {{total}}…', { done: completed, total }), 'info');
      }
    } catch (error) {
      if (getUserId() !== userId) return;
      showToast(saved
        ? tr('Переклассификация прервана. Прогресс сохранён; повторите «Обновить CEFR-уровни», чтобы продолжить.')
        : tr('Не удалось сохранить операцию в браузере. Переклассификация не запущена.'), 'error');
      // Reload committed partial work even when the last HTTP result is unknown.
      await reload();
      return { status: 'interrupted', error };
    }
  };
  const task = run().finally(() => active.delete(key));
  active.set(key, task);
  return task;
}
