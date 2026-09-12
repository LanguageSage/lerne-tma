/**
 * folders.js — Lerne TMA Admin Module
 */
function openFoldersModal() {
      switchTab('folders');
    }

function setFolderFilter(mode) {
      folderFilterMode = mode;
      ['all', 'default', 'custom', 'with_decks', 'empty'].forEach(m => {
        const btn = document.getElementById(`folder-filter-${m}`);
        if (btn) {
          if (m === mode) {
            btn.className = 'px-2.5 py-1 rounded font-semibold transition bg-indigo-600 text-white';
          } else {
            btn.className = 'px-2.5 py-1 rounded font-semibold transition text-slate-400 hover:text-white';
          }
        }
      });
      renderFoldersList();
    }

function filterFoldersByUser(userId, userName) {
      folderUserFilter = userId;
      const banner = document.getElementById('folder-user-filter-banner');
      const nameEl = document.getElementById('folder-user-filter-name');
      if (banner && nameEl) {
        nameEl.innerText = `${userName} (ID: ${userId})`;
        banner.classList.remove('hidden');
      }
      switchTab('folders');
      renderFoldersList();
    }

function clearFolderUserFilter() {
      folderUserFilter = null;
      const banner = document.getElementById('folder-user-filter-banner');
      if (banner) banner.classList.add('hidden');
      renderFoldersList();
    }

async function loadAdminFolders() {
      try {
        const res = await fetch('/api/admin/folders');
        const data = await res.json();
        foldersData = data.folders || [];

        // Update count buttons and badges
        const btnCount = document.getElementById('folders-count-btn');
        if (btnCount) btnCount.innerText = foldersData.length;
        const tabBadge = document.getElementById('folders-tab-badge');
        if (tabBadge) tabBadge.innerText = foldersData.length;
        const statsBadge = document.getElementById('folders-stats-badge');
        if (statsBadge) statsBadge.innerText = `${foldersData.length} папок`;

        // Update 4 overview metric cards
        let totalDecks = 0;
        let totalCards = 0;
        let totalDefault = 0;
        foldersData.forEach(f => {
          totalDecks += (f.deck_count || 0);
          totalCards += (f.cards_count || 0);
          if (f.is_default) totalDefault += 1;
        });

        const elTot = document.getElementById('stat-folders-total');
        if (elTot) elTot.innerText = foldersData.length;
        const elDk = document.getElementById('stat-folders-decks');
        if (elDk) elDk.innerText = totalDecks;
        const elCd = document.getElementById('stat-folders-cards');
        if (elCd) elCd.innerText = totalCards;
        const elDf = document.getElementById('stat-folders-default');
        if (elDf) elDf.innerText = totalDefault;

        renderFoldersList();
      } catch (err) {
        console.error("Error loading folders:", err);
      }
    }

