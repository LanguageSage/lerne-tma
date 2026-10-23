/* Managed transfer UI. No credentials, files, manifests or automatic write retries. */
const transferState = { selected: new Set(), page: 1, destinationPage: 1, job: null, busy: false, timer: null, initialized: false, loaded: false };
const transferEl = id => document.getElementById(`transfer-${id}`);
const transferLabels = { create: 'Создать', update: 'Заменить', unchanged: 'Без изменений', skip: 'Пропустить',
  copy: 'Добавить как новую', conflict: 'Конфликт версий', dependency: 'Сохранить родителя',
  folder: 'Папка', deck: 'Колода', card: 'Карточка' };
const transferStatuses = { preview: 'Предпросмотр', running: 'Выполняется', complete: 'Завершено',
  interrupted: 'Прервано — можно продолжить', stale: 'Нужен новый предпросмотр' };
const transferFields = { front_text: 'Лицевая сторона', back_text: 'Обратная сторона', context: 'Контекст',
  position: 'Порядок', is_deleted: 'В корзине', metadata: 'Метаданные и паспорт', parent_id: 'Родительская папка',
  folder_id: 'Папка', deck_id: 'Колода', name: 'Название', target_language: 'Язык', card_type: 'Тип карточки',
  tags: 'Метки', image_path: 'Изображение', audio_path: 'Аудио спереди', audio_back_path: 'Аудио сзади',
  level: 'Уровень', topic: 'Тема', topics: 'Темы', source: 'Источник', difficulty: 'Сложность' };
transferFields.access_scope = 'Доступ к оригиналу';

async function transferRequest(path, body) {
  const response = await fetch(`/api/admin/transfer${path}`, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : {});
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : JSON.stringify(result.detail));
  return result;
}

function transferMessage(message, error = false) {
  const el = transferEl('status');
  el.textContent = message;
  el.classList.toggle('text-red-300', error);
  if (error) el.scrollIntoView({ block: 'center' });
}
function transferControls() {
  transferEl('preview').disabled = transferState.busy || !transferState.selected.size;
  transferEl('apply').disabled = transferState.busy || !transferState.job?.can_apply
    || ['complete', 'stale'].includes(transferState.job?.status)
    || !transferEl('confirmed').checked || transferEl('confirmation').value !== transferState.job?.target;
  for (const el of transferEl('options').querySelectorAll('input,select')) el.disabled = transferState.busy;
  transferEl('load').disabled = transferState.busy;
  transferEl('more').disabled = transferState.busy;
  transferEl('destination-more').disabled = transferState.busy;
  transferEl('search').disabled = transferState.busy;
  transferEl('preview').textContent = transferState.busy ? 'Подождите, идёт обработка…' : '1. Проверить перед копированием';
  for (const el of transferEl('catalog').querySelectorAll('input')) el.disabled = transferState.busy;
}

function invalidateTransfer() {
  transferState.job = null;
  transferEl('preview-panel').classList.add('hidden');
  transferEl('confirmed').checked = false;
  transferEl('confirmation').value = '';
  transferControls();
}

async function loadTransferCatalog(append = false) {
  if (transferState.busy) return;
  transferState.busy = true; transferControls();
  transferMessage('Загрузка списка материалов…');
  if (!append) { transferState.page = 1; transferEl('catalog').replaceChildren(); }
  try {
    const params = new URLSearchParams({ direction: transferEl('direction').value, kind: transferEl('kind').value,
      page: String(transferState.page), search: transferEl('search').value });
    const [result] = await Promise.all([transferRequest(`/catalog?${params}`),
      append ? Promise.resolve() : loadTransferDestinations()]);
    for (const item of result.items) {
      const label = document.createElement('label');
      label.className = 'flex items-center gap-3 p-3 bg-slate-900 rounded-lg';
      const input = document.createElement('input'); input.type = 'checkbox'; input.value = item.id;
      input.checked = transferState.selected.has(item.id);
      input.addEventListener('change', () => {
        if (input.checked) transferState.selected.add(item.id); else transferState.selected.delete(item.id);
        transferEl('selection').textContent = `Выбрано: ${transferState.selected.size}`;
        invalidateTransfer();
      });
      label.append(input, document.createTextNode(`#${item.id} · ${item.name}`));
      transferEl('catalog').append(label);
    }
    transferEl('more').classList.toggle('hidden', !result.has_more);
    transferMessage(`Загружено материалов: ${result.items.length}. Отметьте нужные флажками. Списки хранятся в кеше до 5 минут.`);
    if (!result.items.length) transferMessage('Доступных материалов по этому запросу нет.');
    transferState.loaded = true;
  } catch (error) { transferMessage(error.message, true); }
  finally { transferState.busy = false; transferControls(); }
}

