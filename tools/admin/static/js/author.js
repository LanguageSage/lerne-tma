/**
 * author.js — Lerne TMA Admin Module: «Автор уроков» (Lesson Author)
 * 
 * Предоставляет режимы работы автора уроков:
 * 1. Публикация (Drag&Drop .json/.txt/.md -> /parse -> preview -> выбор папки -> /publish)
 * 2. Экспорт (Колода / Папка -> /export -> скачивание .txt)
 * 3. Обновление (Файл -> /update-preview -> diff было/стало -> /update-apply)
 * 4. JSON V2: изолированный предварительный просмотр без сохранения.
 * 
 * Вся бизнес-логика выполняется на backend в /api/admin/author/*
 */

// Global State for Author Module
// V2 results deliberately never enter publish/update state.
async function previewAuthorV2(input) {
  const file = input.files?.[0];
  if (!file || input.disabled) return;
  const status = document.getElementById('author-v2-status');
  const result = document.getElementById('author-v2-result');
  result.replaceChildren();
  input.disabled = true;
  status.textContent = `Проверка: ${file.name}…`;
  result.setAttribute('aria-busy', 'true');
  try {
    if (!file.name.toLowerCase().endsWith('.json')) throw new Error('Выберите файл .json.');
    if (file.size > 10 * 1024 * 1024) throw new Error('Размер файла превышает 10 МБ.');
    const form = new FormData();
    form.append('file', file);
    const response = await fetch('/api/admin/author/v2-preview', { method: 'POST', body: form });
    const preview = await response.json();
    if (!response.ok) throw new Error(typeof preview.detail === 'string' ? preview.detail : 'Не удалось проверить файл.');
    if (!preview.valid) {
      status.textContent = `${file.name}: ошибки валидации (${preview.errors.length}).`;
      result.innerHTML = `<div role="alert" class="p-4 rounded-xl border border-rose-500/30 text-rose-200">
        <h4 class="font-bold">Ошибки V2</h4><ul class="space-y-3 mt-3">${preview.errors.map(error => `<li>
        <b>${error.card_number ? `Карточка №${error.card_number}` : 'Документ / колода'}</b> ·
        <code>${escapeHtml(error.path)}</code><br>${escapeHtml(error.message)}
        ${error.line ? ` (строка ${error.line}, столбец ${error.column})` : ''}</li>`).join('')}</ul></div>`;
      return;
    }
    status.textContent = `${file.name}: V2 валиден. Карточек: ${preview.total_cards}.`;
    renderAuthorV2(preview, result);
  } catch (error) {
    status.textContent = `Ошибка: ${error.message}. Можно выбрать файл повторно.`;
  } finally {
    input.disabled = false;
    input.value = '';
    result.removeAttribute('aria-busy');
  }
}

function authorV2Field(label, value) {
  if (value === undefined || value === null || value === '') return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return `<div class="mt-3"><h5 class="text-xs font-bold text-slate-400">${escapeHtml(label)}</h5>
    <pre class="mt-1 text-sm text-slate-200">${escapeHtml(text)}</pre></div>`;
}

function authorV2Options(options) {
  return `<ul class="space-y-1 mt-2">${options.map((option, index) => `<li class="text-sm text-slate-200">
    ${index + 1}. ${escapeHtml(option.text)}${option.correct ? ' <strong class="text-emerald-300">✓ Правильный ответ</strong>' : ''}</li>`).join('')}</ul>`;
}

function renderAuthorV2Card(card) {
  const data = card.data;
  let html = card.info.map(block => authorV2Field(
    { task: 'Задание', source: 'Исходный текст', example: 'Пример', options: 'Доступные варианты (информация)' }[block.type],
    block.type === 'options' ? block.items.join('\n') : block.text)).join('');
  switch (card.type) {
    case 'theory':
      html += authorV2Field('Содержание', data.text) + authorV2Field('Краткий итог', data.summary);
      break;
    case 'standard':
      html += authorV2Field('Задание', data.prompt) + authorV2Field('Правильный ответ', data.answer);
      break;
    case 'quiz':
      html += authorV2Field('Задание', data.prompt) + authorV2Options(data.options);
      break;
    case 'trainer':
    case 'word_bank':
      if (card.type === 'word_bank') html += authorV2Field('Банк слов (номера вариантов с 1)', data.options.map((text, i) => `${i + 1}. ${text}`).join('\n'));
      html += authorV2Field('Содержание', data.parts.map(part => part.type === 'text' ? part.text : '［…］').join(''));
      data.parts.forEach((part, index) => {
        if (part.type === 'input') html += authorV2Field(`Часть ${index + 1} · правильные ответы (альтернативы)`, part.answers.join('\n'));
        if (part.type === 'choice') html += authorV2Field(`Часть ${index + 1} · варианты`, 'Выбор ответа') + authorV2Options(part.options);
        if (part.type === 'gap') html += authorV2Field(`Часть ${index + 1} · правильный ответ`, `${data.options[part.option]} (вариант №${part.option + 1})`);
      });
      break;
    case 'match':
      html += authorV2Field('Правильные пары', data.pairs.map(pair => `${pair.left} → ${pair.right}`).join('\n'));
      break;
    case 'puzzle':
      html += authorV2Field('Правильный порядок фрагментов', data.tokens.map((token, i) => `${i + 1}. ${token}`).join('\n'))
        + authorV2Field('Перевод', data.translation);
      break;
    case 'free_text':
      html += authorV2Field('Задание', data.prompt) + authorV2Field('Пример ответа (не точный ключ)', data.sample_answer)
        + authorV2Field('Допустимые ответы', data.accepted_answers.join('\n')) + authorV2Field('Политика проверки', data.grading_policy);
      break;
  }
  return html + authorV2Field('Объяснение после ответа', card.explanation)
    + authorV2Field('Связанное изображение', card.image)
    + authorV2Field('Уровень карточки (если указан)', card.level) + authorV2Field('Темы карточки (если указаны)', card.topics);
}

function renderAuthorV2(preview, container) {
  const doc = preview.document;
  container.innerHTML = `<div class="glass p-5 rounded-2xl">
    <h3 class="text-lg font-bold text-white">${escapeHtml(doc.deck.name)}</h3>
    <p class="text-sm text-slate-300 mt-2">Карточек: ${preview.total_cards} · ${Object.entries(preview.types).map(([type, count]) => `${escapeHtml(type)}: ${count}`).join(' · ')}</p>
    ${authorV2Field('Паспорт колоды V2', doc.deck.passport || 'Паспорт не указан')}
    ${authorV2Field('Метаданные колоды V2', doc.deck.metadata)}</div>
    ${doc.cards.map((card, index) => {
      const projection = preview.legacy_projections[index];
      let legacy;
      if (projection.status === 'converted') {
        legacy = `<details class="mt-4 border-t border-slate-700 pt-2"><summary class="cursor-pointer text-sm text-slate-300">Временная legacy-проекция · только просмотр</summary>
          ${authorV2Field('Производные поля legacy', projection.card)}</details>`;
      } else {
        legacy = `<p class="mt-4 text-sm text-amber-200">V2-карточка валидна, но legacy не может безопасно представить её содержимое: ${escapeHtml(projection.message)}</p>`;
      }
      return `<article class="glass p-5 rounded-2xl" data-v2-card="${index}">
        <h4 class="text-base font-bold text-white">Карточка №${index + 1} · ${escapeHtml(card.type)}${card.id ? ` · ${escapeHtml(card.id)}` : ''}</h4>
        <p class="text-xs text-indigo-300 mt-1">Данные V2</p>${renderAuthorV2Card(card)}${legacy}
        <details class="mt-3"><summary class="cursor-pointer text-sm text-slate-400">Полные данные карточки V2</summary>${authorV2Field('V2', card)}</details>
      </article>`;
    }).join('')}`;
}

let authorState = {
  activeSubtab: 'publish', // 'publish' | 'export' | 'update' | 'v2'

  // Mode 1: Publish
  publish: {
    files: [],
    file: null,
    text: '',
    parseResult: null,
    targetFolderId: null,
    isNewFolder: false,
    newFolderName: '',
    isLoading: false,
    error: null,
    success: null
  },

  // Mode 2: Export
  export: {
    mode: 'deck', // 'deck' | 'folder'
    selectedDeckId: null,
    selectedFolderId: null,
    isLoading: false
  },

  // Mode 3: Update
  update: {
    files: [],
    file: null,
    text: '',
    previewResult: null,
    includeNew: false,
    isLoading: false,
    error: null,
    success: null
  }
};
let authorImageUrls = [];
let authorFoldersData = [];
let authorDecksData = [];


