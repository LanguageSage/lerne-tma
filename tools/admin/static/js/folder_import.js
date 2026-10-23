/* Local folder importer. Files stay in the browser until explicitly selected.
 * Publication and permissions belong to the server; no storage credentials here.
 */
let folderImport = {
  files: new Map(), selected: new Set(), manifests: [], decisions: {}, mediaChoices: {},
  preview: null, requestId: null, busy: false, folders: [], target: 'current'
};

async function loadFolderImportTargets() {
  const response = await fetch('/api/admin/author/folder-import/targets');
  if (!response.ok) throw new Error('Не удалось узнать доступные базы.');
  const targets = await response.json();
  const select = document.getElementById('folder-import-database');
  select.replaceChildren(new Option(targets.current, 'current'));
  if (targets.cloud) {
    const option = new Option(targets.cloud_label + (targets.cloud_write ? '' : ' · запись отключена'), 'cloud');
    option.disabled = !targets.cloud_write;
    select.add(option);
  }
  if (targets.local) select.add(new Option('LOCAL', 'local'));
  document.getElementById('folder-import-database-help').textContent =
    targets.cloud && !targets.cloud_write ? 'Запись в Supabase отключена в серверной настройке.'
      : !targets.cloud && !targets.local ? 'Вторая база не подключена: нужна внешняя конфигурация переноса.' : '';
  if (!targets.cloud_write && folderImport.target === 'cloud') folderImport.target = 'current';
  select.value = folderImport.target;
  if (!select.value) folderImport.target = 'current';
  await loadFolderImportFolders();
}

async function loadFolderImportFolders(fresh = false) {
  if (folderImport.target !== 'current') {
    const response = await fetch(`/api/admin/author/folder-import/${folderImport.target}-folders`);
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Не удалось загрузить папки Supabase.');
    folderImport.folders = data;
  } else {
    folderImport.folders = !fresh && authorFoldersData.length
      ? authorFoldersData.slice() : await adminCatalog('/api/admin/folders', 'folders');
    if (fresh) authorFoldersData = folderImport.folders.slice();
  }
  renderFolderImportTarget();
}

function renderFolderImportTarget() {
  const root = document.getElementById('folder-import-target');
  const previous = document.getElementById('folder-import-folder-select')?.value;
  root.replaceChildren();
  const title = document.createElement('p');
  title.className = 'text-sm font-semibold text-white mb-2';
  title.textContent = 'Целевая папка в выбранной базе';
  root.append(title);
  const row = document.createElement('div');
  row.className = 'grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]';
  const select = document.createElement('select');
  select.id = 'folder-import-folder-select';
  select.className = 'min-w-0 w-full bg-slate-900 border border-slate-700 rounded-xl p-3';
  select.setAttribute('aria-label', 'Целевая папка в базе');
  select.add(new Option('Выберите существующую папку', ''));
  for (const folder of buildSortedFolderTree(folderImport.folders)) {
    select.add(new Option(folder.fullPath, String(folder.id)));
  }
  if (previous && folderImport.folders.some(folder => String(folder.id) === previous)) select.value = previous;
  select.addEventListener('change', invalidateFolderImport);
  row.append(select);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'px-3 py-3 bg-slate-800 rounded-xl text-sm';
  button.textContent = 'Создать новую папку';
  button.addEventListener('click', () => {
    const input = document.getElementById('folder-import-new-folder');
    input.classList.toggle('hidden');
    select.disabled = !input.classList.contains('hidden');
    button.textContent = select.disabled ? 'Выбрать существующую' : 'Создать новую папку';
    invalidateFolderImport();
    if (select.disabled) input.focus();
  });
  row.append(button);
  root.append(row);
  const input = document.createElement('input');
  input.id = 'folder-import-new-folder';
  input.placeholder = 'Название новой папки';
  input.className = 'hidden mt-2 w-full bg-slate-900 border border-slate-700 rounded-xl p-3';
  input.addEventListener('input', invalidateFolderImport);
  root.append(input);
}

async function changeFolderImportDatabase() {
  if (folderImport.busy) return;
  folderImport.target = document.getElementById('folder-import-database').value;
  invalidateFolderImport();
  setFolderImportBusy(true);
  document.getElementById('folder-import-preview-button').disabled = true;
  document.getElementById('folder-import-target').replaceChildren();
  folderImportStatus('Загрузка папок выбранной базы…');
  try {
    await loadFolderImportFolders();
    document.getElementById('folder-import-preview-button').disabled = false;
    folderImportStatus('Выберите целевую папку и проверьте колоды.');
  } catch (error) { folderImportStatus(error.message); }
  finally { setFolderImportBusy(false); }
}

function filterFolderImportList() {
  const query = document.getElementById('folder-import-search').value.trim().toLocaleLowerCase();
  document.querySelectorAll('#folder-import-list label[data-path]').forEach(label => {
    label.classList.toggle('hidden', !label.dataset.path.toLocaleLowerCase().includes(query));
  });
}