async function loadTransferDestinations(append = false) {
  if (!append) transferState.destinationPage = 1;
  const params = new URLSearchParams({ direction: transferEl('direction').value === 'publish' ? 'download' : 'publish',
    kind: 'folder', page: String(transferState.destinationPage) });
  const result = await transferRequest(`/catalog?${params}`);
  if (!append) transferEl('destination').replaceChildren(new Option('Корень библиотеки', ''));
  for (const folder of result.items) transferEl('destination').add(new Option(`#${folder.id} · ${folder.name}`, folder.id));
  transferEl('destination-more').classList.toggle('hidden', !result.has_more);
}

function renderTransferJob(job) {
  transferState.job = job;
  transferEl('preview-panel').classList.remove('hidden');
  transferEl('summary').textContent = Object.entries(job.counts).map(([k,v]) => `${transferLabels[k] || k}: ${v}`).join(' · ');
  transferEl('warning').textContent = `Цель: ${job.target} · ${job.environment}. `
    + (job.environment === 'production' && job.target.startsWith('Supabase:') ? 'Запись затронет рабочую базу. ' : '')
    + (!job.can_apply ? 'Запись отключена или есть конфликты. ' : '')
    + 'Удаления выполняются мягко. Личные копии и SRS не обновляются.';
  transferEl('diff').replaceChildren();
  for (const row of job.rows) {
    const details = document.createElement('details'); details.className = 'p-3 bg-slate-900 rounded-lg';
    const summary = document.createElement('summary');
    summary.textContent = `${transferLabels[row.kind]} #${row.source_id} → ${row.target_id || 'новый ID'} · ${transferLabels[row.action]} · ${row.after.name || row.after.front_text || ''}`;
    const pre = document.createElement('pre'); pre.className = 'text-sm whitespace-pre-wrap mt-3';
    pre.textContent = row.changed_fields.filter(field => row.before || row.after[field] != null).map(field =>
      `${transferFields[field] || field}\nБыло: ${row.before?.[field] ?? '—'}\nСтанет: ${row.after[field] ?? '—'}`).join('\n\n') || 'Содержание без изменений';
    details.append(summary, pre); transferEl('diff').append(details);
  }
  transferEl('media-list').textContent = `Медиа: ${job.media.length}. ` + job.media.map(m =>
    `${m.action === 'reuse' ? 'Переиспользовать' : 'Перенести'}: ${m.source} → ${m.path}`).join('\n');
  transferEl('confirmation').placeholder = job.target;
  transferEl('apply').textContent = job.target.startsWith('LOCAL:') ? '2. Начать копирование в LOCAL' : '2. Начать публикацию в Supabase';
  transferEl('progress').classList.toggle('hidden', job.status !== 'running');
  transferEl('progress').max = Math.max(job.total, 1); transferEl('progress').value = job.progress;
  if (job.status === 'complete') transferMessage(`Готово. Записано материалов: ${job.result?.applied || 0}. Повтор этой операции не создаёт копий.`);
  else if (job.error) transferMessage(`${job.error} ${job.status === 'stale' ? 'Нужен новый предпросмотр.' : 'Можно продолжить ту же операцию после устранения ошибки.'}`, true);
  transferControls();
}

async function waitTransferPreview(identifier) {
  const state = await transferRequest(`/previews/${identifier}`);
  if (state.status === 'error') throw new Error(state.error);
  if (state.status === 'ready') return transferRequest(`/jobs/${state.job_id}`);
  transferMessage(`Проверка структуры и подготовка медиа… Прошло ${state.elapsed} с. Повторно нажимать не нужно. Проверка состояния читает только LOCAL.`);
  await new Promise(resolve => setTimeout(resolve, 2000));
  return waitTransferPreview(identifier);
}

async function loadTransferJobs() {
  const result = await transferRequest('/jobs'); transferEl('jobs').replaceChildren();
  for (const item of result.items) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'block text-left p-2 bg-slate-800 rounded-lg w-full';
    button.textContent = `${new Date(item.created_at).toLocaleString('ru-RU')} · ${item.target} · ${transferStatuses[item.status] || item.status}`;
    button.addEventListener('click', async () => {
      if (transferState.busy) return;
      try {
        transferEl('confirmation').value = ''; transferEl('confirmed').checked = false;
        const job = await transferRequest(`/jobs/${item.id}`); renderTransferJob(job);
        if (job.status === 'running') pollTransfer(item.id);
      } catch (error) { transferMessage(error.message); }
    });
    transferEl('jobs').append(button);
  }
}