function renderFoldersList() {
      const listEl = document.getElementById('folders-list') || document.getElementById('folders-modal-list');
      if (!listEl) return;

      const q = (document.getElementById('folder-search')?.value || '').toLowerCase().trim();
      let filtered = foldersData || [];

      // Filter by user if selected
      if (folderUserFilter) {
        filtered = filtered.filter(f => String(f.user_id) === String(folderUserFilter));
      }

      // Filter by mode pill
      if (folderFilterMode === 'default') {
        filtered = filtered.filter(f => f.is_default);
      } else if (folderFilterMode === 'custom') {
        filtered = filtered.filter(f => !f.is_default);
      } else if (folderFilterMode === 'with_decks') {
        filtered = filtered.filter(f => (f.deck_count || 0) > 0);
      } else if (folderFilterMode === 'empty') {
        filtered = filtered.filter(f => (f.deck_count || 0) === 0);
      }

      // Filter by search query
      if (q) {
        filtered = filtered.filter(f => 
          (f.name && f.name.toLowerCase().includes(q)) ||
          (f.user_name && f.user_name.toLowerCase().includes(q)) ||
          String(f.user_id).includes(q) ||
          String(f.id).includes(q) ||
          (f.target_language && f.target_language.toLowerCase().includes(q)) ||
          (f.decks && f.decks.some(d => d.name && d.name.toLowerCase().includes(q)))
        );
      }

      if (filtered.length === 0) {
        listEl.innerHTML = `
          <div class="glass p-12 text-center rounded-2xl border border-slate-800 text-slate-400 space-y-2">
            <i data-lucide="folder-x" class="w-10 h-10 mx-auto text-slate-500 mb-2"></i>
            <div class="text-base font-semibold text-slate-300">Папки не найдены</div>
            <div class="text-xs text-slate-500">Попробуйте изменить поисковый запрос или сбросить фильтры</div>
          </div>
        `;
        lucide.createIcons();
        onFolderRowCheckboxChange();
        return;
      }

      listEl.innerHTML = filtered.map(f => {
        const safeName = (f.name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
        const safeUserName = (f.user_name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
        const isDefault = f.is_default;
        
        let avatarEl = '';
        if (f.user_photo) {
          avatarEl = `<img src="${f.user_photo}" class="w-7 h-7 rounded-full object-cover border border-slate-700 shrink-0" alt="avatar" />`;
        } else {
          avatarEl = `<div class="w-7 h-7 rounded-full ${f.user_is_guest ? 'bg-slate-800 text-slate-400' : 'bg-indigo-600 text-white'} border border-slate-700 flex items-center justify-center text-[10px] font-bold shrink-0">${f.user_is_guest ? '👻' : (f.user_name || 'U')[0].toUpperCase()}</div>`;
        }

        // Decks inside this folder
        let decksContent = '';
        if (f.decks && f.decks.length > 0) {
          const deckItems = f.decks.map(d => {
            const safeDeckName = (d.name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            return `
              <div class="bg-slate-950/80 border border-slate-800/80 hover:border-slate-700 p-2.5 rounded-xl flex items-center justify-between gap-2 transition group">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5">
                    <span class="font-mono text-[11px] text-indigo-400">#${d.id}</span>
                    <span class="text-xs font-bold text-slate-200 truncate group-hover:text-indigo-300 transition" title="${d.name}">${d.name}</span>
                  </div>
                  <div class="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                    <span class="text-emerald-400 font-semibold">${d.card_count || 0} карт.</span>
                    ${d.level ? `<span class="uppercase text-slate-500 font-mono">${d.level}</span>` : ''}
                    <span class="uppercase text-slate-500 font-mono">${d.target_language || f.target_language || ''}</span>
                  </div>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  <button type="button" onclick="openDeckPreviewModal('${d.id}', '${safeDeckName}')" title="👁️ Предосмотр колоды" class="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg transition">
                    <i data-lucide="eye" class="w-3.5 h-3.5"></i>
                  </button>
                  <button type="button" onclick="openRegenModal('${d.id}', '${safeDeckName}', 'context_only')" title="✨ Догенерировать контекст" class="p-1.5 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 rounded-lg border border-purple-500/20 transition">
                    <i data-lucide="sparkles" class="w-3.5 h-3.5"></i>
                  </button>
                  <button type="button" onclick="openRegenModal('${d.id}', '${safeDeckName}', 'audio_only')" title="🎙️ Озвучить колоду (TTS)" class="p-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 rounded-lg border border-emerald-500/20 transition">
                    <i data-lucide="mic" class="w-3.5 h-3.5"></i>
                  </button>
                </div>
              </div>
            `;
          }).join('');

          decksContent = `
            <div class="mt-3 pt-3 border-t border-slate-800/80">
              <div class="text-xs font-semibold text-slate-400 mb-2 flex items-center justify-between">
                <span>Входящие колоды (${f.decks.length}):</span>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                ${deckItems}
              </div>
            </div>
          `;
        } else {
          decksContent = `
            <div class="mt-2 text-xs text-slate-500 italic flex items-center gap-1.5">
              <span>⚪ В этой папке нет активных колод</span>
            </div>
          `;
        }

        return `
          <div class="glass p-5 rounded-2xl border border-slate-800 hover:border-slate-700 transition bg-slate-900/70 shadow-lg space-y-3.5">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <!-- Left: Checkbox + Folder Title + Badges -->
              <div class="flex items-start gap-3 flex-1 min-w-0">
                <input type="checkbox" class="folder-row-checkbox w-4 h-4 text-indigo-600 rounded cursor-pointer shrink-0 mt-1" value="${f.id}" onchange="onFolderRowCheckboxChange()">
                <div class="space-y-1.5 flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm" style="background-color: ${f.color}"></span>
                    <span class="font-bold text-base text-white truncate">${f.name}</span>
                    <span class="px-2 py-0.5 rounded-md text-[11px] font-mono text-slate-400 bg-slate-800 border border-slate-700">#${f.id}</span>
                    <span class="px-2.5 py-0.5 rounded-md text-xs font-bold bg-indigo-950/80 text-indigo-300 border border-indigo-500/30">
                      📁 ${f.deck_count} колод • 🗂️ ${f.cards_count} карт.
                    </span>
                    <span class="px-2 py-0.5 rounded-md text-xs font-mono font-bold uppercase bg-slate-800 text-slate-300 border border-slate-700">
                      ${f.target_language}
                    </span>
                    ${isDefault 
                      ? `<span class="px-2.5 py-0.5 rounded-md text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">★ ДЕФОЛТНАЯ</span>` 
                      : `<span class="px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-800 text-slate-400">☆ Обычная</span>`}
                  </div>

                  <!-- Owner Info with Quick Action Links -->
                  <div class="flex items-center gap-2 text-xs text-slate-400 flex-wrap pt-0.5">
                    ${avatarEl}
                    <span class="truncate">Владелец: <b class="text-slate-200">${f.user_name}</b> <span class="font-mono text-[11px] text-slate-500">(ID: ${f.user_id})</span></span>
                    ${f.user_is_guest ? '<span class="px-1.5 py-0.2 rounded bg-slate-800 text-[10px] text-slate-400">(гость)</span>' : ''}
                    <span class="text-slate-600">•</span>
                    <button onclick="viewUserDecks('${f.user_id}', '${safeUserName}')" title="Посмотреть все колоды этого пользователя" class="text-indigo-400 hover:text-indigo-300 font-medium hover:underline text-xs inline-flex items-center gap-1">
                      <i data-lucide="layers" class="w-3 h-3"></i> Все колоды
                    </button>
                    <button onclick="filterFoldersByUser('${f.user_id}', '${safeUserName}')" title="Фильтровать папки только этого пользователя" class="text-purple-400 hover:text-purple-300 font-medium hover:underline text-xs inline-flex items-center gap-1">
                      <i data-lucide="filter" class="w-3 h-3"></i> Папки юзера
                    </button>
                  </div>
                </div>
              </div>

              <!-- Right: Folder Action Buttons -->
              <div class="flex items-center gap-2 shrink-0 self-end sm:self-center flex-wrap">
                <button onclick="openFolderRegenModal(${f.id})" 
                  class="px-3.5 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:opacity-90 text-white transition flex items-center gap-1.5 shadow-md shadow-purple-500/20"
                  title="Перегенерировать все ${f.deck_count} колод этой папки">
                  <i data-lucide="zap" class="w-3.5 h-3.5"></i> ⚡ В перегенерацию (${f.deck_count})
                </button>
                <button onclick="toggleDefaultFolder(${f.id}, ${!isDefault})" 
                  class="px-3 py-2 text-xs font-bold rounded-xl border transition flex items-center gap-1 ${
                    isDefault 
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30' 
                      : 'bg-purple-600/20 text-purple-300 border-purple-500/40 hover:bg-purple-600/30'
                  }">
                  ${isDefault ? '★ Снять дефолт' : '🌟 Для ВСЕХ'}
                </button>
                <button onclick="openAssignFolderModal(${f.id}, '${safeName}')" 
                  class="px-3 py-2 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition flex items-center gap-1 shadow-md shadow-indigo-500/20">
                  👥 Раздать
                </button>
                <button onclick="createFolderBackup(${f.id}, '${safeName}')" 
                  class="px-3 py-2 text-xs font-bold rounded-xl bg-teal-600/20 hover:bg-teal-600/30 text-teal-300 border border-teal-500/30 transition flex items-center gap-1"
                  title="Создать точечный бэкап папки со всеми входящими колодами и карточками">
                  <i data-lucide="save" class="w-3.5 h-3.5"></i> 💾 Бэкап
                </button>
                <button onclick="promoteToLibrary('folder', ${f.id}, '${safeName}')" 
                  class="px-3 py-2 text-xs font-bold rounded-xl bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 transition flex items-center gap-1"
                  title="Добавить папку со всеми колодами в Мастер-Библиотеку">
                  ⭐ В Библиотеку
                </button>
                <button onclick="overwriteAllUsers('folder', ${f.id}, '${safeName}')" 
                  class="px-3 py-2 text-xs font-bold rounded-xl bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 transition flex items-center gap-1"
                  title="Полностью заменить папку у всех пользователей, у которых она есть">
                  🔄 Обновить
                </button>
                <button onclick="openCollaborativeModal('folder', ${f.id}, '${safeName}')" 
                  class="px-3 py-2 text-xs font-bold rounded-xl bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 border border-violet-500/30 transition flex items-center gap-1"
                  title="Сделать папку совместной">
                  🤝 Совместная
                </button>
                <button onclick="deleteAdminFolder(${f.id}, '${safeName}', ${f.deck_count})" 
                  class="px-3 py-2 text-xs font-bold rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 transition flex items-center gap-1"
                  title="Удалить папку и все входящие в неё колоды">
                  <i data-lucide="trash-2" class="w-3.5 h-3.5"></i> Удалить
                </button>
              </div>
            </div>

            <!-- Decks Container inside Folder -->
            ${decksContent}
          </div>
        `;
      }).join('');
      
      lucide.createIcons();
      onFolderRowCheckboxChange();
    }

function onFolderRowCheckboxChange() {
      const checked = document.querySelectorAll('.folder-row-checkbox:checked');
      const btn = document.getElementById('btn-delete-selected-folders');
      const countEl = document.getElementById('selected-folders-count');
      if (btn && countEl) {
        countEl.innerText = checked.length;
        if (checked.length > 0) {
          btn.classList.remove('hidden');
        } else {
          btn.classList.add('hidden');
        }
      }
    }

function toggleSelectAllFolders(checked) {
      document.querySelectorAll('.folder-row-checkbox').forEach(cb => cb.checked = checked);
      onFolderRowCheckboxChange();
    }

async function deleteAdminFolder(folderId, folderName, deckCount) {
      if (!confirm(`Вы действительно хотите удалить папку "${folderName}" и все входящие в неё колоды (${deckCount} шт.)?`)) return;
      try {
        const res = await fetch(`/api/admin/folders/${folderId}`, { method: 'DELETE' });
        const data = await res.json();
        if (res.ok) {
          loadAdminFolders();
          loadDecks();
        } else {
          alert("Ошибка при удалении папки: " + (data.detail || "Неизвестная ошибка"));
        }
      } catch (err) {
        alert("Сетевая ошибка при удалении папки: " + err);
      }
    }

async function deleteSelectedFolders() {
      const checked = document.querySelectorAll('.folder-row-checkbox:checked');
      if (checked.length === 0) return;
      const folderIds = Array.from(checked).map(cb => parseInt(cb.value, 10));
      if (!confirm(`Вы действительно хотите удалить ${folderIds.length} выбранных папок и все входящие в них колоды?`)) return;
      try {
        const res = await fetch('/api/admin/folders/batch-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folder_ids: folderIds })
        });
        const data = await res.json();
        if (res.ok) {
          const selectAll = document.getElementById('folder-table-select-all');
          if (selectAll) selectAll.checked = false;
          onFolderRowCheckboxChange();
          loadAdminFolders();
          loadDecks();
        } else {
          alert("Ошибка при удалении папок: " + (data.detail || "Неизвестная ошибка"));
        }
      } catch (err) {
        alert("Сетевая ошибка при удалении папок: " + err);
      }
    }

async function toggleDefaultFolder(folderId, newDefault) {
      if (!newDefault) {
        if (!confirm('Снять отметку дефолтной с этой папки? (Колоды больше не будут выдаваться новым пользователям)')) return;
        try {
          const res = await fetch(`/api/admin/folders/${folderId}/set-default`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_default: false, copy_to_existing: false })
          });
          const data = await res.json();
          alert(data.message || 'Статус обновлен');
          loadAdminFolders();
        } catch (err) {
          alert('Ошибка: ' + err);
        }
        return;
      }

      const copyToExisting = confirm(
        '🌟 Сделать ВСЮ ПАПКУ и все её колоды ДЕФОЛТНЫМИ (стартовыми)?\n\n' +
        '• Все колоды в папке добавятся в Библиотеку и будут выдаваться ВСЕМ новым пользователям внутри этой папки.\n\n' +
        'Нажмите "ОК", чтобы также СКОПИРОВАТЬ эту папку и все её колоды ВСЕМ существующим пользователям прямо сейчас.\n' +
        'Нажмите "Отмена", если хотите сделать её дефолтной только для будущих новых пользователей.'
      );

      try {
        const res = await fetch(`/api/admin/folders/${folderId}/set-default`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_default: true, copy_to_existing: copyToExisting })
        });
        if (!res.ok) {
          const errText = await res.text();
          let msg = errText;
          try {
            const errObj = JSON.parse(errText);
            msg = errObj.detail || errObj.message || errText;
          } catch (_) {}
          throw new Error(msg);
        }
        const data = await res.json();
        alert(data.message || 'Папка успешно сделана дефолтной!');
        loadAdminFolders();
        loadDecks();
      } catch (err) {
        alert('Ошибка при изменении статуса папки: ' + err.message);
      }
    }

