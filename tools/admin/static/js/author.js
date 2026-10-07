/**
 * author.js — Lerne TMA Admin Module: «Автор уроков» (Lesson Author)
 * 
 * Предоставляет 3 режима работы автора уроков:
 * 1. Публикация (Drag&Drop .txt/.md -> /parse -> preview -> выбор папки -> /publish)
 * 2. Экспорт (Колода / Папка -> /export -> скачивание .txt)
 * 3. Обновление (Файл -> /update-preview -> diff было/стало -> /update-apply)
 * 
 * Вся бизнес-логика выполняется на backend в /api/admin/author/*
 */

// Global State for Author Module
let authorState = {
  activeSubtab: 'publish', // 'publish' | 'export' | 'update'

  // Mode 1: Publish
  publish: {
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
    file: null,
    text: '',
    previewResult: null,
    includeNew: false,
    isLoading: false,
    error: null,
    success: null
  }
};


// ============================================================================
// Initialization & Tab Navigation
// ============================================================================

async function initAuthorTab() {
  // Ensure folders and decks are loaded in state
  if (!foldersData || foldersData.length === 0) {
    if (typeof loadAdminFolders === 'function') await loadAdminFolders();
  }
  if (!decksData || decksData.length === 0) {
    if (typeof loadDecks === 'function') await loadDecks();
  }

  // Populate dropdowns for export and publish
  populateAuthorFolderSelects();
  populateAuthorDeckSelects();

  // Render active subtab
  switchAuthorSubtab(authorState.activeSubtab);
}

function switchAuthorSubtab(subtab) {
  authorState.activeSubtab = subtab;

  ['publish', 'export', 'update'].forEach(s => {
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

function populateAuthorFolderSelects() {
  const pubSelect = document.getElementById('author-publish-folder-select');
  const expSelect = document.getElementById('author-export-folder-select');

  const folders = (foldersData || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  if (pubSelect) {
    const currentVal = pubSelect.value;
    pubSelect.innerHTML = '<option value="">-- Выберите существующую папку --</option>';
    folders.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = `${f.name} (ID: ${f.id}, колод: ${f.decks_count || (f.decks ? f.decks.length : 0)})`;
      pubSelect.appendChild(opt);
    });
    if (currentVal && folders.some(f => String(f.id) === String(currentVal))) {
      pubSelect.value = currentVal;
    } else if (folders.length > 0) {
      pubSelect.value = folders[0].id;
      authorState.publish.targetFolderId = folders[0].id;
    }
  }

  if (expSelect) {
    const currentExpVal = expSelect.value;
    expSelect.innerHTML = '<option value="">-- Выберите папку для экспорта --</option>';
    folders.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = `${f.name} (ID: ${f.id})`;
      expSelect.appendChild(opt);
    });
    if (currentExpVal && folders.some(f => String(f.id) === String(currentExpVal))) {
      expSelect.value = currentExpVal;
    } else if (folders.length > 0) {
      expSelect.value = folders[0].id;
      authorState.export.selectedFolderId = folders[0].id;
    }
    updateAuthorExportFolderStats();
  }
}

function populateAuthorDeckSelects() {
  const expDeckSelect = document.getElementById('author-export-deck-select');
  if (!expDeckSelect) return;

  const decks = (decksData || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
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
    handleAuthorPublishFile(files[0]);
  }
}

function handleAuthorPublishFileSelect(input) {
  if (input.files && input.files[0]) {
    handleAuthorPublishFile(input.files[0]);
  }
}

async function handleAuthorPublishFile(file) {
  authorState.publish.file = file;
  authorState.publish.text = '';
  await runAuthorParse({ file });
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
  authorState.publish.file = null;
  authorState.publish.text = text;
  await runAuthorParse({ text });
}