// ============================================================================
// Initialization & Tab Navigation
// ============================================================================

async function initAuthorTab() {
  await refreshAuthorCatalogs(false);

  // Populate dropdowns for export and publish
  populateAuthorFolderSelects();
  populateAuthorDeckSelects();

  // Render active subtab
  switchAuthorSubtab(authorState.activeSubtab);
}

async function refreshAuthorCatalogs(notify = true) {
  try {
    authorFoldersData = await adminCatalog('/api/admin/folders', 'folders');
    authorDecksData = await adminCatalog('/api/admin/decks', 'decks');
    populateAuthorFolderSelects();
    populateAuthorDeckSelects();
    if (notify) showToast('Списки папок и колод обновлены', 'info');
  } catch (error) {
    if (notify) showToast(`Не удалось обновить списки: ${error.message}`, 'error');
    throw error;
  }
}

function switchAuthorSubtab(subtab) {
  authorState.activeSubtab = subtab;

  ['publish', 'export', 'update', 'v2'].forEach(s => {
    const btn = document.getElementById(`author-subtab-${s}`);
    const panel = document.getElementById(`author-panel-${s}`);
    if (btn) {
      if (s === subtab) {
        btn.className = 'px-3 py-1.5 text-xs font-bold rounded-xl transition bg-indigo-600 text-white shadow-md shadow-indigo-500/20 flex items-center gap-1.5';
      } else {
        btn.className = 'px-3 py-1.5 text-xs font-medium rounded-xl transition text-slate-400 hover:text-white flex items-center gap-1.5';
      }
    }
    if (panel) {
      if (s === subtab) panel.classList.remove('hidden');
      else panel.classList.add('hidden');
    }
  });

  if (subtab === 'export') {
    onAuthorExportModeChange(authorState.export.mode);
  }

  if (window.lucide && typeof lucide.createIcons === 'function') {
    lucide.createIcons();
  }
}

/**
 * Builds a hierarchical list of folders preserving parent-child relationships,
 * identical to Lerne TMA's getSortedFolderTree.
 */
function buildSortedFolderTree(foldersList = []) {
  if (!foldersList || foldersList.length === 0) return [];
  const map = new Map();
  foldersList.forEach(f => map.set(f.id, f));

  // Determine root folders: parent_id is null/undefined or points to missing parent in list
  const roots = [];
  foldersList.forEach(f => {
    if (!f.parent_id || !map.has(f.parent_id)) {
      roots.push(f);
    }
  });

  // Sort roots alphabetically
  roots.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const result = [];
  const visited = new Set();

  function traverse(folder, depth, parentBreadcrumb = '') {
    if (visited.has(folder.id)) return;
    visited.add(folder.id);

    const fullPath = parentBreadcrumb ? `${parentBreadcrumb} / ${folder.name}` : folder.name;
    const prefix = depth === 0 ? '' : `${'\u00A0'.repeat((depth - 1) * 3 + 2)}↳ `;

    result.push({
      ...folder,
      depth: depth,
      fullPath: fullPath,
      treeName: `${prefix}${folder.name}`
    });

    // Children sorted alphabetically
    const children = foldersList
      .filter(f => f.parent_id === folder.id && !visited.has(f.id))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    children.forEach(child => traverse(child, depth + 1, fullPath));
  }

  roots.forEach(root => traverse(root, 0, ''));

  // Fallback for any unvisited folders
  foldersList.forEach(f => {
    if (!visited.has(f.id)) {
      result.push({
        ...f,
        depth: 0,
        fullPath: f.name,
        treeName: f.name
      });
    }
  });

  return result;
}

function populateAuthorFolderSelects() {
  const pubSelect = document.getElementById('author-publish-folder-select');
  const expSelect = document.getElementById('author-export-folder-select');

  const treeFolders = buildSortedFolderTree(authorFoldersData);

  if (pubSelect) {
    const currentVal = pubSelect.value;
    pubSelect.innerHTML = '<option value="">-- Выберите существующую папку --</option>';
    treeFolders.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      const count = f.deck_count !== undefined ? f.deck_count : (f.decks_count || (f.decks ? f.decks.length : 0));
      opt.textContent = `${f.treeName} (ID: ${f.id}, колод: ${count})`;
      opt.title = f.fullPath;
      pubSelect.appendChild(opt);
    });
    if (currentVal && treeFolders.some(f => String(f.id) === String(currentVal))) {
      pubSelect.value = currentVal;
    } else if (treeFolders.length > 0) {
      pubSelect.value = treeFolders[0].id;
      authorState.publish.targetFolderId = treeFolders[0].id;
    }
    updateAuthorPublishFolderPath();
  }

  if (expSelect) {
    const currentExpVal = expSelect.value;
    expSelect.innerHTML = '<option value="">-- Выберите папку для экспорта --</option>';
    treeFolders.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = `${f.treeName} (ID: ${f.id})`;
      opt.title = f.fullPath;
      expSelect.appendChild(opt);
    });
    if (currentExpVal && treeFolders.some(f => String(f.id) === String(currentExpVal))) {
      expSelect.value = currentExpVal;
    } else if (treeFolders.length > 0) {
      expSelect.value = treeFolders[0].id;
      authorState.export.selectedFolderId = treeFolders[0].id;
    }
    updateAuthorExportFolderStats();
  }
}

function populateAuthorDeckSelects() {
  const expDeckSelect = document.getElementById('author-export-deck-select');
  if (!expDeckSelect) return;

  const decks = authorDecksData.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const currentVal = expDeckSelect.value;

  expDeckSelect.innerHTML = '<option value="">-- Выберите колоду для экспорта --</option>';
  decks.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    const folderLabel = d.folder_name ? ` [${d.folder_name}]` : '';
    opt.textContent = `${d.name}${folderLabel} (ID: ${d.id}, ${d.card_count || 0} к.)`;
    expDeckSelect.appendChild(opt);
  });

  if (currentVal && decks.some(d => String(d.id) === String(currentVal))) {
    expDeckSelect.value = currentVal;
  } else if (decks.length > 0) {
    expDeckSelect.value = decks[0].id;
    authorState.export.selectedDeckId = decks[0].id;
  }
  updateAuthorExportDeckStats();
}


// ============================================================================
// MODE 1: PUBLISH (Публикация)
// ============================================================================

function handleAuthorPublishDragOver(event) {
  event.preventDefault();
  event.stopPropagation();
  const box = document.getElementById('author-publish-dropzone');
  if (box) box.classList.add('border-indigo-500', 'bg-indigo-950/30');
}

function handleAuthorPublishDragLeave(event) {
  event.preventDefault();
  event.stopPropagation();
  const box = document.getElementById('author-publish-dropzone');
  if (box) box.classList.remove('border-indigo-500', 'bg-indigo-950/30');
}

function handleAuthorPublishDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  const box = document.getElementById('author-publish-dropzone');
  if (box) box.classList.remove('border-indigo-500', 'bg-indigo-950/30');

  const files = event.dataTransfer && event.dataTransfer.files;
  if (files && files.length > 0) {
    handleAuthorPublishFiles(Array.from(files));
  }
}

function handleAuthorPublishFileSelect(input) {
  if (input.files && input.files.length > 0) {
    handleAuthorPublishFiles(Array.from(input.files));
  }
}

async function handleAuthorPublishFiles(files) {
  if (!files || files.length === 0) return;
  authorState.publish.files = files;
  authorState.publish.file = files[0];
  authorState.publish.text = '';
  await runAuthorParse({ files });
}

async function handleAuthorPublishFile(file) {
  await handleAuthorPublishFiles(file ? [file] : []);
}

function toggleAuthorManualTextInput() {
  const container = document.getElementById('author-publish-manual-text-container');
  if (!container) return;
  container.classList.toggle('hidden');
}

async function handleAuthorManualTextSubmit() {
  const textarea = document.getElementById('author-publish-manual-text');
  const text = textarea ? textarea.value.trim() : '';
  if (!text) {
    showToast('Введите текст разметки урока', 'error');
    return;
  }
  authorState.publish.files = [];
  authorState.publish.file = null;
  authorState.publish.text = text;
  await runAuthorParse({ text });
}