function updateFolderImportCount() {
  document.getElementById('folder-import-count').textContent =
    `Выбрано ${folderImport.selected.size} из ${document.querySelectorAll('#folder-import-list input').length} колод`;
}

function folderImportStatus(text) {
  document.getElementById('folder-import-status').textContent = text;
}

function invalidateFolderImport() {
  folderImport.preview = null;
  folderImport.requestId = null;
  document.getElementById('folder-import-apply-button').disabled = true;
  folderImportStatus('Параметры изменены. Проверьте выбранные колоды перед подтверждением.');
}

function folderImportRelative(path, relative) {
  if (typeof relative !== 'string' || !relative || /[\\:\0]/.test(relative) || relative.startsWith('/')) throw new Error('Неверная ссылка в манифесте');
  const parts = path.split('/').slice(0, -1);
  for (const part of relative.split('/')) {
    if (part === '..') {
      if (!parts.length) throw new Error('Ссылка выходит за пределы выбранной папки');
      parts.pop();
    } else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

async function selectFolderImport(input) {
  if (folderImport.busy || !input.files?.length) return;
  const incoming = Array.from(input.files);
  input.value = '';
  folderImport.files = new Map(incoming.map(file => [file.webkitRelativePath || file.name, file]));
  folderImport.selected.clear();
  folderImport.decisions = {};
  folderImport.mediaChoices = {};
  folderImport.manifests = [];
  document.getElementById('folder-import-apply-button').disabled = true;
  document.getElementById('folder-import-preview-button').disabled = true;
  folderImport.preview = null;
  folderImport.busy = true;
  input.disabled = true;
  folderImportStatus('Поиск файлов колод и манифестов…');
  try {
    const warnings = [];
    for (const [path, file] of folderImport.files) {
      if (file.name !== 'media_manifest.json') continue;
      try {
        if (file.size > 1024 * 1024) throw new Error('манифест больше 1 МБ');
        const manifest = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
        folderImport.manifests.push({ path, value: manifest, deck: folderImportRelative(path, manifest.deck_file) });
      } catch {
        warnings.push(`${path}: манифест не прочитан; связанные с ним медиа не будут импортированы. Исправьте файл и выберите папку заново.`);
      }
    }
    document.getElementById('folder-import-discovery-warnings').textContent = warnings.join('\n');
    const candidates = Array.from(folderImport.files.keys()).filter(path =>
      /\.(json|txt|md|text)$/i.test(path) && !path.endsWith('/media_manifest.json') && path !== 'media_manifest.json');
    const list = document.getElementById('folder-import-list');
    list.replaceChildren();
    candidates.sort((a, b) => a.localeCompare(b, 'ru'));
    for (const path of candidates) {
      const label = document.createElement('label');
      label.className = 'flex items-center gap-3 p-3 rounded-xl bg-slate-900 border border-slate-800 hover:border-indigo-500 text-sm cursor-pointer min-w-0';
      label.dataset.path = path;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.path = path;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) folderImport.selected.add(path);
        else folderImport.selected.delete(path);
        updateFolderImportCount();
        invalidateFolderImport();
      });
      const description = document.createElement('span');
      description.className = 'min-w-0 break-words';
      const name = document.createElement('strong');
      name.className = 'block text-white';
      name.textContent = path.split('/').at(-1);
      const location = document.createElement('small');
      location.className = 'block text-slate-400';
      location.textContent = path.split('/').slice(0, -1).join(' / ') || 'Корень';
      description.append(name, location);
      label.append(checkbox, description);
      list.append(label);
    }
    document.getElementById('folder-import-search').value = '';
    updateFolderImportCount();
    await loadFolderImportTargets();
    document.getElementById('folder-import-preview-button').disabled = false;
    document.getElementById('folder-import-workspace').classList.remove('hidden');
    document.getElementById('author-publish-dropzone-wrap').classList.add('hidden');
    document.getElementById('author-publish-result-wrap').classList.add('hidden');
    document.getElementById('folder-import-preview').replaceChildren();
    invalidateFolderImport();
    folderImportStatus(`Найдено файлов колод: ${candidates.length}. Выберите одну или несколько. На сервер пока ничего не передано.`);
  } catch (error) { folderImportStatus(error.message); }
  finally { folderImport.busy = false; input.disabled = false; }
}

function selectAllFolderImports(selected) {
  document.querySelectorAll('#folder-import-list input').forEach(input => {
    input.checked = selected;
    if (selected) folderImport.selected.add(input.dataset.path);
    else folderImport.selected.delete(input.dataset.path);
  });
  updateFolderImportCount();
  invalidateFolderImport();
}

