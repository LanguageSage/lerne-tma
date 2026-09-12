/**
 * backup_explorer.js — Lerne TMA Admin Module
 * Full-screen Workspace for Backup Inspection & Granular Deck/Folder Restoration
 */

let explorerState = {
  backupsList: [],
  selectedFilename: null,
  backupData: null,
  selectedDeckId: null,
  deckPreviewData: null,
  filterUserId: 'all',
  searchQuery: '',
  applyToAllUsers: false
};

/**
 * Initializes or switches to Backup Explorer with an optional target backup filename.
 */
async function initBackupExplorer(targetFilename = null) {
  try {
    const res = await fetch('/api/admin/backups');
    const data = await res.json();
    explorerState.backupsList = data.backups || [];

    const selectEl = document.getElementById('explorer-backup-select');
    if (!selectEl) return;

    selectEl.innerHTML = '';
    if (explorerState.backupsList.length === 0) {
      selectEl.innerHTML = '<option value="">Нет доступных файлов бэкапа</option>';
      return;
    }

    explorerState.backupsList.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.filename;
      opt.textContent = `${b.filename} (${b.size_mb >= 1 ? b.size_mb + ' MB' : b.size_kb + ' KB'}) — ${b.created_at}`;
      if (b.folder) opt.dataset.folder = b.folder;
      selectEl.appendChild(opt);
    });

    const fileToSelect = targetFilename || (explorerState.selectedFilename) || explorerState.backupsList[0].filename;
    selectEl.value = fileToSelect;
    explorerState.selectedFilename = fileToSelect;

    await inspectCurrentBackup();
  } catch (err) {
    console.error('Failed to init backup explorer', err);
  }
}

/**
 * Loads inspection data for the currently selected backup file.
 */
async function inspectCurrentBackup() {
  const selectEl = document.getElementById('explorer-backup-select');
  if (!selectEl || !selectEl.value) return;

  const filename = selectEl.value;
  explorerState.selectedFilename = filename;
  const selectedOpt = selectEl.options[selectEl.selectedIndex];
  const folder = selectedOpt ? (selectedOpt.dataset.folder || '') : '';

  const leftListEl = document.getElementById('explorer-decks-list');
  const previewBoxEl = document.getElementById('explorer-card-preview-box');

  if (leftListEl) {
    leftListEl.innerHTML = `
      <div class="py-16 text-center text-slate-400 space-y-3">
        <div class="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-500"></div>
        <p class="text-xs font-semibold">Чтение структуры бэкапа ${filename}...</p>
      </div>
    `;
  }
  if (previewBoxEl) {
    previewBoxEl.innerHTML = `
      <div class="py-24 text-center text-slate-500">
        <p class="text-sm">Выберите колоду слева для предпросмотра карточек</p>
      </div>
    `;
  }

  try {
    const res = await fetch(`/api/admin/backups/inspect?filename=${encodeURIComponent(filename)}&folder=${encodeURIComponent(folder)}`);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Ошибка анализа бэкапа');
    }
    const data = await res.json();
    explorerState.backupData = data;
    explorerState.selectedDeckId = null;
    explorerState.deckPreviewData = null;

    // Update Summary Stats Strip
    const s = data.summary || {};
    document.getElementById('explorer-stat-users').innerText = s.total_users || 0;
    document.getElementById('explorer-stat-folders').innerText = s.total_folders || 0;
    document.getElementById('explorer-stat-decks').innerText = s.total_decks || 0;
    document.getElementById('explorer-stat-cards').innerText = s.total_cards || 0;
    document.getElementById('explorer-stat-images').innerText = s.total_images || 0;

    // Populate User Filter Dropdown
    const userFilterEl = document.getElementById('explorer-user-filter');
    if (userFilterEl) {
      userFilterEl.innerHTML = '<option value="all">👥 Все пользователи</option>';
      (data.users || []).forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.user_id;
        const nameStr = u.username ? `@${u.username}` : (u.first_name || `ID ${u.user_id}`);
        opt.textContent = `${nameStr} (${u.decks_count} колод, ${u.cards_count} карт)`;
        userFilterEl.appendChild(opt);
      });
      userFilterEl.value = explorerState.filterUserId || 'all';
    }

    renderExplorerDecksList();

    // Auto-select first deck if exists
    if (data.decks && data.decks.length > 0) {
      // Prefer LiD deck or first deck
      const prefDeck = data.decks.find(d => d.name.toLowerCase().includes('leben') || d.name.toLowerCase().includes('politik')) || data.decks[0];
      selectExplorerDeck(prefDeck.id);
    }
  } catch (err) {
    if (leftListEl) {
      leftListEl.innerHTML = `
        <div class="p-6 text-center text-rose-400 bg-rose-500/10 rounded-xl border border-rose-500/20 text-xs">
          <p class="font-bold">Не удалось проанализировать бэкап</p>
          <p class="mt-1 text-slate-400">${err.message}</p>
        </div>
      `;
    }
  }
}