async function runAuthorParse({ files, file, text }) {
  authorImageUrls.forEach(URL.revokeObjectURL);
  authorImageUrls = [];
  authorState.publish.isLoading = true;
  authorState.publish.error = null;
  authorState.publish.success = null;
  authorState.publish.parseResult = null;
  invalidateAuthorPassportPreview();
  renderAuthorPublishState();

  try {
    let res;
    const fileList = files || (file ? [file] : null);
    if (fileList && fileList.length > 0) {
      const formData = new FormData();
      fileList.forEach(f => formData.append('files', f));
      res = await fetch('/api/admin/author/parse', {
        method: 'POST',
        body: formData
      });
    } else {
      res = await fetch('/api/admin/author/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || `Ошибка анализа файла (HTTP ${res.status})`);
    }

    authorState.publish.parseResult = data;
    authorState.publish.isLoading = false;
    renderAuthorPublishState();
    const filesCountText = (fileList && fileList.length > 1) ? ` из ${fileList.length} файлов` : '';
    showToast(`Успешно разобрано: ${data.total_cards} карточек в ${data.decks_count} колодах${filesCountText}`, 'success');
  } catch (err) {
    authorState.publish.isLoading = false;
    authorState.publish.error = err.message || 'Ошибка соединения с сервером';
    renderAuthorPublishState();
    showToast(authorState.publish.error, 'error');
  }
}

function toggleAuthorNewFolderInput(isNew) {
  invalidateAuthorPassportPreview();
  authorState.publish.isNewFolder = isNew;
  const existingWrap = document.getElementById('author-publish-folder-existing-wrap');
  const newWrap = document.getElementById('author-publish-folder-new-wrap');

  if (isNew) {
    if (existingWrap) existingWrap.classList.add('hidden');
    if (newWrap) newWrap.classList.remove('hidden');
  } else {
    if (existingWrap) existingWrap.classList.remove('hidden');
    if (newWrap) newWrap.classList.add('hidden');
  }
}

function onAuthorPublishFolderSelectChange(select) {
  invalidateAuthorPassportPreview();
  authorState.publish.targetFolderId = select.value ? parseInt(select.value, 10) : null;
  updateAuthorPublishFolderPath();
}

function updateAuthorPublishFolderPath() {
  const pathEl = document.getElementById('author-publish-folder-path');
  if (!pathEl) return;
  const select = document.getElementById('author-publish-folder-select');
  const folderId = select ? parseInt(select.value, 10) : null;
  if (!folderId) {
    pathEl.classList.add('hidden');
    pathEl.innerHTML = '';
    return;
  }
  const treeFolders = buildSortedFolderTree(authorFoldersData);
  const f = treeFolders.find(item => item.id === folderId);
  if (f && f.fullPath) {
    pathEl.classList.remove('hidden');
    pathEl.innerHTML = `
      <i data-lucide="folder-tree" class="w-3.5 h-3.5 text-indigo-400 shrink-0"></i>
      <span class="text-slate-400">Иерархия:</span>
      <span class="text-indigo-300 font-semibold">${escapeHtml(f.fullPath)}</span>
    `;
    if (window.lucide) lucide.createIcons();
  } else {
    pathEl.classList.add('hidden');
    pathEl.innerHTML = '';
  }
}

function authorPublishPayload(result) {
  return {
    cards: result.cards,
    passports: result.passports || [],
    image_links: result.image_links || [],
    passport_only: !!document.getElementById('author-passport-only')?.checked
  };
}

async function runAuthorPublishPreview() {
  const result = authorState.publish.parseResult;
  if (!result || !result.cards) {
    showToast('Сначала загрузите и разберите файл урока', 'error');
    return;
  }

  if ((result.passport_errors || []).length) {
    showToast('Исправьте и проверьте ошибки паспорта перед публикацией', 'error');
    return;
  }
  if ((result.image_links || []).some(link => link.status !== 'matched')) {
    showToast('Исправьте отсутствующие или неоднозначные связи изображений', 'error');
    return;
  }
  const payload = authorPublishPayload(result);

  if (authorState.publish.isNewFolder) {
    const input = document.getElementById('author-publish-new-folder-name');
    const folderName = input ? input.value.trim() : '';
    if (!folderName) {
      showToast('Введите название новой папки', 'error');
      return;
    }
    payload.new_folder_name = folderName;
  } else {
    const select = document.getElementById('author-publish-folder-select');
    const folderId = select ? parseInt(select.value, 10) : null;
    if (!folderId) {
      showToast('Выберите целевую папку', 'error');
      return;
    }
    payload.target_folder_id = folderId;
  }

  try {
    const res = await fetch('/api/admin/author/publish-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Ошибка предпросмотра публикации');

    authorState.publish.passportPreview = data.passports || [];
    renderAuthorPassportChanges();
    const previewMsg = `Превью готово: Папка «${data.target_folder_name}», ${data.decks_count} колод, ${data.total_cards} карт.`;
    showToast(`✅ ${previewMsg}`, 'success');

    const previewBanner = document.getElementById('author-publish-preview-banner');
    if (previewBanner) {
      previewBanner.innerHTML = `
        <div class="flex items-center gap-2 font-semibold text-emerald-300">
          <i data-lucide="check-circle" class="w-4 h-4"></i> ${escapeHtml(previewMsg)}
        </div>
      `;
      previewBanner.classList.remove('hidden');
      if (window.lucide) lucide.createIcons();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function runAuthorPublish() {
  if (authorState.publish.isLoading) return;
  const result = authorState.publish.parseResult;
  if (!result || !result.cards) {
    showToast('Сначала загрузите и разберите файл урока', 'error');
    return;
  }

  if ((result.passport_errors || []).length) {
    showToast('Исправьте и проверьте ошибки паспорта перед публикацией', 'error');
    return;
  }
  if ((result.image_links || []).some(link => link.status !== 'matched')) {
    showToast('Исправьте отсутствующие или неоднозначные связи изображений', 'error');
    return;
  }
  const payload = authorPublishPayload(result);

  if (authorState.publish.isNewFolder) {
    const input = document.getElementById('author-publish-new-folder-name');
    const folderName = input ? input.value.trim() : '';
    if (!folderName) {
      showToast('Введите название новой папки', 'error');
      return;
    }
    payload.new_folder_name = folderName;
  } else {
    const select = document.getElementById('author-publish-folder-select');
    const folderId = select ? parseInt(select.value, 10) : null;
    if (!folderId) {
      showToast('Выберите целевую папку для публикации', 'error');
      return;
    }
    payload.target_folder_id = folderId;
  }

  authorState.publish.isLoading = true;
  authorState.publish.error = null;
  renderAuthorPublishState();

  try {
    const imageFiles = authorState.publish.files.filter(file => /\.(jpe?g|png|webp|gif)$/i.test(file.name));
    let request;
    if (imageFiles.length) {
      const form = new FormData();
      form.append('payload', JSON.stringify(payload));
      imageFiles.forEach(file => form.append('images', file));
      request = { method: 'POST', body: form };
    } else {
      request = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
    }
    const res = await fetch(imageFiles.length ? '/api/admin/author/publish-images' : '/api/admin/author/publish', request);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || `Ошибка публикации (HTTP ${res.status})`);

    authorState.publish.isLoading = false;
    authorState.publish.success = data;
    renderAuthorPublishState();

    showToast(data.passport_only
      ? `Паспорта сохранены: ${data.updated_passports}. Карточки не изменялись.`
      : `🎉 Опубликовано: ${data.total_saved_cards} карточек в папку «${data.folder_name}»!`, 'success');

    // Trigger instant refresh of folders and decks across entire admin
    if (typeof loadAdminFolders === 'function') await loadAdminFolders();
    await refreshAuthorCatalogs(false);
    if (typeof loadDecks === 'function') await loadDecks();
    populateAuthorFolderSelects();
    populateAuthorDeckSelects();
  } catch (err) {
    authorState.publish.isLoading = false;
    authorState.publish.error = err.message || 'Ошибка публикации урока';
    renderAuthorPublishState();
    showToast(authorState.publish.error, 'error');
  }
}

function resetAuthorPublish() {
  authorImageUrls.forEach(URL.revokeObjectURL);
  authorImageUrls = [];
  authorState.publish = {
    files: [],
    file: null,
    text: '',
    parseResult: null,
    targetFolderId: null,
    isNewFolder: false,
    newFolderName: '',
    isLoading: false,
    error: null,
    success: null
  };
  const fileInput = document.getElementById('author-publish-file-input');
  if (fileInput) fileInput.value = '';
  const manualText = document.getElementById('author-publish-manual-text');
  if (manualText) manualText.value = '';
  const passportOnly = document.getElementById('author-passport-only');
  if (passportOnly) passportOnly.checked = false;
  invalidateAuthorPassportPreview();
  renderAuthorPublishState();
}

function renderAuthorPublishState() {
  const dropzoneWrap = document.getElementById('author-publish-dropzone-wrap');
  const resultWrap = document.getElementById('author-publish-result-wrap');
  const loadingWrap = document.getElementById('author-publish-loading-wrap');
  const errorWrap = document.getElementById('author-publish-error-wrap');
  const successWrap = document.getElementById('author-publish-success-wrap');

  // Loading
  if (authorState.publish.isLoading) {
    if (loadingWrap) loadingWrap.classList.remove('hidden');
    if (dropzoneWrap) dropzoneWrap.classList.add('hidden');
    if (resultWrap) resultWrap.classList.add('hidden');
    if (errorWrap) errorWrap.classList.add('hidden');
    if (successWrap) successWrap.classList.add('hidden');
    return;
  } else {
    if (loadingWrap) loadingWrap.classList.add('hidden');
  }

  // Error
  if (authorState.publish.error) {
    if (errorWrap) {
      errorWrap.innerHTML = `
        <div class="flex items-start gap-3">
          <i data-lucide="alert-circle" class="w-5 h-5 text-rose-400 shrink-0 mt-0.5"></i>
          <div>
            <h4 class="font-bold text-rose-300 text-sm">Ошибка</h4>
            <p class="text-xs text-rose-200 mt-1">${escapeHtml(authorState.publish.error)}</p>
          </div>
        </div>
      `;
      errorWrap.classList.remove('hidden');
    }
  } else {
    if (errorWrap) errorWrap.classList.add('hidden');
  }

  // Success
  if (authorState.publish.success) {
    const succ = authorState.publish.success;
    if (successWrap) {
      const decksHtml = (succ.published_decks || []).map(d => `
        <span class="px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-mono font-medium">
          ${escapeHtml(d.deck_name)} (${d.cards_count} к.)
        </span>
      `).join(' ');

      successWrap.innerHTML = `
        <div class="glass p-6 rounded-2xl border border-emerald-500/30 bg-emerald-950/20 space-y-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <i data-lucide="check-circle-2" class="w-6 h-6"></i>
            </div>
            <div>
              <h3 class="text-base font-bold text-white">${succ.passport_only ? 'Паспорта сохранены. Карточки не изменялись.' : 'Урок успешно опубликован в базу данных!'}</h3>
              <p class="text-xs text-emerald-300">Папка ID ${succ.folder_id}: <b>${escapeHtml(succ.folder_name)}</b> • ${succ.passport_only ? `Паспортов: <b>${succ.updated_passports}</b>` : `Всего сохранено: <b>${succ.total_saved_cards}</b> карточек`}</p>
            </div>
          </div>
          <div class="space-y-1">
            <p class="text-xs text-slate-400 font-semibold uppercase">Опубликованные колоды:</p>
            <div class="flex flex-wrap gap-2 pt-1">${decksHtml}</div>
          </div>
          <div class="pt-2 flex items-center gap-3">
            <button onclick="resetAuthorPublish()" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition flex items-center gap-1.5">
              <i data-lucide="plus" class="w-4 h-4"></i> Опубликовать ещё один урок
            </button>
            <button onclick="switchTab('folders')" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-xl border border-slate-700 transition">
              Перейти к папкам
            </button>
          </div>
        </div>
      `;
      successWrap.classList.remove('hidden');
    }
    if (dropzoneWrap) dropzoneWrap.classList.add('hidden');
    if (resultWrap) resultWrap.classList.add('hidden');
    if (window.lucide) lucide.createIcons();
    return;
  } else {
    if (successWrap) successWrap.classList.add('hidden');
  }

  // Parsed Result View
  const parseResult = authorState.publish.parseResult;
  if (parseResult) {
    authorImageUrls.forEach(URL.revokeObjectURL);
    authorImageUrls = [];
    if (dropzoneWrap) dropzoneWrap.classList.add('hidden');
    if (resultWrap) resultWrap.classList.remove('hidden');

    // Files badges
    const filesWrap = document.getElementById('author-publish-files-badge-wrap');
    if (filesWrap) {
      const fileNames = (authorState.publish.files && authorState.publish.files.length > 0)
        ? authorState.publish.files.map(f => f.name)
        : (parseResult.files || []);
      if (fileNames.length > 0) {
        filesWrap.classList.remove('hidden');
        filesWrap.innerHTML = `
          <div class="flex items-center gap-1.5 text-xs text-slate-400 font-semibold mr-2 shrink-0">
            <i data-lucide="files" class="w-4 h-4 text-indigo-400"></i>
            <span>Загружено файлов (${fileNames.length}):</span>
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            ${fileNames.map(n => `
              <span class="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-200 border border-slate-700 font-mono text-[11px] flex items-center gap-1.5">
                <i data-lucide="file-text" class="w-3.5 h-3.5 text-indigo-400"></i>
                ${escapeHtml(n)}
              </span>
            `).join('')}
          </div>
        `;
      } else {
        filesWrap.classList.add('hidden');
      }
    }

    // Metrics
    document.getElementById('author-publish-stat-cards').innerText = parseResult.total_cards || 0;
    document.getElementById('author-publish-stat-decks').innerText = parseResult.decks_count || 0;

    const levelsWrap = document.getElementById('author-publish-stat-levels');
    if (levelsWrap) {
      const lvls = parseResult.levels || [];
      levelsWrap.innerHTML = lvls.length > 0
        ? lvls.map(l => `<span class="px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 font-mono font-bold text-xs">${escapeHtml(l)}</span>`).join(' ')
        : '<span class="text-slate-500 text-xs">Не указаны</span>';
    }

    const typesWrap = document.getElementById('author-publish-stat-types');
    if (typesWrap) {
      const types = parseResult.exercise_types || {};
      const typeKeys = Object.keys(types);
      typesWrap.innerHTML = typeKeys.length > 0
        ? typeKeys.map(k => `<span class="px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs">${escapeHtml(k)}: ${types[k]}</span>`).join(' ')
        : '<span class="text-slate-500 text-xs">Стандартные</span>';
    }

    // Syntax Issues Warning
    const syntaxWrap = document.getElementById('author-publish-syntax-wrap');
    if (syntaxWrap) {
      const issues = parseResult.syntax_issues || [];
      if (issues.length > 0) {
        syntaxWrap.classList.remove('hidden');
        syntaxWrap.innerHTML = `
          <div class="glass p-4 rounded-xl border border-amber-500/30 bg-amber-950/20">
            <div class="flex items-center gap-2 font-bold text-amber-300 text-xs mb-2">
              <i data-lucide="alert-triangle" class="w-4 h-4"></i> Найдено предупреждений синтаксиса: ${issues.length}
            </div>
            <ul class="text-xs text-amber-200/90 space-y-1 list-disc list-inside max-h-32 overflow-y-auto">
              ${issues.map(i => `<li>Карточка #${i.card_number}: ${escapeHtml(i.issue)}</li>`).join('')}
            </ul>
          </div>
        `;
      } else {
        syntaxWrap.classList.add('hidden');
      }
    }

    const imageWrap = document.getElementById('author-publish-images-wrap');
    if (imageWrap) {
      const links = parseResult.image_links || [];
      imageWrap.classList.toggle('hidden', !links.length);
      imageWrap.innerHTML = links.length ? `<div class="glass p-4 rounded-xl border border-slate-700">
        <h4 class="font-bold text-sm text-white mb-2">Связанные изображения · ${links.length}</h4>
        <ul class="space-y-2">${links.map(link => {
          const thumbnails = link.candidates.map(name => {
            const file = authorState.publish.files.find(item => item.name === name);
            if (!file) return '';
            const url = URL.createObjectURL(file);
            authorImageUrls.push(url);
            return `<img src="${url}" alt="${escapeHtml(name)}" title="${escapeHtml(name)}" class="w-12 h-12 object-contain rounded bg-slate-900">`;
          }).join('');
          const label = link.status === 'matched' ? 'Найдено' : link.status === 'missing' ? 'Отсутствует' : 'Неоднозначная связь';
          return `<li class="flex gap-3 items-center text-xs ${link.status === 'matched' ? 'text-emerald-200' : 'text-amber-200'}">
            ${thumbnails ? `<span class="flex gap-1 shrink-0">${thumbnails}</span>` : ''}
            <span><b>${label}</b> · ${escapeHtml(link.deck || 'Колода')} · ${link.card_number ? `карточка №${link.card_number}` : 'карточка не найдена или указана неоднозначно'}<br>
            ${escapeHtml(link.references.join(', '))}${link.candidates.length ? ` → ${escapeHtml(link.candidates.join(', '))}` : ''}</span></li>`;
        }).join('')}</ul></div>` : '';
    }

    // Decks Table
    const decksTbody = document.getElementById('author-publish-decks-tbody');
    if (decksTbody) {
      const decks = parseResult.decks || [];
      decksTbody.innerHTML = decks.map((d, idx) => `
        <tr class="hover:bg-slate-900/50 transition border-b border-slate-800/60">
          <td class="px-4 py-3 text-slate-400 text-xs">${idx + 1}</td>
          <td class="px-4 py-3 text-white text-xs" style="overflow-wrap:anywhere">
            <b>${escapeHtml(d.deck_name)}</b> · ${escapeHtml(d.level || '—')}
            <div class="text-slate-400 mt-1">${d.has_passport ? `Паспорт · этапов: ${d.stages_count}` : 'Без паспорта'}</div>
            ${d.goal ? `<p class="mt-1">Цель: ${escapeHtml(d.goal)}</p>` : ''}
            ${d.expected_result ? `<p class="mt-1 text-slate-300">Ожидаемый результат: ${escapeHtml(d.expected_result)}</p>` : ''}
          </td>
          <td class="px-4 py-3 text-xs text-slate-300">${d.cards_count} шт.</td>
        </tr>
      `).join('');
      renderAuthorPassports();
    }
  } else {
    // Empty state
    if (dropzoneWrap) dropzoneWrap.classList.remove('hidden');
    if (resultWrap) resultWrap.classList.add('hidden');
  }

  if (window.lucide && typeof lucide.createIcons === 'function') {
    lucide.createIcons();
  }
}


// ============================================================================
// MODE 2: EXPORT (Экспорт)
// ============================================================================

function onAuthorExportModeChange(mode) {
  authorState.export.mode = mode;

  const btnDeck = document.getElementById('author-export-mode-deck');
  const btnFolder = document.getElementById('author-export-mode-folder');
  const deckWrap = document.getElementById('author-export-deck-wrap');
  const folderWrap = document.getElementById('author-export-folder-wrap');

  if (mode === 'deck') {
    if (btnDeck) btnDeck.className = 'px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white shadow transition';
    if (btnFolder) btnFolder.className = 'px-3 py-1.5 text-xs font-medium rounded-lg text-slate-400 hover:text-white transition';
    if (deckWrap) deckWrap.classList.remove('hidden');
    if (folderWrap) folderWrap.classList.add('hidden');
    updateAuthorExportDeckStats();
  } else {
    if (btnDeck) btnDeck.className = 'px-3 py-1.5 text-xs font-medium rounded-lg text-slate-400 hover:text-white transition';
    if (btnFolder) btnFolder.className = 'px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white shadow transition';
    if (deckWrap) deckWrap.classList.add('hidden');
    if (folderWrap) folderWrap.classList.remove('hidden');
    updateAuthorExportFolderStats();
  }
}

function onAuthorExportDeckSelectChange(select) {
  authorState.export.selectedDeckId = select.value ? parseInt(select.value, 10) : null;
  updateAuthorExportDeckStats();
}

function onAuthorExportFolderSelectChange(select) {
  authorState.export.selectedFolderId = select.value ? parseInt(select.value, 10) : null;
  updateAuthorExportFolderStats();
}

function updateAuthorExportDeckStats() {
  const select = document.getElementById('author-export-deck-select');
  const statBox = document.getElementById('author-export-deck-stats');
  if (!select || !statBox) return;

  const deckId = select.value ? parseInt(select.value, 10) : null;
  if (!deckId) {
    statBox.innerHTML = '<span class="text-slate-500 text-xs">Выберите колоду из списка</span>';
    return;
  }

  const deck = (decksData || []).find(d => d.id === deckId);
  if (!deck) {
    statBox.innerHTML = '<span class="text-slate-500 text-xs">Колода не найдена</span>';
    return;
  }

  statBox.innerHTML = `
    <div class="flex items-center gap-3 text-xs">
      <span class="text-slate-400">ID: <b class="text-white">${deck.id}</b></span>
      <span class="text-slate-400">Карточек: <b class="text-indigo-400">${deck.card_count || 0}</b></span>
      <span class="text-slate-400">Папка: <b class="text-white">${escapeHtml(deck.folder_name || 'Без папки')}</b></span>
    </div>
  `;
}

function updateAuthorExportFolderStats() {
  const select = document.getElementById('author-export-folder-select');
  const statBox = document.getElementById('author-export-folder-stats');
  if (!select || !statBox) return;

  const folderId = select.value ? parseInt(select.value, 10) : null;
  if (!folderId) {
    statBox.innerHTML = '<span class="text-slate-500 text-xs">Выберите папку из списка</span>';
    return;
  }

  const treeFolders = buildSortedFolderTree(authorFoldersData);
  const folder = treeFolders.find(f => f.id === folderId) || authorFoldersData.find(f => f.id === folderId);
  if (!folder) {
    statBox.innerHTML = '<span class="text-slate-500 text-xs">Папка не найдена</span>';
    return;
  }

  const decksCount = folder.deck_count !== undefined ? folder.deck_count : (folder.decks_count !== undefined ? folder.decks_count : (folder.decks ? folder.decks.length : 0));
  const cardsCount = folder.cards_count !== undefined ? folder.cards_count : (folder.total_cards !== undefined ? folder.total_cards : '—');

  statBox.innerHTML = `
    <div class="space-y-1 text-xs">
      <div class="flex items-center gap-3">
        <span class="text-slate-400">ID: <b class="text-white">${folder.id}</b></span>
        <span class="text-slate-400">Входящих колод: <b class="text-indigo-400">${decksCount}</b></span>
        <span class="text-slate-400">Всего карточек: <b class="text-white">${cardsCount}</b></span>
      </div>
      ${folder.fullPath && folder.depth > 0 ? `<div class="text-[11px] text-slate-400 flex items-center gap-1 font-mono pt-0.5"><i data-lucide="folder-tree" class="w-3 h-3 text-indigo-400"></i> ${escapeHtml(folder.fullPath)}</div>` : ''}
    </div>
  `;
  if (window.lucide) lucide.createIcons();
}

async function triggerAuthorExport(asFile = true) {
  const isDeck = authorState.export.mode === 'deck';
  let param = '';
  let id = null;

  if (isDeck) {
    const select = document.getElementById('author-export-deck-select');
    id = select ? select.value : null;
    if (!id) {
      showToast('Выберите колоду для экспорта', 'error');
      return;
    }
    param = `deck_id=${id}`;
  } else {
    const select = document.getElementById('author-export-folder-select');
    id = select ? select.value : null;
    if (!id) {
      showToast('Выберите папку для экспорта', 'error');
      return;
    }
    param = `folder_id=${id}`;
  }

  if (asFile) {
    showToast('⏳ Формирование файла экспорта...');
    const url = `/api/admin/author/export?${param}&as_file=true`;
    const link = document.createElement('a');
    link.href = url;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    link.remove();
    showToast('📥 Скачивание файла экспорта начато', 'success');
  } else {
    // Preview in text modal
    try {
      showToast('⏳ Загрузка содержимого...');
      const res = await fetch(`/api/admin/author/export?${param}&as_file=false`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Ошибка экспорта');

      openAuthorExportPreviewModal(data.filename, data.text);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
}

function openAuthorExportPreviewModal(filename, text) {
  const modal = document.getElementById('modal-author-export-preview');
  const title = document.getElementById('author-export-preview-title');
  const code = document.getElementById('author-export-preview-content');

  if (title) title.innerText = filename || 'Экспорт урока';
  if (code) code.value = text || '';
  if (modal) modal.classList.remove('hidden');
}

function copyAuthorExportContent() {
  const code = document.getElementById('author-export-preview-content');
  if (code) {
    navigator.clipboard.writeText(code.value).then(() => {
      showToast('Текст скопирован в буфер обмена!', 'success');
    }).catch(() => {
      showToast('Не удалось скопировать текст', 'error');
    });
  }
}


// ============================================================================
// MODE 3: UPDATE (Обновление)
// ============================================================================

function handleAuthorUpdateDragOver(event) {
  event.preventDefault();
  event.stopPropagation();
  const box = document.getElementById('author-update-dropzone');
  if (box) box.classList.add('border-indigo-500', 'bg-indigo-950/30');
}

function handleAuthorUpdateDragLeave(event) {
  event.preventDefault();
  event.stopPropagation();
  const box = document.getElementById('author-update-dropzone');
  if (box) box.classList.remove('border-indigo-500', 'bg-indigo-950/30');
}

function handleAuthorUpdateDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  const box = document.getElementById('author-update-dropzone');
  if (box) box.classList.remove('border-indigo-500', 'bg-indigo-950/30');

  const files = event.dataTransfer && event.dataTransfer.files;
  if (files && files.length > 0) {
    handleAuthorUpdateFiles(Array.from(files));
  }
}

function handleAuthorUpdateFileSelect(input) {
  if (input.files && input.files.length > 0) {
    handleAuthorUpdateFiles(Array.from(input.files));
  }
}

async function handleAuthorUpdateFiles(files) {
  if (!files || files.length === 0) return;
  authorState.update.files = files;
  authorState.update.file = files[0];
  authorState.update.text = '';

  try {
    const textPromises = files.map(file => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(new Error(`Ошибка чтения файла "${file.name}"`));
        reader.readAsText(file, 'utf-8');
      });
    });
    const texts = await Promise.all(textPromises);
    const combinedText = texts.join('\n\n---\n\n');
    authorState.update.text = combinedText;
    await runAuthorUpdatePreview(combinedText);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleAuthorUpdateFile(file) {
  await handleAuthorUpdateFiles(file ? [file] : []);
}

async function runAuthorUpdatePreview(text) {
  authorState.update.isLoading = true;
  authorState.update.error = null;
  authorState.update.success = null;
  renderAuthorUpdateState();

  try {
    const res = await fetch('/api/admin/author/update-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || `Ошибка расчёта изменений (HTTP ${res.status})`);

    authorState.update.previewResult = data;
    authorState.update.requestId = crypto.randomUUID();
    authorState.update.isLoading = false;
    renderAuthorUpdateState();
    showToast(`Предпросмотр: обновляемых карт — ${data.updated}, новых — ${data.new || 0}`, 'success');
  } catch (err) {
    authorState.update.isLoading = false;
    authorState.update.error = err.message || 'Ошибка предпросмотра обновления';
    renderAuthorUpdateState();
    showToast(authorState.update.error, 'error');
  }
}

async function runAuthorUpdateApply() {
  const prev = authorState.update.previewResult;
  if (!prev || !prev.preview_token) {
    showToast('Сначала выполните предпросмотр изменений', 'error');
    return;
  }

  const includeNewCb = document.getElementById('author-update-include-new');
  const includeNew = includeNewCb ? !!includeNewCb.checked : false;

  authorState.update.isLoading = true;
  authorState.update.error = null;
  renderAuthorUpdateState();

  try {
    const res = await fetch('/api/admin/author/update-apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: authorState.update.text,
        preview_token: prev.preview_token,
        deck_id: prev.deck_id,
        folder_id: prev.folder_id,
        include_new: includeNew,
        request_id: authorState.update.requestId
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || `Ошибка применения обновлений (HTTP ${res.status})`);

    authorState.update.isLoading = false;
    authorState.update.success = data;
    renderAuthorUpdateState();

    showToast(`🎉 Обновлено ${data.updated} карточек! (Создано новых: ${data.created || 0}; паспортов: ${data.updated_passports || 0})`, 'success');

    // Trigger instant refresh across admin
    if (typeof loadDecks === 'function') await loadDecks();
    if (typeof loadAdminFolders === 'function') await loadAdminFolders();
    await refreshAuthorCatalogs(false);
  } catch (err) {
    authorState.update.isLoading = false;
    authorState.update.error = err.message || 'Ошибка применения изменений';
    renderAuthorUpdateState();
    showToast(authorState.update.error, 'error');
  }
}

function resetAuthorUpdate() {
  authorState.update = {
    files: [],
    file: null,
    text: '',
    previewResult: null,
    includeNew: false,
    isLoading: false,
    error: null,
    success: null
  };
  const fileInput = document.getElementById('author-update-file-input');
  if (fileInput) fileInput.value = '';
  renderAuthorUpdateState();
}

function renderAuthorUpdateState() {
  const dropzoneWrap = document.getElementById('author-update-dropzone-wrap');
  const resultWrap = document.getElementById('author-update-result-wrap');
  const loadingWrap = document.getElementById('author-update-loading-wrap');
  const errorWrap = document.getElementById('author-update-error-wrap');
  const successWrap = document.getElementById('author-update-success-wrap');

  // Loading
  if (authorState.update.isLoading) {
    if (loadingWrap) loadingWrap.classList.remove('hidden');
    if (dropzoneWrap) dropzoneWrap.classList.add('hidden');
    if (resultWrap) resultWrap.classList.add('hidden');
    if (errorWrap) errorWrap.classList.add('hidden');
    if (successWrap) successWrap.classList.add('hidden');
    return;
  } else {
    if (loadingWrap) loadingWrap.classList.add('hidden');
  }

  // Error
  if (authorState.update.error) {
    if (errorWrap) {
      errorWrap.innerHTML = `
        <div class="flex items-start gap-3">
          <i data-lucide="alert-circle" class="w-5 h-5 text-rose-400 shrink-0 mt-0.5"></i>
          <div>
            <h4 class="font-bold text-rose-300 text-sm">Ошибка</h4>
            <p class="text-xs text-rose-200 mt-1">${escapeHtml(authorState.update.error)}</p>
          </div>
        </div>
      `;
      errorWrap.classList.remove('hidden');
    }
  } else {
    if (errorWrap) errorWrap.classList.add('hidden');
  }

  // Success
  if (authorState.update.success) {
    const succ = authorState.update.success;
    if (successWrap) {
      successWrap.innerHTML = `
        <div class="glass p-6 rounded-2xl border border-emerald-500/30 bg-emerald-950/20 space-y-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <i data-lucide="check-circle-2" class="w-6 h-6"></i>
            </div>
            <div>
              <h3 class="text-base font-bold text-white">Обновления успешно применены!</h3>
              <p class="text-xs text-emerald-300">Обновлено карточек: <b>${succ.updated}</b> • Добавлено новых: <b>${succ.created || 0}</b></p>
            </div>
          </div>
          <div class="pt-2 flex items-center gap-3">
            <button onclick="resetAuthorUpdate()" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition flex items-center gap-1.5">
              <i data-lucide="rotate-ccw" class="w-4 h-4"></i> Обновить другой файл
            </button>
            <button onclick="switchTab('decks')" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-xl border border-slate-700 transition">
              Перейти к колодам
            </button>
          </div>
        </div>
      `;
      successWrap.classList.remove('hidden');
    }
    if (dropzoneWrap) dropzoneWrap.classList.add('hidden');
    if (resultWrap) resultWrap.classList.add('hidden');
    if (window.lucide) lucide.createIcons();
    return;
  } else {
    if (successWrap) successWrap.classList.add('hidden');
  }

  // Preview Result
  const prev = authorState.update.previewResult;
  if (prev) {
    if (dropzoneWrap) dropzoneWrap.classList.add('hidden');
    if (resultWrap) resultWrap.classList.remove('hidden');

    // Files badges
    const updateFilesWrap = document.getElementById('author-update-files-badge-wrap');
    if (updateFilesWrap) {
      const fileNames = (authorState.update.files && authorState.update.files.length > 0)
        ? authorState.update.files.map(f => f.name)
        : [];
      if (fileNames.length > 0) {
        updateFilesWrap.classList.remove('hidden');
        updateFilesWrap.innerHTML = `
          <div class="flex items-center gap-1.5 text-xs text-slate-400 font-semibold mr-2 shrink-0">
            <i data-lucide="files" class="w-4 h-4 text-indigo-400"></i>
            <span>Загружено файлов (${fileNames.length}):</span>
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            ${fileNames.map(n => `
              <span class="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-200 border border-slate-700 font-mono text-[11px] flex items-center gap-1.5">
                <i data-lucide="file-text" class="w-3.5 h-3.5 text-indigo-400"></i>
                ${escapeHtml(n)}
              </span>
            `).join('')}
          </div>
        `;
      } else {
        updateFilesWrap.classList.add('hidden');
      }
    }

    // Stats
    document.getElementById('author-update-stat-updated').innerText = prev.updated || 0;
    document.getElementById('author-update-stat-unchanged').innerText = prev.unchanged || 0;
    document.getElementById('author-update-stat-new').innerText = prev.new || 0;
    document.getElementById('author-update-stat-errors').innerText = (prev.errors && prev.errors.length) || 0;

    // Checkbox for new cards
    const newWrap = document.getElementById('author-update-new-cards-wrap');
    const newCountSpan = document.getElementById('author-update-new-count');
    if (newWrap) {
      if ((prev.new || 0) > 0) {
        newWrap.classList.remove('hidden');
        if (newCountSpan) newCountSpan.innerText = prev.new;
      } else {
        newWrap.classList.add('hidden');
      }
    }

    // Apply Button enable
    const btnApply = document.getElementById('btn-author-update-apply');
    if (btnApply) {
      btnApply.disabled = !prev.preview_token;
      if (btnApply.disabled) {
        btnApply.classList.add('opacity-50', 'pointer-events-none');
      } else {
        btnApply.classList.remove('opacity-50', 'pointer-events-none');
      }
    }

    // Render Diff List
    renderAuthorDiffList(prev.cards || []);
    renderAuthorUpdatePassports(prev.passports || []);
  } else {
    // Empty state
    if (dropzoneWrap) dropzoneWrap.classList.remove('hidden');
    if (resultWrap) resultWrap.classList.add('hidden');
  }

  if (window.lucide && typeof lucide.createIcons === 'function') {
    lucide.createIcons();
  }
}

function renderAuthorDiffList(cards) {
  const container = document.getElementById('author-update-diff-container');
  if (!container) return;

  const changedCards = cards.filter(c => c.status === 'updated' || c.status === 'new' || (c.changes && c.changes.length > 0));

  if (changedCards.length === 0) {
    container.innerHTML = `
      <div class="p-6 text-center text-slate-500 text-xs">
        Нет изменений между файлом и базой данных (все карточки актуальны).
      </div>
    `;
    return;
  }

  container.innerHTML = changedCards.map((c, idx) => {
    const isNew = c.status === 'new' || !c.card_id;
    const badgeClass = isNew
      ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
      : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30';
    const badgeText = isNew ? 'Новая' : 'Изменена';

    const oldContent = c.current || {};
    const newContent = c;

    return `
      <div class="border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60">
        <!-- Accordion Header -->
        <div onclick="toggleAuthorDiffItem(${idx})" class="p-3.5 bg-slate-900/90 flex items-center justify-between cursor-pointer hover:bg-slate-800/80 transition">
          <div class="flex items-center gap-3">
            <span class="px-2 py-0.5 rounded text-[11px] font-bold border ${badgeClass}">${badgeText}</span>
            <span class="font-mono text-xs text-white font-semibold">#${c.card_id || 'new'}</span>
            <span class="text-xs text-slate-300 truncate max-w-xs md:max-w-md">${escapeHtml(c.front || '')}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-slate-400">${(c.changes || []).length} изм.</span>
            <i id="author-diff-chevron-${idx}" data-lucide="chevron-down" class="w-4 h-4 text-slate-400 transition-transform"></i>
          </div>
        </div>

        <!-- Accordion Body -->
        <div id="author-diff-body-${idx}" class="p-4 border-t border-slate-800/80 space-y-3 bg-slate-950/40">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- Было -->
            <div class="p-3 rounded-xl bg-rose-950/20 border border-rose-500/20 space-y-2">
              <span class="text-[10px] font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1">
                <i data-lucide="minus-circle" class="w-3 h-3"></i> Было (В базе данных)
              </span>
              <div class="text-xs font-mono text-slate-200 whitespace-pre-wrap bg-slate-950/60 p-2 rounded border border-rose-500/10 min-h-[50px]">
                ${isNew ? '<span class="text-slate-500 italic">Отсутствует в базе</span>' : escapeHtml(oldContent.front_text || oldContent.front || '—')}
              </div>
              <div class="text-xs font-mono text-slate-400 whitespace-pre-wrap bg-slate-950/60 p-2 rounded border border-rose-500/10">
                ${isNew ? '—' : escapeHtml(oldContent.back_text || oldContent.back || '—')}
              </div>
            </div>

            <!-- Стало -->
            <div class="p-3 rounded-xl bg-emerald-950/20 border border-emerald-500/20 space-y-2">
              <span class="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                <i data-lucide="plus-circle" class="w-3 h-3"></i> Стало (Из файла)
              </span>
              <div class="text-xs font-mono text-emerald-200 whitespace-pre-wrap bg-slate-950/60 p-2 rounded border border-emerald-500/10 min-h-[50px]">
                ${escapeHtml(newContent.front || newContent.front_text || '—')}
              </div>
              <div class="text-xs font-mono text-emerald-300 whitespace-pre-wrap bg-slate-950/60 p-2 rounded border border-emerald-500/10">
                ${escapeHtml(newContent.back || newContent.back_text || '—')}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderAuthorUpdatePassports(passports) {
  const diff = document.getElementById('author-update-diff-container');
  if (!diff) return;
  let container = document.getElementById('author-update-passports');
  if (!container) {
    container = document.createElement('div');
    container.id = 'author-update-passports';
    container.className = 'space-y-3 mb-4';
    diff.before(container);
  }
  container.innerHTML = passports.map(entry => `<details class="p-3 rounded-xl border border-slate-700">
    <summary class="cursor-pointer text-sm text-slate-200" style="min-height:44px;overflow-wrap:anywhere">Паспорт: ${escapeHtml(entry.deck_name)} (колода #${entry.deck_id})</summary>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-300">
      <div><b>Было</b><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(JSON.stringify(entry.before, null, 2))}</pre></div>
      <div><b>Из файла (только указанные поля)</b><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(JSON.stringify(entry.passport, null, 2))}</pre></div>
    </div>
  </details>`).join('');
}

function toggleAuthorDiffItem(idx) {
  const body = document.getElementById(`author-diff-body-${idx}`);
  const chevron = document.getElementById(`author-diff-chevron-${idx}`);
  if (!body) return;

  body.classList.toggle('hidden');
  if (chevron) {
    chevron.classList.toggle('rotate-180');
  }
}

// Passport drafts stay attached to their parsed deck; no database writes while editing.
function invalidateAuthorPassportPreview() {
  authorState.publish.passportPreview = [];
  document.getElementById('author-publish-preview-banner')?.classList.add('hidden');
  renderAuthorPassportChanges();
}

function renderAuthorPassportChanges() {
  const container = document.getElementById('author-passport-changes');
  if (!container) return;
  container.innerHTML = (authorState.publish.passportPreview || []).map(entry => `
    <details class="p-3 rounded-lg border border-slate-700">
      <summary class="cursor-pointer" style="min-height:44px">${escapeHtml(entry.deck_name)}:
        ${entry.target_deck_id ? `существующая колода #${entry.target_deck_id}` : 'новая колода'} · изменений: ${entry.changes.length}</summary>
      ${entry.changes.map(change => `<div class="my-2" style="overflow-wrap:anywhere">
        <b>${escapeHtml(change.field)}</b>
        <p>Было: ${escapeHtml(JSON.stringify(change.before) ?? '—')}</p>
        <p>Станет: ${escapeHtml(JSON.stringify(change.after))}</p>
      </div>`).join('')}
    </details>`).join('');
}

function renderAuthorPassportMessages() {
  const result = authorState.publish.parseResult;
  const container = document.getElementById('author-passport-messages');
  if (!result || !container) return;
  container.innerHTML = [
    ...(result.passport_errors || []).map(message => `<p class="text-rose-300">${escapeHtml(message)}</p>`),
    ...(result.passport_warnings || []).map(message => `<p class="text-amber-200">${escapeHtml(message)}</p>`)
  ].join('');
}

function renderAuthorPassports() {
  const result = authorState.publish.parseResult;
  const container = document.getElementById('author-passport-editors');
  if (!result || !container) return;
  const openDetails = [...container.querySelectorAll('details[open]')].map(element => element.id);
  renderAuthorPassportMessages();
  const input = (index, section, field, label, value) => `
    <label class="block text-xs text-slate-300">${label}
      <input class="w-full mt-1 p-2 rounded bg-slate-950 border border-slate-700 text-white"
        style="min-height:44px" value="${escapeHtml(String(value ?? ''))}"
        onchange="editAuthorPassportField(${index}, '${section}', '${field}', this.value)">
    </label>`;
  container.innerHTML = (result.passports || []).map((entry, index) => {
    const passport = entry.passport && typeof entry.passport === 'object' ? entry.passport : {};
    const intro = passport.intro || {};
    const pedagogy = passport.pedagogy || {};
    return `<details id="author-passport-editor-${index}" class="p-3 rounded-xl border border-slate-700">
      <summary class="cursor-pointer text-sm text-white" style="min-height:44px;overflow-wrap:anywhere">Просмотреть / редактировать паспорт: ${escapeHtml(entry.deck_name || 'Без названия')}</summary>
      <div class="space-y-3">
        ${['title', 'level', 'topic', 'description', 'goal', 'estimated_time', 'recommendations'].map((field, i) =>
          input(index, 'intro', field, ['Название занятия', 'CEFR', 'Тема', 'Описание', 'Цель', 'Ориентировочное время', 'Перед началом'][i], intro[field])).join('')}
        <label class="block text-xs text-slate-300">Чему научится ученик (по одному пункту на строку)
          <textarea class="w-full mt-1 p-2 bg-slate-950 rounded border border-slate-700" rows="3"
            onchange="editAuthorPassportField(${index}, 'intro', 'learning_outcomes', this.value.split('\\n').filter(Boolean))">${escapeHtml((Array.isArray(intro.learning_outcomes) ? intro.learning_outcomes : []).join('\n'))}</textarea>
        </label>
        <label class="block text-xs text-slate-300">Тип занятия
          <select class="w-full mt-1 p-2 bg-slate-950 rounded border border-slate-700" style="min-height:44px"
            onchange="editAuthorPassportField(${index}, 'pedagogy', 'lesson_type', this.value)">
            <option value="">— Не задан —</option>
            ${['theory', 'practice', 'review', 'assessment'].map((type, i) => `<option value="${type}" ${pedagogy.lesson_type === type ? 'selected' : ''}>${['Теория', 'Практика', 'Восстановление знаний', 'Диагностика'][i]}</option>`).join('')}
          </select>
        </label>
        ${input(index, 'pedagogy', 'expected_result', 'Ожидаемый результат', pedagogy.expected_result)}
        <div class="space-y-3">
          ${(Array.isArray(pedagogy.stages) ? pedagogy.stages : []).map((stage, si) => `
            <fieldset class="p-3 border border-slate-800 rounded-lg space-y-2">
              <legend class="text-xs text-slate-300">Этап ${si + 1}</legend>
              <details id="author-passport-stage-${index}-${si}">
                <summary class="text-xs text-slate-200 cursor-pointer" style="min-height:44px;overflow-wrap:anywhere">${escapeHtml(String(stage?.title || 'Новый этап'))}</summary>
                <div class="space-y-2">
              ${['id', 'title', 'goal', 'expected_skill', 'from_card', 'to_card'].map((field, i) => `
                <label class="block text-xs text-slate-300">${['Стабильный ID', 'Название', 'Цель', 'Ожидаемый навык', 'С карточки', 'По карточку'][i]}
                  <input class="w-full mt-1 p-2 bg-slate-950 rounded border border-slate-700" style="min-height:44px"
                    value="${escapeHtml(String(stage?.[field] ?? ''))}"
                    onchange="editAuthorPassportStage(${index}, ${si}, '${field}', this.value)">
                </label>`).join('')}
              <label class="block text-xs text-slate-300">Поддержка
                <select class="w-full mt-1 p-2 bg-slate-950 rounded border border-slate-700" style="min-height:44px"
                  onchange="editAuthorPassportStage(${index}, ${si}, 'support', this.value)">
                  <option value="">— Выберите —</option>
                  ${['high', 'medium', 'low', 'independent'].map((support, i) => `<option value="${support}" ${stage?.support === support ? 'selected' : ''}>${['Высокая', 'Умеренная', 'Минимальная', 'Самостоятельно'][i]}</option>`).join('')}
                </select>
              </label>
              <button class="text-xs text-slate-300 p-2" style="min-height:44px" onclick="removeAuthorPassportStage(${index}, ${si})">Удалить этап</button>
                </div>
              </details>
            </fieldset>`).join('')}
          <button class="text-xs text-slate-200 p-2" style="min-height:44px" onclick="addAuthorPassportStage(${index})">Добавить этап</button>
        </div>
        <details id="author-passport-advanced-${index}">
          <summary class="text-xs text-slate-400 cursor-pointer" style="min-height:44px">Все поля JSON: компетенции, критерии и рекомендации</summary>
          <label class="block text-xs text-slate-300">Полный паспорт
            <textarea id="author-passport-json-${index}" class="w-full p-3 font-mono text-xs bg-slate-950 rounded border border-slate-700" rows="12">${escapeHtml(JSON.stringify(passport, null, 2))}</textarea>
          </label>
          <button class="text-xs text-slate-200 p-2" style="min-height:44px" onclick="applyAuthorPassportJson(${index})">Применить JSON к черновику</button>
        </details>
        <button class="px-3 py-2 bg-indigo-600 rounded-lg text-sm text-white" style="min-height:44px" onclick="validateAuthorPassportDrafts()">Проверить изменения</button>
      </div>
    </details>`;
  }).join('');
  openDetails.forEach(id => { const element = document.getElementById(id); if (element) element.open = true; });
}

function markAuthorPassportEdited() {
  const result = authorState.publish.parseResult;
  result.passport_errors = [...(result.document_errors || []), 'Черновик изменён. Нажмите «Проверить изменения».'];
  invalidateAuthorPassportPreview();
  renderAuthorPassportMessages();
}

function editAuthorPassportField(index, section, field, value) {
  const passport = authorState.publish.parseResult.passports[index].passport;
  passport[section] ??= {};
  if (field === 'level' && !value) delete passport[section][field];
  else passport[section][field] = value;
  markAuthorPassportEdited();
  document.getElementById(`author-passport-json-${index}`).value = JSON.stringify(passport, null, 2);
}

function editAuthorPassportStage(index, stageIndex, field, value) {
  const passport = authorState.publish.parseResult.passports[index].passport;
  const stage = passport.pedagogy.stages[stageIndex];
  if (field === 'from_card' || field === 'to_card') {
    if (!value.trim()) delete stage[field];
    else stage[field] = Number(value);
  } else stage[field] = value;
  markAuthorPassportEdited();
  document.getElementById(`author-passport-json-${index}`).value = JSON.stringify(passport, null, 2);
}

function addAuthorPassportStage(index) {
  const passport = authorState.publish.parseResult.passports[index].passport;
  passport.pedagogy ??= { lesson_type: 'practice' };
  passport.pedagogy.stages ??= [];
  passport.pedagogy.stages.push({ id: '', title: '', goal: '', support: 'high' });
  markAuthorPassportEdited();
  renderAuthorPassports();
}

function removeAuthorPassportStage(index, stageIndex) {
  authorState.publish.parseResult.passports[index].passport.pedagogy.stages.splice(stageIndex, 1);
  markAuthorPassportEdited();
  renderAuthorPassports();
}

function applyAuthorPassportJson(index) {
  try {
    const value = JSON.parse(document.getElementById(`author-passport-json-${index}`).value);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Требуется JSON-объект');
    authorState.publish.parseResult.passports[index].passport = value;
    markAuthorPassportEdited();
    renderAuthorPassports();
  } catch (error) { showToast(error.message, 'error'); }
}

async function validateAuthorPassportDrafts() {
  const result = authorState.publish.parseResult;
  try {
    const response = await fetch('/api/admin/author/passport-validate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(authorPublishPayload(result))
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Ошибка проверки');
    result.passport_errors = [...(result.document_errors || []), ...(data.errors || [])];
    if (!result.passport_errors.length) {
      result.decks = data.decks;
      showToast('Паспорт проверен', 'success');
      renderAuthorPublishState();
    }
    renderAuthorPassportMessages();
  } catch (error) { showToast(error.message, 'error'); }
}