function closeFolderImport() {
  if (folderImport.busy) return;
  folderImport.files.clear();
  folderImport.selected.clear();
  document.getElementById('folder-import-workspace').classList.add('hidden');
  document.getElementById('folder-import-input').value = '';
  folderImportStatus('');
  renderAuthorPublishState();
}

function folderImportPayload() {
  if (!folderImport.selected.size) throw new Error('Выберите хотя бы одну колоду.');
  const payload = {
    selected: Array.from(folderImport.selected), mode: document.getElementById('folder-import-mode').value,
    manifests: folderImport.manifests.filter(m => folderImport.selected.has(m.deck)).map(m => m.path),
    decisions: folderImport.decisions, media_choices: folderImport.mediaChoices
  };
  payload.target_db = folderImport.target;
  const newFolder = document.getElementById('folder-import-new-folder');
  if (!newFolder.classList.contains('hidden')) {
    payload.new_folder_name = newFolder.value.trim();
    if (!payload.new_folder_name) throw new Error('Введите название целевой папки.');
  } else {
    payload.target_folder_id = Number(document.getElementById('folder-import-folder-select').value);
    if (!payload.target_folder_id) throw new Error('Выберите целевую папку.');
  }
  return payload;
}

function folderImportForm(payload) {
  const paths = new Set([...payload.selected, ...payload.manifests]);
  for (const m of folderImport.manifests.filter(m => payload.manifests.includes(m.path))) {
    for (const binding of m.value.bindings || []) {
      for (const role of ['image', 'audio_front', 'audio_back']) {
        if (binding[role]) paths.add(folderImportRelative(m.path, binding[role]));
      }
    }
    for (const recording of m.value.study_audio || []) paths.add(folderImportRelative(m.path, recording.file));
  }
  if (paths.size > 500) throw new Error('За один импорт допускается до 500 файлов.');
  let total = 0;
  const form = new FormData();
  form.append('payload', JSON.stringify(payload));
  for (const path of paths) {
    const file = folderImport.files.get(path);
    if (!file) continue; // Missing files remain visible in the server preview.
    total += file.size;
    if (file.size > 20 * 1024 * 1024 || total > 100 * 1024 * 1024) throw new Error('Лимит: 20 МБ на файл, 100 МБ на выбранный пакет.');
    form.append('files', file, path);
  }
  return form;
}

function setFolderImportBusy(busy) {
  folderImport.busy = busy;
  document.getElementById('folder-import-controls').disabled = busy;
  document.getElementById('folder-import-input').disabled = busy;
}

async function sendFolderImport(action, payload) {
  const response = await fetch(`/api/admin/author/folder-import/${action}`, { method: 'POST', body: folderImportForm(payload) });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail));
  return data;
}

async function previewFolderImport() {
  if (folderImport.busy) return;
  try {
    const payload = folderImportPayload();
    setFolderImportBusy(true);
    invalidateFolderImport();
    folderImportStatus('Проверка выбранных карточек и медиа. Данные в базе не изменяются…');
    const plan = await sendFolderImport('preview', payload);
    folderImport.preview = { plan, payload: JSON.parse(JSON.stringify(payload)) };
    folderImport.requestId = crypto.randomUUID();
    renderFolderImportPreview(plan);
    document.getElementById('folder-import-apply-button').disabled = !plan.can_apply;
    folderImportStatus(plan.can_apply ? 'Предпросмотр готов. Проверьте связи и подтвердите импорт в указанную базу.' : 'Обнаружены ошибки или конфликты. Исправьте их и повторите проверку.');
  } catch (error) { folderImportStatus(error.message); }
  finally { setFolderImportBusy(false); }
}