async function runAuthorParse({ file, text }) {
  authorState.publish.isLoading = true;
  authorState.publish.error = null;
  authorState.publish.success = null;
  renderAuthorPublishState();

  try {
    let res;
    if (file) {
      const formData = new FormData();
      formData.append('file', file);
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
    showToast(`Успешно разобрано: ${data.total_cards} карточек в ${data.decks_count} колодах`, 'success');
  } catch (err) {
    authorState.publish.isLoading = false;
    authorState.publish.error = err.message || 'Ошибка соединения с сервером';
    renderAuthorPublishState();
    showToast(authorState.publish.error, 'error');
  }
}

function toggleAuthorNewFolderInput(isNew) {
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
  authorState.publish.targetFolderId = select.value ? parseInt(select.value, 10) : null;
}

async function runAuthorPublishPreview() {
  const result = authorState.publish.parseResult;
  if (!result || !result.cards) {
    showToast('Сначала загрузите и разберите файл урока', 'error');
    return;
  }

  const payload = {
    cards: result.cards
  };

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
  const result = authorState.publish.parseResult;
  if (!result || !result.cards) {
    showToast('Сначала загрузите и разберите файл урока', 'error');
    return;
  }

  const payload = {
    cards: result.cards
  };

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
    const res = await fetch('/api/admin/author/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || `Ошибка публикации (HTTP ${res.status})`);

    authorState.publish.isLoading = false;
    authorState.publish.success = data;
    renderAuthorPublishState();

    showToast(`🎉 Опубликовано: ${data.total_saved_cards} карточек в папку «${data.folder_name}»!`, 'success');

    // Trigger instant refresh of folders and decks across entire admin
    if (typeof loadAdminFolders === 'function') await loadAdminFolders();
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
  authorState.publish = {
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
              <h3 class="text-base font-bold text-white">Урок успешно опубликован в базу данных!</h3>
              <p class="text-xs text-emerald-300">Папка ID ${succ.folder_id}: <b>${escapeHtml(succ.folder_name)}</b> • Всего сохранено: <b>${succ.total_saved_cards}</b> карточек</p>
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
    if (dropzoneWrap) dropzoneWrap.classList.add('hidden');
    if (resultWrap) resultWrap.classList.remove('hidden');

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

    // Decks Table
    const decksTbody = document.getElementById('author-publish-decks-tbody');
    if (decksTbody) {
      const decks = parseResult.decks || [];
      decksTbody.innerHTML = decks.map((d, idx) => `
        <tr class="hover:bg-slate-900/50 transition border-b border-slate-800/60">
          <td class="px-4 py-3 font-mono text-slate-400 text-xs">${idx + 1}</td>
          <td class="px-4 py-3 font-semibold text-white text-xs">${escapeHtml(d.deck_name)}</td>
          <td class="px-4 py-3 text-xs text-slate-300">${d.cards_count} шт.</td>
        </tr>
      `).join('');
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

  const folder = (foldersData || []).find(f => f.id === folderId);
  if (!folder) {
    statBox.innerHTML = '<span class="text-slate-500 text-xs">Папка не найдена</span>';
    return;
  }

  const decksCount = folder.decks_count !== undefined ? folder.decks_count : (folder.decks ? folder.decks.length : 0);
  const cardsCount = folder.total_cards !== undefined ? folder.total_cards : '—';

  statBox.innerHTML = `
    <div class="flex items-center gap-3 text-xs">
      <span class="text-slate-400">ID: <b class="text-white">${folder.id}</b></span>
      <span class="text-slate-400">Входящих колод: <b class="text-indigo-400">${decksCount}</b></span>
      <span class="text-slate-400">Всего карточек: <b class="text-white">${cardsCount}</b></span>
    </div>
  `;
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
    handleAuthorUpdateFile(files[0]);
  }
}

function handleAuthorUpdateFileSelect(input) {
  if (input.files && input.files[0]) {
    handleAuthorUpdateFile(input.files[0]);
  }
}

async function handleAuthorUpdateFile(file) {
  authorState.update.file = file;
  authorState.update.text = '';
  const reader = new FileReader();
  reader.onload = async (e) => {
    const text = e.target.result;
    authorState.update.text = text;
    await runAuthorUpdatePreview(text);
  };
  reader.readAsText(file);
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
        include_new: includeNew
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || `Ошибка применения обновлений (HTTP ${res.status})`);

    authorState.update.isLoading = false;
    authorState.update.success = data;
    renderAuthorUpdateState();

    showToast(`🎉 Обновлено ${data.updated} карточек! (Создано новых: ${data.created || 0})`, 'success');

    // Trigger instant refresh across admin
    if (typeof loadDecks === 'function') await loadDecks();
    if (typeof loadAdminFolders === 'function') await loadAdminFolders();
  } catch (err) {
    authorState.update.isLoading = false;
    authorState.update.error = err.message || 'Ошибка применения изменений';
    renderAuthorUpdateState();
    showToast(authorState.update.error, 'error');
  }
}

function resetAuthorUpdate() {
  authorState.update = {
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

function toggleAuthorDiffItem(idx) {
  const body = document.getElementById(`author-diff-body-${idx}`);
  const chevron = document.getElementById(`author-diff-chevron-${idx}`);
  if (!body) return;

  body.classList.toggle('hidden');
  if (chevron) {
    chevron.classList.toggle('rotate-180');
  }
}