/**
 * Filters and renders folders and decks in the left sidebar.
 */
function renderExplorerDecksList() {
  const leftListEl = document.getElementById('explorer-decks-list');
  if (!leftListEl || !explorerState.backupData) return;

  const data = explorerState.backupData;
  const uidFilter = explorerState.filterUserId;
  const query = (explorerState.searchQuery || '').toLowerCase().trim();

  let decks = data.decks || [];

  // Filter by user
  if (uidFilter !== 'all') {
    decks = decks.filter(d => String(d.user_id) === String(uidFilter));
  }

  // Filter by search query
  if (query) {
    decks = decks.filter(d => d.name.toLowerCase().includes(query));
  }

  if (decks.length === 0) {
    leftListEl.innerHTML = `
      <div class="py-12 text-center text-slate-500 text-xs">
        <p>Колоды не найдены по заданным критериям</p>
      </div>
    `;
    return;
  }

  // Group by Folder
  const folderMap = {};
  (data.folders || []).forEach(f => {
    folderMap[f.id] = f;
  });

  const grouped = {};
  const noFolderDecks = [];

  decks.forEach(d => {
    if (d.folder_id && folderMap[d.folder_id]) {
      if (!grouped[d.folder_id]) {
        grouped[d.folder_id] = {
          folder: folderMap[d.folder_id],
          decks: []
        };
      }
      grouped[d.folder_id].decks.push(d);
    } else {
      noFolderDecks.push(d);
    }
  });

  let html = '';

  // Render Folders
  Object.values(grouped).forEach(group => {
    const f = group.folder;
    const totalFolderCards = group.decks.reduce((sum, d) => sum + (d.cards_count || 0), 0);
    const totalFolderImgs = group.decks.reduce((sum, d) => sum + (d.images_count || 0), 0);

    html += `
      <div class="border border-slate-800/80 rounded-xl overflow-hidden bg-slate-900/40 mb-3 shadow-sm">
        <div class="p-3 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 overflow-hidden">
            <span class="w-3 h-3 rounded-full shrink-0" style="background-color: ${f.color || '#4f46e5'}"></span>
            <span class="text-xs font-bold text-white truncate" title="${f.name}">${f.name}</span>
            <span class="text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">${group.decks.length} кол.</span>
          </div>
          <button onclick="promptRestoreFolder(${f.id}, '${escapeHtml(f.name)}')" class="px-2 py-1 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 text-[11px] font-semibold rounded border border-indigo-500/20 shrink-0 transition flex items-center gap-1" title="Восстановить всю папку целиком">
            <i data-lucide="download-cloud" class="w-3 h-3"></i> Папка
          </button>
        </div>
        <div class="divide-y divide-slate-800/40 p-1 space-y-0.5">
    `;

    group.decks.forEach(d => {
      const isSelected = d.id === explorerState.selectedDeckId;
      const activeClass = isSelected
        ? 'bg-indigo-600/20 border-indigo-500/40 text-white font-semibold'
        : 'hover:bg-slate-800/50 text-slate-300 border-transparent';

      html += `
        <div onclick="selectExplorerDeck(${d.id})" class="p-2.5 rounded-lg border cursor-pointer transition flex items-center justify-between gap-2 ${activeClass}">
          <div class="truncate text-xs">
            <div class="truncate font-medium">${d.is_pinned ? '📌 ' : ''}${d.name}</div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <span class="px-1.5 py-0.5 text-[10px] rounded bg-slate-800/80 text-slate-300 font-mono">${d.cards_count} карт</span>
            ${d.images_count > 0 ? `<span class="px-1.5 py-0.5 text-[10px] rounded bg-purple-500/10 text-purple-300 border border-purple-500/20 font-mono">🎨 ${d.images_count}</span>` : ''}
          </div>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;
  });

  // Render Decks without Folder
  if (noFolderDecks.length > 0) {
    html += `
      <div class="border border-slate-800/80 rounded-xl overflow-hidden bg-slate-900/40 mb-3 shadow-sm">
        <div class="p-2.5 bg-slate-900/80 border-b border-slate-800 text-xs font-semibold text-slate-400">
          📁 Без папки (${noFolderDecks.length})
        </div>
        <div class="divide-y divide-slate-800/40 p-1 space-y-0.5">
    `;
    noFolderDecks.forEach(d => {
      const isSelected = d.id === explorerState.selectedDeckId;
      const activeClass = isSelected
        ? 'bg-indigo-600/20 border-indigo-500/40 text-white font-semibold'
        : 'hover:bg-slate-800/50 text-slate-300 border-transparent';

      html += `
        <div onclick="selectExplorerDeck(${d.id})" class="p-2.5 rounded-lg border cursor-pointer transition flex items-center justify-between gap-2 ${activeClass}">
          <div class="truncate text-xs">
            <div class="truncate font-medium">${d.is_pinned ? '📌 ' : ''}${d.name}</div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <span class="px-1.5 py-0.5 text-[10px] rounded bg-slate-800/80 text-slate-300 font-mono">${d.cards_count} карт</span>
            ${d.images_count > 0 ? `<span class="px-1.5 py-0.5 text-[10px] rounded bg-purple-500/10 text-purple-300 border border-purple-500/20 font-mono">🎨 ${d.images_count}</span>` : ''}
          </div>
        </div>
      `;
    });
    html += `
        </div>
      </div>
    `;
  }

  leftListEl.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

/**
 * Selects a deck and fetches full card preview data from backend.
 */
async function selectExplorerDeck(deckId) {
  explorerState.selectedDeckId = deckId;
  renderExplorerDecksList();

  const previewBoxEl = document.getElementById('explorer-card-preview-box');
  if (!previewBoxEl) return;

  previewBoxEl.innerHTML = `
    <div class="py-24 text-center text-slate-400 space-y-3">
      <div class="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-500"></div>
      <p class="text-xs font-semibold">Загрузка карточек колоды...</p>
    </div>
  `;

  try {
    const selectEl = document.getElementById('explorer-backup-select');
    const filename = selectEl.value;
    const selectedOpt = selectEl.options[selectEl.selectedIndex];
    const folder = selectedOpt ? (selectedOpt.dataset.folder || '') : '';

    const res = await fetch(`/api/admin/backups/deck-preview?filename=${encodeURIComponent(filename)}&deck_id=${deckId}&folder=${encodeURIComponent(folder)}`);
    if (!res.ok) {
      throw new Error('Не удалось загрузить карточки');
    }
    const data = await res.json();
    explorerState.deckPreviewData = data;
    renderDeckCardsPreview();
  } catch (err) {
    previewBoxEl.innerHTML = `
      <div class="p-6 text-center text-rose-400 bg-rose-500/10 rounded-xl border border-rose-500/20 text-xs">
        <p class="font-bold">Ошибка предпросмотра карточек</p>
        <p class="mt-1 text-slate-400">${err.message}</p>
      </div>
    `;
  }
}

/**
 * Renders the Right Column: Deck details, Action Bar, and Cards List.
 */
function renderDeckCardsPreview() {
  const previewBoxEl = document.getElementById('explorer-card-preview-box');
  if (!previewBoxEl || !explorerState.deckPreviewData) return;

  const { deck, cards } = explorerState.deckPreviewData;

  let cardsHtml = '';
  if (cards.length === 0) {
    cardsHtml = '<div class="py-12 text-center text-slate-500 text-xs">В колоде нет карточек</div>';
  } else {
    cards.forEach((c, idx) => {
      let imgTag = '';
      if (c.image_path) {
        let imgSrc = c.image_path;
        if (imgSrc.startsWith('/lid_images/')) {
          // Both static direct or API route work
          imgSrc = `/lid_images/${imgSrc.replace('/lid_images/', '')}`;
        } else if (!imgSrc.startsWith('http') && !imgSrc.startsWith('/')) {
          imgSrc = `/api/media/images/${imgSrc}`;
        }
        imgTag = `
          <div class="mt-2 shrink-0">
            <img src="${imgSrc}" alt="Card image" class="max-h-36 max-w-full rounded-lg border border-slate-700 object-contain bg-black/40 cursor-pointer hover:opacity-90 transition" onclick="window.open('${imgSrc}', '_blank')" onerror="this.onerror=null; this.src='/api/media/images/${encodeURIComponent(c.image_path.split('/').pop())}'" title="Кликните для просмотра оригинала">
            <div class="text-[10px] text-indigo-300 font-mono mt-0.5 truncate max-w-xs">${c.image_path}</div>
          </div>
        `;
      }

      cardsHtml += `
        <div class="p-4 bg-slate-900/60 rounded-xl border border-slate-800/80 hover:border-slate-700 transition space-y-2">
          <div class="flex items-start justify-between gap-3 border-b border-slate-800/60 pb-2">
            <span class="font-mono text-[11px] font-bold text-slate-400">#${idx + 1}</span>
            <div class="flex items-center gap-1.5">
              ${c.has_image ? '<span class="px-2 py-0.5 text-[10px] font-bold rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">🎨 Цветная иллюстрация</span>' : ''}
              <span class="px-2 py-0.5 text-[10px] rounded bg-slate-800 text-slate-300">${c.card_type || 'quiz'}</span>
            </div>
          </div>

          <!-- Question / Front -->
          <div class="text-xs font-semibold text-white whitespace-pre-line leading-relaxed">
            ${formatCardText(c.front_text)}
          </div>

          <!-- Answer / Back -->
          ${c.back_text ? `
            <div class="p-2.5 bg-slate-950/80 rounded-lg border border-slate-900 text-xs text-slate-300 whitespace-pre-line leading-relaxed">
              ${escapeHtml(c.back_text)}
            </div>
          ` : ''}

          <!-- Image Preview -->
          ${imgTag}
        </div>
      `;
    });
  }

  previewBoxEl.innerHTML = `
    <div class="space-y-4">
      <!-- Deck Header & Actions Banner -->
      <div class="glass p-5 rounded-2xl border border-slate-800 bg-slate-900/90 shadow-xl space-y-4">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="text-lg font-bold text-white">${deck.name}</h3>
              <span class="px-2.5 py-0.5 text-xs font-mono font-semibold rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                ${deck.cards_count} карточек
              </span>
              ${deck.images_count > 0 ? `
                <span class="px-2.5 py-0.5 text-xs font-semibold rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">
                  🎨 ${deck.images_count} с цветными картинками
                </span>
              ` : ''}
            </div>
            <p class="text-xs text-slate-400 mt-1">ID колоды в бэкапе: #${deck.id}</p>
          </div>

          <!-- Action Buttons -->
          <div class="flex flex-wrap items-center gap-2">
            <button onclick="promptRestoreDeck(${deck.id}, 'replace')" class="px-4 py-2 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-indigo-500/20 flex items-center gap-1.5 transition">
              <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> 🔄 Восстановить с заменой
            </button>
            <button onclick="promptRestoreDeck(${deck.id}, 'copy')" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold rounded-xl flex items-center gap-1.5 transition">
              <i data-lucide="copy" class="w-3.5 h-3.5"></i> ➕ Как копию
            </button>
          </div>
        </div>

        <!-- Scope Option -->
        <div class="pt-3 border-t border-slate-800/80 flex items-center justify-between flex-wrap gap-2 text-xs">
          <label class="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white transition">
            <input type="checkbox" id="explorer-apply-all-cb" class="w-4 h-4 rounded text-indigo-600 focus:ring-0 cursor-pointer" ${explorerState.applyToAllUsers ? 'checked' : ''} onchange="explorerState.applyToAllUsers = this.checked">
            <span>🌐 <b>Применить для ВСЕХ пользователей</b> (у кого есть колода/папка с таким именем)</span>
          </label>
          <span class="text-[11px] text-slate-500">Безопасно: обновляет только карточки, не затрагивая чужие колоды</span>
        </div>
      </div>

      <!-- Cards Container -->
      <div class="space-y-3">
        ${cardsHtml}
      </div>
    </div>
  `;

  if (window.lucide) lucide.createIcons();
}

/**
 * Formats question front text highlighting the correct option (* marked).
 */
function formatCardText(rawText) {
  if (!rawText) return '';
  const lines = rawText.split('\n');
  return lines.map(line => {
    if (line.trim().startsWith('*')) {
      return `<span class="text-emerald-400 font-bold bg-emerald-500/10 px-1 rounded">✅ ${escapeHtml(line.trim().substring(1))}</span>`;
    }
    return escapeHtml(line);
  }).join('<br>');
}

/**
 * Triggers deck restoration with user confirmation.
 */
async function promptRestoreDeck(deckId, mode) {
  const deck = explorerState.deckPreviewData?.deck;
  const deckName = deck ? deck.name : `Колода #${deckId}`;
  const applyAll = document.getElementById('explorer-apply-all-cb')?.checked || false;

  const modeText = mode === 'replace' ? 'С ЗАМЕНОЙ карточек' : 'КАК НОВУЮ КОПИЮ';
  const scopeText = applyAll ? 'ДЛЯ ВСЕХ ПОЛЬЗОВАТЕЛЕЙ' : 'для выбранного пользователя';

  if (!confirm(`Вы действительно хотите восстановить колоду «${deckName}»?\n\nРежим: ${modeText}\nОбласть: ${scopeText}`)) {
    return;
  }

  const selectEl = document.getElementById('explorer-backup-select');
  const filename = selectEl.value;
  const selectedOpt = selectEl.options[selectEl.selectedIndex];
  const folder = selectedOpt ? (selectedOpt.dataset.folder || '') : '';

  let targetUid = explorerState.filterUserId !== 'all' ? parseInt(explorerState.filterUserId, 10) : null;

  const payload = {
    backup_filename: filename,
    backup_folder: folder || null,
    deck_id: deckId,
    target_user_id: targetUid,
    mode: mode,
    apply_to_all_users: applyAll
  };

  try {
    const res = await fetch('/api/admin/backups/restore-deck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.detail || 'Ошибка восстановления');

    alert(`🎉 Успешно!\nВосстановлено колод: ${result.restored_decks_count}\nВсего карточек: ${result.total_cards_restored}`);
  } catch (err) {
    alert(`❌ Ошибка восстановления: ${err.message}`);
  }
}

/**
 * Triggers full folder restoration with user confirmation.
 */
async function promptRestoreFolder(folderId, folderName) {
  const applyAll = confirm(`Восстановить папку «${folderName}» для ВСЕХ пользователей?\n\nНажмите ОК — применить для ВСЕХ пользователей\nНажмите Отмена — восстановить только для выбранного пользователя`);

  const mode = confirm(`Режим восстановления папки:\n\nОК — С заменой существующих колод\nОтмена — Как новую копию папки`) ? 'replace' : 'copy';

  const selectEl = document.getElementById('explorer-backup-select');
  const filename = selectEl.value;
  const selectedOpt = selectEl.options[selectEl.selectedIndex];
  const folder = selectedOpt ? (selectedOpt.dataset.folder || '') : '';

  let targetUid = explorerState.filterUserId !== 'all' ? parseInt(explorerState.filterUserId, 10) : null;

  const payload = {
    backup_filename: filename,
    backup_folder: folder || null,
    backup_folder_id: folderId,
    target_user_id: targetUid,
    mode: mode,
    apply_to_all_users: applyAll
  };

  try {
    const res = await fetch('/api/admin/backups/restore-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.detail || 'Ошибка восстановления');

    alert(`🎉 Папка «${result.folder_name}» успешно восстановлена!\nПользователей: ${result.users_count}\nКолод: ${result.decks_count}\nКарточек: ${result.cards_count}`);
  } catch (err) {
    alert(`❌ Ошибка восстановления папки: ${err.message}`);
  }
}

function onExplorerSearchChange(val) {
  explorerState.searchQuery = val;
  renderExplorerDecksList();
}

function onExplorerUserFilterChange(val) {
  explorerState.filterUserId = val;
  renderExplorerDecksList();
}

function openInBackupExplorer(filename, folder = null) {
  switchTab('backup-explorer');
  initBackupExplorer(filename);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