function renderFolderImportPreview(plan) {
  const root = document.getElementById('folder-import-preview');
  root.replaceChildren();
  const summary = document.createElement('p');
  const duplicateCount = plan.assets.length - new Set(plan.assets.map(a => `${a.folder}/${a.sha256}`)).size;
  const database = document.getElementById('folder-import-database').selectedOptions[0].text;
  summary.textContent = `База: ${database}. Целевая папка: ${plan.folder_name}. Колоды: ${plan.groups.length}. Новые карточки: ${plan.created_cards}. Существующие: ${plan.existing_cards}. Изображения: ${plan.assets.filter(a => a.folder === 'images').length}. Аудио: ${plan.assets.filter(a => a.folder === 'audio').length}. Дубликаты файлов: ${duplicateCount}. Уже загружены: ${plan.assets.filter(a => a.reused).length}.`;
  root.append(summary);
  for (const problem of plan.problems) {
    const line = document.createElement('p');
    line.className = 'text-amber-300';
    line.textContent = problem;
    root.append(line);
  }
  for (const group of plan.groups) {
    const details = document.createElement('details');
    details.className = 'border border-slate-700 rounded-xl p-3 space-y-3';
    details.open = true;
    const heading = document.createElement('summary');
    heading.className = 'cursor-pointer font-semibold';
    heading.textContent = `${group.name} · ${group.rows.length} карточек · ${group.deck_id ? `существующая колода #${group.deck_id}` : 'создать колоду'}`;
    details.append(heading);
    for (const row of group.rows) {
      const line = document.createElement('div');
      line.className = 'space-y-2 border-t border-slate-800 pt-3';
      const text = document.createElement('p');
      text.textContent = `№${row.number}: ${row.front} → ${row.status === 'new' ? 'создать' : row.status === 'skip' ? 'пропустить' : row.card_id ? `карточка #${row.card_id}; текст сохранить` : 'нужно сопоставить'}`;
      line.append(text);
      if (['conflict', 'error', 'skip'].includes(row.status) || folderImport.decisions[row.key]) {
        const select = document.createElement('select');
        select.className = 'block w-full bg-slate-900 border border-slate-600 rounded-lg p-3';
        select.setAttribute('aria-label', `Сопоставление ${group.name}, карточка ${row.number}`);
        select.add(new Option('Выберите действие', ''));
        for (const candidate of group.candidates) select.add(new Option(`#${candidate.id}: ${candidate.front}`, String(candidate.id)));
        if (document.getElementById('folder-import-mode').value === 'import') select.add(new Option('Подтверждаю создание новой карточки', 'new'));
        select.add(new Option('Пропустить строку и её медиа', 'skip'));
        select.value = folderImport.decisions[row.key] || '';
        select.addEventListener('change', () => {
          if (select.value) folderImport.decisions[row.key] = select.value;
          else delete folderImport.decisions[row.key];
          invalidateFolderImport();
        });
        line.append(select);
      }
      for (const op of plan.operations.filter(op => op.card_key === row.key)) {
        const binding = document.createElement('p');
        const roles = { image: 'Изображение', audio_front: 'Озвучка лицевой стороны', audio_back: 'Озвучка обратной стороны' };
        const actions = { attach: 'добавить', keep: 'оставить', replace: 'заменить', skip: 'пропустить', unchanged: 'уже привязан', ask: 'выберите действие' };
        binding.textContent = `${roles[op.role]}: ${op.source} → ${actions[op.action]}${op.before ? ` (сейчас: ${op.before})` : ''}`;
        line.append(binding);
        if (op.before && op.before !== op.after) {
          const choice = document.createElement('select');
          choice.className = 'block w-full bg-slate-900 border border-slate-600 rounded-lg p-3';
          choice.setAttribute('aria-label', `Медиа ${group.name}, карточка ${row.number}, ${op.role}`);
          for (const [title, value] of [['Выберите действие с медиа', ''], ['Оставить существующий файл', 'keep'], ['Заменить', 'replace'], ['Пропустить', 'skip']]) choice.add(new Option(title, value));
          choice.value = folderImport.mediaChoices[op.key] || '';
          choice.addEventListener('change', () => {
            if (choice.value) folderImport.mediaChoices[op.key] = choice.value;
            else delete folderImport.mediaChoices[op.key];
            invalidateFolderImport();
          });
          line.append(choice);
        }
      }
      details.append(line);
    }
    root.append(details);
  }
  for (const audio of plan.resources) {
    const line = document.createElement('p');
    line.textContent = `Учебная аудиозапись «${audio.title}»: ${audio.source} → ресурсы колоды «${audio.deck_name}»`;
    root.append(line);
  }
}

async function applyFolderImport() {
  if (folderImport.busy || !folderImport.preview?.plan.can_apply) return;
  const saved = folderImport.preview;
  try {
    if (JSON.stringify(folderImportPayload()) !== JSON.stringify(saved.payload)) {
      invalidateFolderImport();
      return;
    }
    setFolderImportBusy(true);
    folderImportStatus('Импорт выбранных колод и медиа…');
    const result = await sendFolderImport('apply', { ...saved.payload, preview_token: saved.plan.preview_token,
      request_id: folderImport.requestId, confirmed: true });
    folderImport.preview = null;
    document.getElementById('folder-import-apply-button').disabled = true;
    const success = `Готово в ${document.getElementById('folder-import-database').selectedOptions[0].text}. Новых карточек: ${result.created_cards}, изменено медиа-ссылок: ${result.updated_media}. Авторство и прогресс сохранены.`;
    folderImportStatus(success);
    try { await loadFolderImportFolders(true); populateAuthorFolderSelects(); }
    catch { folderImportStatus(`${success} Список папок не обновился; нажмите обновление вверху.`); }
  } catch (error) {
    // Keep the exact request id for response-loss retries. No automatic retries.
    folderImportStatus(`${error.message} Можно повторить подтверждение; при устаревшем предпросмотре выполните проверку заново.`);
  } finally { setFolderImportBusy(false); }
}