function openAssignFolderModal(folderId, folderName) {
      activeAssignFolderId = folderId;
      document.getElementById('modal-assign-folder-title').innerText = `Раздать папку: ${folderName}`;
      
      const container = document.getElementById('modal-assign-folder-users-list');
      container.innerHTML = '';

      usersData.forEach(u => {
        container.innerHTML += `
          <label class="flex items-center gap-3 p-2 hover:bg-slate-900 rounded-lg cursor-pointer">
            <input type="checkbox" name="assign-folder-user" value="${u.user_id}" class="w-4 h-4 text-indigo-600 rounded">
            <span class="text-xs text-slate-200 font-medium">${u.first_name || ''} (@${u.username || 'no_user'}) — ID: ${u.user_id}</span>
          </label>
        `;
      });

      document.getElementById('modal-assign-folder').classList.remove('hidden');
    }

function selectAllFolderUsers(checked) {
      document.querySelectorAll('input[name="assign-folder-user"]').forEach(cb => cb.checked = checked);
    }

async function submitAssignFolder() {
      const mode = document.querySelector('input[name="assign-folder-mode"]:checked').value;
      const selectedUsers = Array.from(document.querySelectorAll('input[name="assign-folder-user"]:checked')).map(cb => parseInt(cb.value));

      if (mode === 'default_all') {
        return toggleDefaultFolder(activeAssignFolderId, true);
      }

      if (mode === 'library') {
        closeModal('modal-assign-folder');
        return promoteToLibrary('folder', activeAssignFolderId, document.getElementById('modal-assign-folder-title').innerText.replace('Раздать папку: ', ''));
      }

      if (mode === 'overwrite_all') {
        closeModal('modal-assign-folder');
        return overwriteAllUsers('folder', activeAssignFolderId, document.getElementById('modal-assign-folder-title').innerText.replace('Раздать папку: ', ''));
      }

      if (selectedUsers.length === 0) {
        alert("Выберите хотя бы одного пользователя для раздачи!");
        return;
      }

      try {
        const res = await fetch(`/api/admin/folders/${activeAssignFolderId}/assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_ids: selectedUsers, mode: mode })
        });

        const data = await res.json();
        closeModal('modal-assign-folder');
        alert(data.message || `Папка успешно роздана!`);
        loadDecks();
        loadAdminFolders();
      } catch (err) {
        alert("Ошибка при раздаче папки: " + err);
      }
    }

    let activeFolderRegenId = null;
    let folderDecksState = {};
    let globalBatchExcludedCards = new Set();

function openFolderRegenModal(folderId) {
      activeFolderRegenId = folderId;
      const folder = (foldersData || []).find(f => f.id === folderId);
      if (!folder) {
        alert("Папка не найдена");
        return;
      }

      document.getElementById('modal-folder-regen-title').innerText = `Перегенерация папки: ${folder.name}`;
      document.getElementById('modal-folder-regen-subtitle').innerText = `${folder.deck_count} колод • ${folder.cards_count} карт. • Владелец: ${folder.user_name} (ID: ${folder.user_id})`;
      document.getElementById('modal-folder-regen-decks-count').innerText = folder.deck_count;
      
      const clearQueueCb = document.getElementById('folder-regen-clear-queue');
      if (clearQueueCb) clearQueueCb.checked = true;

      // Initialize folder decks state
      folderDecksState = {};
      (folder.decks || []).forEach(d => {
        const fullDeck = (decksData || []).find(item => String(item.id) === String(d.id));
        folderDecksState[d.id] = {
          id: d.id,
          name: d.name,
          card_count: fullDeck?.card_count || 0,
          missing_context_count: fullDeck?.missing_context_count || 0,
          missing_audio_count: fullDeck?.missing_audio_count || 0,
          target_language: folder.target_language || 'de',
          level: fullDeck?.level || '',
          is_library: Boolean(fullDeck?.is_library),
          selected: true,
          cards: null,
          loadingCards: false,
          expanded: false,
          excludedCardIds: new Set()
        };
      });

      renderFolderRegenDecksList();
      updateFolderRegenSummary();

      document.getElementById('modal-folder-regen').classList.remove('hidden');
      lucide.createIcons();
    }

function renderFolderRegenDecksList() {
      const listEl = document.getElementById('modal-folder-regen-decks-list');
      const decks = Object.values(folderDecksState);
      if (decks.length === 0) {
        listEl.innerHTML = '<div class="text-slate-500 text-center py-4">Нет колод в этой папке</div>';
        return;
      }

      listEl.innerHTML = decks.map(d => {
        const isChecked = d.selected;
        const totalCards = d.cards ? d.cards.length : (d.card_count || 0);
        const excludedCardsCnt = d.excludedCardIds ? d.excludedCardIds.size : 0;
        const activeCardsCnt = Math.max(0, totalCards - excludedCardsCnt);

        let cardsHtml = '';
        if (d.expanded) {
          if (d.loadingCards) {
            cardsHtml = `
              <div class="p-3 bg-slate-950/90 rounded-lg border border-slate-800 text-center text-slate-400">
                <i data-lucide="loader-2" class="w-4 h-4 animate-spin inline mr-1 text-indigo-400"></i> Загрузка карточек колоды...
              </div>
            `;
          } else if (d.cards && d.cards.length > 0) {
            cardsHtml = `
              <div class="mt-2 pt-2 border-t border-slate-800/80 space-y-1.5 bg-slate-950/60 p-2 rounded-lg border border-slate-800/60">
                <div class="flex items-center justify-between text-[11px] text-slate-400 pb-1">
                  <span class="font-semibold text-slate-300">Карточки колоды (${d.cards.length}):</span>
                  <div class="flex items-center gap-1.5">
                    <button type="button" onclick="selectAllCardsInFolderDeck(${d.id}, true)" class="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-indigo-300 rounded text-[10px] font-semibold transition">Выбрать все</button>
                    <button type="button" onclick="selectAllCardsInFolderDeck(${d.id}, false)" class="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded text-[10px] font-semibold transition">Снять все</button>
                  </div>
                </div>
                <div class="max-h-48 overflow-y-auto space-y-1 pr-1 font-sans">
                  ${d.cards.map((c, idx) => {
                    const isCardExcluded = d.excludedCardIds.has(c.id);
                    const isCardChecked = !isCardExcluded;
                    return `
                      <label class="flex items-start gap-2 p-1.5 rounded-lg hover:bg-slate-900 border ${isCardChecked ? 'border-slate-800/80 bg-slate-900/50' : 'border-rose-500/20 bg-rose-950/20 opacity-60'} cursor-pointer transition">
                        <input type="checkbox" ${isCardChecked ? 'checked' : ''} onchange="toggleFolderCardCheck(${d.id}, ${c.id}, this.checked)" class="w-3.5 h-3.5 text-indigo-600 rounded mt-0.5 shrink-0">
                        <div class="min-w-0 flex-1 text-[11px]">
                          <div class="flex items-center justify-between gap-1">
                            <span class="font-bold text-slate-100 truncate">${idx + 1}. ${c.front || '(пусто)'}</span>
                            <div class="flex items-center gap-1 shrink-0">
                              <span class="px-1.5 py-0.2 rounded text-[9px] font-semibold ${c.has_context ? 'bg-purple-950/80 text-purple-300 border border-purple-500/30' : 'bg-slate-800 text-slate-500'}">
                                ${c.has_context ? 'Контекст ✓' : 'Без конт.'}
                              </span>
                              <span class="px-1.5 py-0.2 rounded text-[9px] font-semibold ${c.has_audio ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/30' : 'bg-amber-950/80 text-amber-300 border border-amber-500/30'}">
                                ${c.has_audio ? 'Звук ✓' : 'Без звука'}
                              </span>
                            </div>
                          </div>
                          ${c.back ? `<div class="text-slate-400 truncate text-[10px] mt-0.5">${c.back}</div>` : ''}
                        </div>
                      </label>
                    `;
                  }).join('')}
                </div>
              </div>
            `;
          } else {
            cardsHtml = `<div class="p-2 text-slate-500 text-center text-xs">В колоде нет карточек</div>`;
          }
        }

        return `
          <div class="p-2.5 rounded-xl border ${isChecked ? 'bg-slate-900/90 border-slate-800 hover:border-slate-700' : 'bg-slate-950/40 border-slate-900 opacity-60'} transition">
            <div class="flex items-center justify-between gap-2">
              <label class="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer">
                <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleFolderDeckCheck(${d.id}, this.checked)" class="w-4 h-4 text-indigo-600 rounded shrink-0">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="font-mono text-[10px] text-slate-500">#${d.id}</span>
                    <span class="font-bold text-white text-xs truncate">${d.name}</span>
                    ${d.is_library ? '<span class="px-1 py-0.2 bg-amber-500/10 text-amber-300 text-[9px] font-bold rounded border border-amber-500/20">Библиотека ⭐</span>' : ''}
                  </div>
                  <div class="flex items-center gap-1.5 text-[10px] text-slate-400 mt-0.5">
                    <span>${activeCardsCnt} / ${totalCards} карточек к генерации</span>
                    ${excludedCardsCnt > 0 ? `<span class="text-rose-400 font-semibold">• ${excludedCardsCnt} исключено</span>` : ''}
                  </div>
                </div>
              </label>

              <button type="button" onclick="toggleFolderDeckExpand(${d.id})" class="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-indigo-300 hover:text-indigo-200 text-xs font-semibold rounded-lg border border-slate-700/80 flex items-center gap-1 shrink-0 transition" title="Посмотреть карточки этой колоды">
                <span>${d.expanded ? '▲ Скрыть' : '👁️ Карточки'}</span>
                <span class="px-1 rounded bg-indigo-950 text-indigo-300 font-mono text-[10px] font-bold">${totalCards}</span>
              </button>
            </div>
            ${cardsHtml}
          </div>
        `;
      }).join('');

      lucide.createIcons();
    }

function toggleFolderDeckCheck(deckId, checked) {
      if (folderDecksState[deckId]) {
        folderDecksState[deckId].selected = checked;
        renderFolderRegenDecksList();
        updateFolderRegenSummary();
      }
    }

async function toggleFolderDeckExpand(deckId) {
      const d = folderDecksState[deckId];
      if (!d) return;

      d.expanded = !d.expanded;
      if (d.expanded && d.cards === null) {
        d.loadingCards = true;
        renderFolderRegenDecksList();
        try {
          const res = await fetch(`/api/admin/decks/${deckId}/cards`);
          const data = await res.json();
          d.cards = data.cards || [];
          d.card_count = d.cards.length;
        } catch (err) {
          console.error("Failed to load deck cards", err);
          d.cards = [];
        } finally {
          d.loadingCards = false;
        }
      }
      renderFolderRegenDecksList();
      updateFolderRegenSummary();
    }

function toggleFolderCardCheck(deckId, cardId, checked) {
      const d = folderDecksState[deckId];
      if (!d) return;
      if (!checked) {
        d.excludedCardIds.add(cardId);
      } else {
        d.excludedCardIds.delete(cardId);
      }
      renderFolderRegenDecksList();
      updateFolderRegenSummary();
    }

function selectAllCardsInFolderDeck(deckId, checked) {
      const d = folderDecksState[deckId];
      if (!d || !d.cards) return;
      if (checked) {
        d.excludedCardIds.clear();
      } else {
        d.cards.forEach(c => d.excludedCardIds.add(c.id));
      }
      renderFolderRegenDecksList();
      updateFolderRegenSummary();
    }

function selectAllFolderRegenDecks(checked) {
      Object.values(folderDecksState).forEach(d => d.selected = checked);
      renderFolderRegenDecksList();
      updateFolderRegenSummary();
    }

function updateFolderRegenSummary() {
      const decks = Object.values(folderDecksState);
      const selectedDecks = decks.filter(d => d.selected);
      let totalSelectedCards = 0;
      let totalExcludedCards = 0;

      selectedDecks.forEach(d => {
        const total = d.cards ? d.cards.length : (d.card_count || 0);
        const excluded = d.excludedCardIds ? d.excludedCardIds.size : 0;
        totalExcludedCards += excluded;
        totalSelectedCards += Math.max(0, total - excluded);
      });

      const selCountEl = document.getElementById('folder-selected-decks-count');
      const selCardsEl = document.getElementById('folder-selected-cards-count');
      const exclCardsLbl = document.getElementById('folder-excluded-cards-lbl');
      if (selCountEl) selCountEl.innerText = selectedDecks.length;
      if (selCardsEl) selCardsEl.innerText = totalSelectedCards;
      if (exclCardsLbl) exclCardsLbl.innerText = `Исключено карточек: ${totalExcludedCards}`;

      document.querySelectorAll('.folder-btn-count-lbl').forEach(el => el.innerText = selectedDecks.length);
    }

async function submitFolderRegen(action = 'start') {
      const folder = (foldersData || []).find(f => f.id === activeFolderRegenId);
      const selectedDecks = Object.values(folderDecksState).filter(d => d.selected);
      if (selectedDecks.length === 0) {
        alert("Выберите хотя бы одну колоду для перегенерации.");
        return;
      }

      const shouldClearQueue = document.getElementById('folder-regen-clear-queue')?.checked ?? true;
      if (shouldClearQueue) {
        stagedDecks = {};
        globalBatchExcludedCards.clear();
      }

      // 1. Stage all selected decks from this folder
      selectedDecks.forEach(d => {
        const sId = String(d.id);
        const fullDeck = (decksData || []).find(item => String(item.id) === sId);
        stagedDecks[sId] = {
          id: sId,
          name: d.name,
          target_language: folder?.target_language || 'de',
          level: fullDeck?.level || d.level || '',
          card_count: d.card_count || fullDeck?.card_count || 0,
          is_library: Boolean(fullDeck?.is_library || d.is_library)
        };

        // Transfer excluded cards
        if (d.excludedCardIds && d.excludedCardIds.size > 0) {
          d.excludedCardIds.forEach(cId => globalBatchExcludedCards.add(cId));
        }
      });

      saveStagedDecksToStorage();
      updateStagingUI();

      closeModal('modal-folder-regen');

      if (action === 'stage_only') {
        openStagedDecksModal();
        return;
      }

      // Read chosen mode
      const modeRadio = document.querySelector('input[name="folder-regen-mode"]:checked');
      const chosenMode = modeRadio ? modeRadio.value : 'full_regen';
      const openStudio = document.getElementById('folder-regen-open-studio')?.checked ?? true;

      if (openStudio) {
        openBatchRegenStudio(chosenMode);
      } else {
        openBatchRegenStudio(chosenMode);
        if (chosenMode === 'audio_only') {
          startBatchAudioProcess();
        } else if (chosenMode === 'context_only') {
          startBatchContextOnlyProcess();
        } else {
          startBatchAiProcess(false);
        }
      }
    }

    let promptsData = [];


/**
 * Creates a standalone JSON backup of a folder with all its decks and cards.
 */
async function createFolderBackup(folderId, folderName) {
  if (typeof showToast === 'function') {
    showToast(`⏳ Создание бэкапа папки «${folderName}»...`);
  }
  try {
    const res = await fetch('/api/admin/backups/create-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_id: Number(folderId) })
    });
    const data = await res.json();
    if (res.ok) {
      const dlUrl = `/api/admin/backups/download/${encodeURIComponent(data.filename)}?folder=${encodeURIComponent(data.folder || '')}`;
      if (typeof showToast === 'function') {
        showToast(`✅ Бэкап папки «${folderName}» создан (${data.decks_count} колод, ${data.cards_count} карт.)! <a href="${dlUrl}" download class="underline font-bold text-white ml-1.5">📥 Скачать JSON</a>`, 'success');
      } else {
        alert(`Бэкап папки создан!\nФайл: ${data.filename}\nКолод: ${data.decks_count}, Карточек: ${data.cards_count}`);
      }
      if (typeof loadBackups === 'function') {
        loadBackups();
      }
    } else {
      alert(data.detail || 'Ошибка при создании бэкапа папки');
    }
  } catch (e) {
    console.error('Failed to create folder backup', e);
    alert('Ошибка сети при создании бэкапа папки');
  }
}