function pollTransfer(id) {
  clearTimeout(transferState.timer);
  transferState.busy = true; transferControls();
  transferState.timer = setTimeout(async () => {
    try {
      const job = await transferRequest(`/jobs/${id}`); renderTransferJob(job);
      if (job.status === 'running' || job.status === 'preview') pollTransfer(id);
      else { transferState.busy = false; transferControls(); await loadTransferJobs(); }
    } catch (error) {
      transferState.busy = false; transferControls(); transferMessage(error.message + ' Откройте сохранённую операцию для продолжения.');
    }
  }, 1500);
}

async function initTransfer() {
  if (!transferState.initialized) {
    transferState.initialized = true;
    for (const el of transferEl('options').querySelectorAll('input,select')) el.addEventListener('change', () => {
      invalidateTransfer();
      if (el.id === 'transfer-direction' || el.id === 'transfer-kind') {
        transferState.selected.clear(); transferEl('selection').textContent = 'Ничего не выбрано';
        transferEl('catalog').replaceChildren();
        transferEl('destination').replaceChildren(new Option('Корень библиотеки', ''));
      }
    });
    transferEl('load').addEventListener('click', () => loadTransferCatalog());
    transferEl('more').addEventListener('click', () => { transferState.page++; loadTransferCatalog(true); });
    transferEl('destination-more').addEventListener('click', async () => {
      if (transferState.busy) return;
      transferState.destinationPage++;
      try { await loadTransferDestinations(true); } catch (error) { transferMessage(error.message); }
    });
    transferEl('confirmed').addEventListener('change', transferControls);
    transferEl('confirmation').addEventListener('input', transferControls);
    transferEl('preview').addEventListener('click', async () => {
      if (transferState.busy) return;
      transferState.busy = true; transferControls(); transferMessage('Подготовка предпросмотра и необходимых медиа…');
      transferEl('status').scrollIntoView({ block: 'center' });
      try {
        const pending = await transferRequest('/preview', { direction: transferEl('direction').value,
          selection: { kind: transferEl('kind').value, ids: [...transferState.selected] },
          mode: transferEl('mode').value, media_mode: transferEl('media').value,
          on_conflict: transferEl('conflict').value, destination_folder_id: Number(transferEl('destination').value) || null,
          accept_conflicts: transferEl('accept').checked, public_original: transferEl('public').checked });
        const job = await waitTransferPreview(pending.id);
        transferEl('confirmed').checked = false; transferEl('confirmation').value = '';
        renderTransferJob(job); transferMessage('Проверка готова. Проверьте изменения и подтвердите цель, затем нажмите «Начать копирование».');
        transferEl('preview-panel').style.scrollMarginTop = `${(document.querySelector('body > header')?.offsetHeight || 0) + 16}px`;
        transferEl('preview-panel').scrollIntoView({ block: 'start' });
        await loadTransferJobs();
      } catch (error) { transferMessage(error.message, true); }
      finally { transferState.busy = false; transferControls(); }
    });
    transferEl('apply').addEventListener('click', async () => {
      const job = transferState.job;
      transferState.busy = true; transferControls(); transferMessage('Перенос выполняется. Состояние сохранено на сервере.');
      try {
        await transferRequest(`/jobs/${job.id}/apply`, { token: job.token, confirmation: transferEl('confirmation').value,
          confirmed: transferEl('confirmed').checked });
        pollTransfer(job.id);
      } catch (error) { transferState.busy = false; transferControls(); transferMessage(error.message); }
    });
    const selectedCard = Number(new URLSearchParams(location.search).get('publish_card'));
    if (Number.isSafeInteger(selectedCard) && selectedCard > 0) {
      transferEl('direction').value = 'publish'; transferEl('kind').value = 'card';
      transferState.selected.add(selectedCard); transferEl('selection').textContent = `Выбрана сохранённая карточка #${selectedCard}`;
    }
  }
  if (transferState.loaded || transferState.busy) return;
  try {
    const config = await transferRequest('/config');
    transferEl('config').textContent = config.enabled ? `Supabase: ${config.project_ref} · ${config.environment} · запись ${config.allow_cloud_write ? 'разрешена' : 'отключена'}` : config.message || 'Перенос отключён';
    if (config.enabled) {
      await loadTransferCatalog();
    } else {
      transferEl('catalog').textContent = 'Материалы Supabase пока недоступны: подключение не настроено. Создайте transfer.json рядом с config/local.json по инструкции docs/MATERIAL_TRANSFER.md, затем нажмите «Показать материалы».';
    }
    await loadTransferJobs();
  } catch (error) { transferEl('config').textContent = error.message; }
  transferControls();
}

document.addEventListener('DOMContentLoaded', () => {
  if (new URLSearchParams(location.search).has('publish_card')) switchTab('transfer');
});
