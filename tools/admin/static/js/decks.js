/**
 * decks.js — Lerne TMA Admin Module
 */
function toggleDeckRowSelection(deckId, checked) {
      const sId = String(deckId);
      if (checked) {
        selectedDeckIds.add(sId);
      } else {
        selectedDeckIds.delete(sId);
      }
      updateDeckSelectionUI();
    }

function toggleSelectAllDeckRows(checked) {
      const startIdx = (currentDeckPage - 1) * deckPageSize;
      const pageDecks = currentRenderedDecks.slice(startIdx, startIdx + deckPageSize);
      pageDecks.forEach(d => {
        const sId = String(d.id);
        if (checked) {
          selectedDeckIds.add(sId);
        } else {
          selectedDeckIds.delete(sId);
        }
      });
      document.querySelectorAll('.deck-row-checkbox').forEach(cb => {
        cb.checked = selectedDeckIds.has(String(cb.value));
      });
      updateDeckSelectionUI();
    }

function clearDeckSelection() {
      selectedDeckIds.clear();
      document.querySelectorAll('.deck-row-checkbox').forEach(cb => cb.checked = false);
      const selectAll = document.getElementById('deck-table-select-all');
      if (selectAll) selectAll.checked = false;
      updateDeckSelectionUI();
    }

function updateDeckSelectionUI() {
      const count = selectedDeckIds.size;

      // Update Bulk Action Toolbar & Count Badges
      const actionsBar = document.getElementById('deck-table-bulk-actions');
      document.querySelectorAll('.selected-table-count').forEach(el => el.innerText = count);
      if (actionsBar) {
        if (count > 0) actionsBar.classList.remove('hidden');
        else actionsBar.classList.add('hidden');
      }

      // Update Staging Button
      const btnStage = document.getElementById('btn-stage-selected');
      const countEl = document.getElementById('selected-table-decks-count');
      if (countEl) countEl.innerText = count;
      if (btnStage) {
        if (count > 0) btnStage.classList.remove('hidden');
        else btnStage.classList.add('hidden');
      }

      // Update Select-All Checkbox for Current Page
      const selectAll = document.getElementById('deck-table-select-all');
      if (selectAll) {
        const startIdx = (currentDeckPage - 1) * deckPageSize;
        const pageDecks = currentRenderedDecks.slice(startIdx, startIdx + deckPageSize);
        if (pageDecks.length > 0 && pageDecks.every(d => selectedDeckIds.has(String(d.id)))) {
          selectAll.checked = true;
        } else {
          selectAll.checked = false;
        }
      }
    }

    // Alias for any existing inline handlers

function onDeckRowCheckboxChange() {
      updateDeckSelectionUI();
    }

async function loadDecks(userIdFilter = null) {
      try {
        const uid = userIdFilter || activeUserFilter;
        const url = uid ? `/api/admin/decks?user_id=${uid}` : '/api/admin/decks';
        const res = await fetch(url);
        const data = await res.json();
        decksData = data.decks || [];
        renderDecksTable(decksData);
        loadAdminFolders();
      } catch (err) {
        console.error("Failed to load decks", err);
      }
    }

    let currentDeckPage = 1;
    const deckPageSize = 40;
    let currentRenderedDecks = [];

async function loadDecksSilent() {
      try {
        // Protect user selection: if user has any active selections, do NOT silently re-render!
        if (selectedDeckIds.size > 0) return;

        const uid = activeUserFilter;
        const url = uid ? `/api/admin/decks?user_id=${uid}` : '/api/admin/decks';
        const res = await fetch(url);
        const data = await res.json();
        decksData = data.decks || [];
        filterDecks(false);
      } catch (e) {
        // silent
      }
    }

function renderDecksTable(decks, resetPage = false) {
      currentRenderedDecks = decks || [];
      if (resetPage) currentDeckPage = 1;

      const total = currentRenderedDecks.length;
      const totalPages = Math.ceil(total / deckPageSize) || 1;
      if (currentDeckPage > totalPages) currentDeckPage = 1;

      const startIdx = (currentDeckPage - 1) * deckPageSize;
      const pageDecks = currentRenderedDecks.slice(startIdx, startIdx + deckPageSize);

      const tbody = document.getElementById('decks-table-body');
      
      if (total === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="px-6 py-8 text-center text-slate-500">Колоды не найдены</td></tr>`;
        document.getElementById('deck-pagination-info').innerText = 'Колод нет';
        document.getElementById('deck-page-indicator').innerText = 'Стр 1 из 1';
        document.getElementById('btn-deck-prev').disabled = true;
        document.getElementById('btn-deck-next').disabled = true;
        return;
      }

      const rows = pageDecks.map(d => {
        const isDef = d.is_default;
        const safeName = (d.name || "").replace(/'/g, "\\'");
        
        // Health badge (Interactive 1-click triggers)
        let healthBadge = '';
        if (d.card_count === 0) {
          healthBadge = '<span class="px-2 py-0.5 bg-slate-800 text-slate-400 font-medium rounded-md text-[11px]">⚪ Пустая</span>';
        } else if (d.health_status === 'ready') {
          healthBadge = '<span class="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 font-bold rounded-md border border-emerald-500/20 text-[11px]">✅ Готова</span>';
        } else if (d.health_status === 'needs_audio') {
          healthBadge = `<button type="button" onclick="openRegenModal('${d.id}', '${safeName}', 'audio_only')" class="px-2 py-0.5 bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 font-bold rounded-md border border-amber-500/30 text-[11px] transition inline-flex items-center gap-1 cursor-pointer" title="Нажмите, чтобы быстро озвучить ${d.missing_audio_count} карточек">⚠️ ${d.missing_audio_count} без звука ▶</button>`;
        } else if (d.health_status === 'needs_ai') {
          healthBadge = `<button type="button" onclick="openRegenModal('${d.id}', '${safeName}', 'context_only')" class="px-2 py-0.5 bg-purple-500/15 hover:bg-purple-500/30 text-purple-300 font-bold rounded-md border border-purple-500/30 text-[11px] transition inline-flex items-center gap-1 cursor-pointer" title="Нажмите, чтобы быстро сгенерировать контекст для ${d.missing_context_count} карточек">⚠️ ${d.missing_context_count} без контекста ✨</button>`;
        } else {
          healthBadge = '<span class="px-2 py-0.5 bg-slate-800 text-slate-400 rounded-md text-[11px]">Готова</span>';
        }

        // Owner Cell
        let ownerCell = '';
        if (d.is_library) {
          ownerCell = `<span class="px-2.5 py-1 bg-amber-500/10 text-amber-300 font-bold rounded-lg border border-amber-500/20 text-xs inline-flex items-center gap-1">⭐ Библиотека</span>`;
        } else {
          const safeOwnerName = (d.user_name || `User ${d.user_id}`).replace(/'/g, "\\'");
          const uInit = (d.user_name || 'U')[0].toUpperCase();
          const avatarMini = d.user_photo 
            ? `<img src="${d.user_photo}" class="w-5 h-5 rounded-full object-cover border border-indigo-500/40 inline-block shrink-0" onerror="this.outerHTML='<span class=\\'w-5 h-5 rounded-full bg-indigo-600 text-white font-bold text-[10px] inline-flex items-center justify-center shrink-0\\'>${uInit}</span>'">`
            : `<span class="w-5 h-5 rounded-full ${d.user_is_guest ? 'bg-slate-800 text-slate-400' : 'bg-indigo-600 text-white'} font-bold text-[10px] inline-flex items-center justify-center shrink-0">${d.user_is_guest ? '👻' : uInit}</span>`;

          ownerCell = `
            <button onclick="viewUserDecks('${d.user_id}', '${safeOwnerName}')" title="Показать все колоды пользователя ${safeOwnerName} (ID: ${d.user_id})" class="hover:text-indigo-300 transition inline-flex items-center gap-1.5 text-xs text-left max-w-[180px] truncate group">
              ${avatarMini}
              <span class="font-medium text-slate-200 group-hover:underline truncate">${d.user_name || 'User #' + d.user_id}</span>
              ${d.user_is_guest ? '<span class="text-[10px] text-slate-500">(гость)</span>' : ''}
            </button>
          `;
        }

        const isDeckChecked = selectedDeckIds.has(String(d.id));

        return `
          <tr class="hover:bg-slate-900/50 transition">
            <td class="px-4 py-3.5 text-center">
              <input type="checkbox" class="deck-row-checkbox w-4 h-4 text-indigo-600 rounded cursor-pointer" value="${d.id}" ${isDeckChecked ? 'checked' : ''} onchange="toggleDeckRowSelection('${d.id}', this.checked)">
            </td>
            <td class="px-4 py-3.5 font-mono text-xs text-slate-400">#${d.id}</td>
            <td class="px-6 py-3.5 font-bold text-white">
              <button onclick="openDeckPreviewModal('${d.id}', '${safeName}')" class="hover:text-indigo-400 transition text-left font-bold underline decoration-slate-700 hover:decoration-indigo-400">
                ${d.name}
              </button>
            </td>
            <td class="px-4 py-3.5 text-xs font-mono text-slate-400">
              ${ownerCell}
            </td>
            <td class="px-4 py-3.5 text-xs">
              <span class="uppercase font-bold text-indigo-400">${d.target_language}</span>
              ${d.level ? `<span class="ml-1 text-slate-500">(${d.level})</span>` : ''}
            </td>
            <td class="px-4 py-3.5 font-semibold">${d.card_count}</td>
            <td class="px-4 py-3.5">
              ${healthBadge}
            </td>
            <td class="px-4 py-3.5">
              <button onclick="toggleDefaultDeck('${d.id}', ${!isDef})" class="px-2.5 py-1 text-xs font-semibold rounded-lg border transition ${isDef ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-slate-800 text-slate-400 border-slate-700'}">
                ${isDef ? '★ Дефолтная' : '☆ Обычная'}
              </button>
            </td>
            <td class="px-6 py-3.5 text-right space-x-1">
              <button onclick="openDeckPreviewModal('${d.id}', '${safeName}')" title="👁️ Предосмотр и проверка колоды" class="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg border border-slate-700 transition inline-flex items-center gap-1">
                <i data-lucide="eye" class="w-3.5 h-3.5"></i>
              </button>
              <button onclick="openRegenModal('${d.id}', '${safeName}', 'context_only')" title="✨ Догенерировать контекст" class="px-2.5 py-1 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 text-xs font-semibold rounded-lg border border-purple-500/20 transition inline-flex items-center gap-1">
                <i data-lucide="sparkles" class="w-3.5 h-3.5"></i> Контекст
              </button>
              <button onclick="openRegenModal('${d.id}', '${safeName}', 'audio_only')" title="🎙️ Озвучить колоду (TTS)" class="px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 text-xs font-semibold rounded-lg border border-emerald-500/20 transition inline-flex items-center gap-1">
                <i data-lucide="mic" class="w-3.5 h-3.5"></i> Звук
              </button>
              <button onclick="createDeckBackup('${d.id}', '${safeName}')" title="💾 Создать точечный бэкап колоды" class="px-2.5 py-1 bg-teal-600/20 hover:bg-teal-600/30 text-teal-300 text-xs font-semibold rounded-lg border border-teal-500/20 transition inline-flex items-center gap-1">
                <i data-lucide="save" class="w-3.5 h-3.5"></i> Бэкап
              </button>
              <button onclick="openAssignModal('${d.id}', '${safeName}')" title="👥 Раздать колоду" class="px-2.5 py-1 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 text-xs font-medium rounded-lg border border-indigo-500/20 transition">
                👥
              </button>
              <button onclick="promoteToLibrary('deck', '${d.id}', '${safeName}')" title="⭐ В Библиотеку" class="px-2.5 py-1 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 text-xs font-bold rounded-lg border border-amber-500/30 transition">
                ⭐
              </button>
              <button onclick="overwriteAllUsers('deck', '${d.id}', '${safeName}')" title="🔄 Обновить у всех (полная замена)" class="px-2.5 py-1 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 text-xs font-bold rounded-lg border border-cyan-500/30 transition">
                🔄
              </button>
              <button onclick="openCollaborativeModal('deck', '${d.id}', '${safeName}')" title="🤝 Сделать совместной" class="px-2.5 py-1 bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 text-xs font-bold rounded-lg border border-violet-500/30 transition">
                🤝
              </button>
              <button onclick="deduplicateDeck('${d.id}', '${safeName}')" title="🧹 Очистить дубликаты" class="px-2 py-1 text-amber-400 hover:bg-amber-500/10 rounded-lg text-xs transition">
                <i data-lucide="sparkles" class="w-3.5 h-3.5 inline"></i>
              </button>
              <button onclick="deleteDeck('${d.id}')" title="Удалить колоду" class="px-2 py-1 text-rose-400 hover:bg-rose-500/10 rounded-lg text-xs">
                <i data-lucide="trash-2" class="w-3.5 h-3.5 inline"></i>
              </button>
            </td>
          </tr>
        `;
      });

      tbody.innerHTML = rows.join('');
      lucide.createIcons();
      updateDeckSelectionUI();

      const endIdx = Math.min(startIdx + deckPageSize, total);
      document.getElementById('deck-pagination-info').innerText = `Показано ${startIdx + 1}–${endIdx} из ${total} колод`;
      document.getElementById('deck-page-indicator').innerText = `Стр ${currentDeckPage} из ${totalPages}`;
      document.getElementById('btn-deck-prev').disabled = (currentDeckPage <= 1);
      document.getElementById('btn-deck-next').disabled = (currentDeckPage >= totalPages);
    }

function changeDeckPage(delta) {
      const totalPages = Math.ceil(currentRenderedDecks.length / deckPageSize) || 1;
      currentDeckPage += delta;
      if (currentDeckPage < 1) currentDeckPage = 1;
      if (currentDeckPage > totalPages) currentDeckPage = totalPages;
      renderDecksTable(currentRenderedDecks);
    }

function filterDecks(resetPage = true) {
      const q = (document.getElementById('deck-search')?.value || '').toLowerCase().trim();
      if (!q) {
        renderDecksTable(decksData, resetPage);
        return;
      }

      const filtered = decksData.filter(d => 
        d.name.toLowerCase().includes(q) || 
        String(d.id).includes(q) || 
        String(d.user_id).includes(q) || 
        (d.target_language && d.target_language.toLowerCase().includes(q))
      );
      renderDecksTable(filtered, resetPage);
    }

async function toggleDefaultDeck(deckId, newDefault) {
      if (!newDefault) {
        if (!confirm('Снять отметку дефолтной колоды? (Она больше не будет автоматически добавляться новым пользователям)')) return;
        try {
          const res = await fetch(`/api/admin/decks/${deckId}/set-default`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_default: false, copy_to_existing: false })
          });
          const data = await res.json();
          const target = decksData.find(d => String(d.id) === String(deckId));
          if (target) target.is_default = false;
          filterDecks();
          alert(data.message || 'Отметка дефолтной снята.');
        } catch (err) {
          alert('Ошибка при снятии статуса: ' + err);
        }
        return;
      }

      const copyToExisting = confirm(
        '🌟 Сделать колоду ДЕФОЛТНОЙ (стартовой)?\n\n' +
        '• Колода автоматически добавится в Библиотеку и будет выдаваться ВСЕМ новым пользователям.\n\n' +
        'Нажмите "ОК", чтобы также СКОПИРОВАТЬ эту колоду ВСЕМ существующим пользователям прямо сейчас.\n' +
        'Нажмите "Отмена", если хотите сделать её дефолтной только для будущих новых пользователей.'
      );

      try {
        const res = await fetch(`/api/admin/decks/${deckId}/set-default`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_default: true, copy_to_existing: copyToExisting })
        });
        const data = await res.json();
        const target = decksData.find(d => String(d.id) === String(deckId));
        if (target) target.is_default = true;
        filterDecks();
        alert(data.message || `Колода успешно сделана дефолтной! Скопирована ${data.copied_to_users || 0} пользователям.`);
      } catch (err) {
        alert('Ошибка при изменении статуса: ' + err);
      }
    }

async function deduplicateDeck(deckId, deckName) {
      if (!confirm(`Очистить дубликаты карточек в колоде "${deckName}"?`)) return;
      try {
        const res = await fetch(`/api/admin/decks/${deckId}/deduplicate`, { method: 'POST' });
        const data = await res.json();
        alert(data.message || 'Дубликаты успешно удалены!');
        loadDecks();
      } catch (err) {
        alert('Ошибка при очистке дубликатов: ' + err);
      }
    }

    let decksAutoRefreshInterval = null;

function toggleDecksAutoRefresh() {
      const isEnabled = document.getElementById('decks-auto-refresh').checked;
      if (isEnabled) {
        startDecksAutoRefresh();
      } else {
        clearInterval(decksAutoRefreshInterval);
        decksAutoRefreshInterval = null;
      }
    }

function startDecksAutoRefresh() {
      if (decksAutoRefreshInterval) clearInterval(decksAutoRefreshInterval);
      decksAutoRefreshInterval = setInterval(() => {
        const regenOpen = !document.getElementById('content-ai').classList.contains('hidden');
        const assignOpen = !document.getElementById('modal-assign').classList.contains('hidden');
        if (!regenOpen && !assignOpen) {
          loadDecksSilent();
        }
      }, 15000);
    }

async function deleteDeck(deckId) {
      if (!confirm(`Удалить колоду #${deckId}?`)) return;
      try {
        const res = await fetch(`/api/admin/decks/${deckId}`, { method: 'DELETE' });
        if (res.ok) {
          removeStagedDeck(deckId);
          selectedDeckIds.delete(String(deckId));
          updateDeckSelectionUI();
          loadDecks();
        } else {
          const err = await res.json();
          alert("Ошибка при удалении колоды: " + (err.detail || "Неизвестная ошибка"));
        }
      } catch (err) {
        alert("Ошибка сети при удалении колоды: " + err);
      }
    }

async function deleteSelectedDecks() {
      const deckIds = Array.from(selectedDeckIds);
      if (deckIds.length === 0) {
        alert("Выберите хотя бы одну колоду чекбоксом!");
        return;
      }
      if (!confirm(`Вы действительно хотите удалить ${deckIds.length} выбранных колод и все карточки в них?`)) return;

      try {
        const res = await fetch('/api/admin/decks/batch-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deck_ids: deckIds })
        });
        const data = await res.json();
        if (res.ok) {
          deckIds.forEach(id => {
            removeStagedDeck(id);
            selectedDeckIds.delete(String(id));
          });
          clearDeckSelection();
          loadDecks();
        } else {
          alert("Ошибка при массовом удалении колод: " + (data.detail || "Неизвестная ошибка"));
        }
      } catch (err) {
        alert("Сетевая ошибка при удалении колод: " + err);
      }
    }

function selectAllAssignUsers(checked) {
      document.querySelectorAll('input[name="assign-user"]').forEach(cb => cb.checked = checked);
    }

function openAssignModal(deckId, deckName) {
      activeAssignDeckId = deckId;
      document.getElementById('modal-assign-title').innerText = `Раздать: ${deckName}`;
      
      const container = document.getElementById('modal-assign-users-list');
      container.innerHTML = '';

      usersData.forEach(u => {
        container.innerHTML += `
          <label class="flex items-center gap-3 p-2 hover:bg-slate-900 rounded-lg cursor-pointer">
            <input type="checkbox" name="assign-user" value="${u.user_id}" class="w-4 h-4 text-indigo-600 rounded">
            <span class="text-xs text-slate-200 font-medium">${u.first_name || ''} (@${u.username || 'no_user'}) — ID: ${u.user_id}</span>
          </label>
        `;
      });

      document.getElementById('modal-assign').classList.remove('hidden');
    }

async function submitAssignDeck() {
      const mode = document.querySelector('input[name="assign-mode"]:checked').value;
      const selectedUsers = Array.from(document.querySelectorAll('input[name="assign-user"]:checked')).map(cb => parseInt(cb.value));

      if (mode === 'default_all') {
        if (!confirm("🌟 Сделать эту колоду ДЕФОЛТНОЙ для ВСЕХ пользователей?\n\n• Она будет добавлена в Библиотеку для ВСЕХ будущих новых пользователей.\n• Копии колоды будут автоматически добавлены ВСЕМ существующим пользователям прямо сейчас.")) {
          return;
        }
      } else if (mode !== 'library' && selectedUsers.length === 0) {
        alert("Выберите хотя бы одного пользователя для раздачи (или выберите режим 'Для ВСЕХ')!");
        return;
      }

      try {
        const res = await fetch(`/api/admin/decks/${activeAssignDeckId}/assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_ids: selectedUsers, mode: mode })
        });

        const data = await res.json();
        closeModal('modal-assign');
        alert(data.message || `Операция успешно выполнена!`);
        loadDecks();
      } catch (err) {
        alert("Ошибка при назначении колоды: " + err);
      }
    }

    let foldersData = [];
    let activeAssignFolderId = null;
    let folderFilterMode = 'all';
    let folderUserFilter = null;

function filterLibraryDecks() {
      const libraryDecks = decksData.filter(d => d.is_default);
      renderDecksTable(libraryDecks, true);
      document.getElementById('user-filter-name').innerText = `⭐ Колоды Библиотеки (${libraryDecks.length})`;
      document.getElementById('user-filter-banner').classList.remove('hidden');
    }

async function promoteToLibrary(entityType, entityId, entityName) {
      const label = entityType === 'folder' ? 'папку' : 'колоду';
      if (!confirm(`⭐ Добавить ${label} «${entityName}» в Мастер-Библиотеку?\n\nЕсли она уже есть в библиотеке — карточки будут заменены.`)) return;
      try {
        const endpoint = entityType === 'folder'
          ? `/api/admin/folders/${entityId}/to-library`
          : `/api/admin/decks/${entityId}/to-library`;
        const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const data = await res.json();
        alert(data.message || `${label} успешно добавлена в Библиотеку!`);
        if (entityType === 'folder') loadAdminFolders(); else loadDecks();
      } catch (err) {
        alert('Ошибка: ' + err);
      }
    }

    // ── New: Overwrite All Users (1-click) ────────────────────────────────────

async function overwriteAllUsers(entityType, entityId, entityName) {
      const label = entityType === 'folder' ? 'папку' : 'колоду';
      if (!confirm(`🔄 Полностью заменить ${label} «${entityName}» у всех пользователей, у которых она есть?\n\n⚠️ Это удалит весь прогресс обучения (SRS) пользователей по этой ${label}!\n\nПродолжить?`)) return;
      try {
        const endpoint = entityType === 'folder'
          ? `/api/admin/folders/${entityId}/overwrite-users`
          : `/api/admin/decks/${entityId}/overwrite-users`;
        const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const data = await res.json();
        alert(data.message || `Обновление выполнено для ${data.users_processed || 0} пользователей.`);
        if (entityType === 'folder') loadAdminFolders(); else loadDecks();
      } catch (err) {
        alert('Ошибка: ' + err);
      }
    }

    // ── New: Collaborative Modal ──────────────────────────────────────────────
    let activeCollaborativeType = null;
    let activeCollaborativeId = null;

function openCollaborativeModal(entityType, entityId, entityName) {
      activeCollaborativeType = entityType;
      activeCollaborativeId = entityId;
      const label = entityType === 'folder' ? 'папку' : 'колоду';
      document.getElementById('modal-collaborative-title').innerText = `🤝 Сделать ${label} совместной: ${entityName}`;

      // Reset form
      document.querySelector('input[name="collab-audience"][value="existing_copies"]').checked = true;
      document.querySelector('input[name="collab-role"][value="viewer"]').checked = true;
      document.getElementById('collab-delete-copies').checked = true;
      document.getElementById('collab-notify').checked = false;

      // Build user list for manual selection
      const container = document.getElementById('collab-users-list');
      container.innerHTML = '';
      (usersData || []).forEach(u => {
        container.innerHTML += `
          <label class="flex items-center gap-3 p-2 hover:bg-slate-900 rounded-lg cursor-pointer">
            <input type="checkbox" name="collab-user" value="${u.user_id}" class="w-4 h-4 text-violet-600 rounded">
            <span class="text-xs text-slate-200 font-medium">${u.first_name || ''} (@${u.username || 'no_user'}) — ID: ${u.user_id}</span>
          </label>
        `;
      });
      updateCollabUsersVisibility();
      document.getElementById('modal-collaborative').classList.remove('hidden');
    }

function updateCollabUsersVisibility() {
      const audience = document.querySelector('input[name="collab-audience"]:checked')?.value;
      const usersSection = document.getElementById('collab-users-section');
      if (usersSection) {
        usersSection.classList.toggle('hidden', audience !== 'selected');
      }
    }

async function submitCollaborative() {
      const audience = document.querySelector('input[name="collab-audience"]:checked')?.value || 'existing_copies';
      const role = document.querySelector('input[name="collab-role"]:checked')?.value || 'viewer';
      const deleteExisting = document.getElementById('collab-delete-copies')?.checked ?? true;
      const notify = document.getElementById('collab-notify')?.checked ?? false;
      const selectedUsers = Array.from(document.querySelectorAll('input[name="collab-user"]:checked')).map(cb => parseInt(cb.value));

      if (audience === 'selected' && selectedUsers.length === 0) {
        alert('Выберите хотя бы одного пользователя!');
        return;
      }

      const deleteWarning = deleteExisting ? '\n⚠️ Личные копии у выбранных пользователей будут УДАЛЕНЫ.' : '';
      if (!confirm(`🤝 Открыть совместный доступ (роль: ${role}, аудитория: ${audience})?${deleteWarning}\n\nПрогресс обучения по удалённым копиям будет утерян. Продолжить?`)) return;

      try {
        const endpoint = activeCollaborativeType === 'folder'
          ? `/api/admin/folders/${activeCollaborativeId}/assign`
          : `/api/admin/decks/${activeCollaborativeId}/assign`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'collaborate',
            target_audience: audience,
            collaborator_role: role,
            delete_existing_copies: deleteExisting,
            notify_telegram: notify,
            user_ids: selectedUsers
          })
        });
        const data = await res.json();
        closeModal('modal-collaborative');
        alert(data.message || `Совместный доступ выдан!`);
        if (activeCollaborativeType === 'folder') loadAdminFolders(); else loadDecks();
      } catch (err) {
        alert('Ошибка: ' + err);
      }
    }


/**
 * Sets quick health filter for decks (chips: all, missing_audio, missing_context, empty, default, library).
 */
function setDeckHealthFilter(filterType) {
  deckHealthFilter = filterType;
  document.querySelectorAll('.deck-filter-chip').forEach(btn => {
    if (btn.dataset.filter === filterType) {
      btn.className = 'deck-filter-chip px-2.5 py-1 rounded font-semibold transition bg-indigo-600 text-white shadow-sm';
    } else {
      btn.className = 'deck-filter-chip px-2.5 py-1 rounded font-semibold transition text-slate-400 hover:text-white';
    }
  });
  filterDecks();
}


/**
 * Creates a standalone JSON backup of a single deck and offers instant download / explore.
 */
async function createDeckBackup(deckId, deckName) {
  if (typeof showToast === 'function') {
    showToast(`⏳ Создание бэкапа колоды «${deckName}»...`);
  }
  try {
    const res = await fetch('/api/admin/backups/create-deck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deck_id: String(deckId) })
    });
    const data = await res.json();
    if (res.ok) {
      const dlUrl = `/api/admin/backups/download/${encodeURIComponent(data.filename)}?folder=${encodeURIComponent(data.folder || '')}`;
      if (typeof showToast === 'function') {
        showToast(`✅ Бэкап «${deckName}» создан (${data.cards_count} карт.)! <a href="${dlUrl}" download class="underline font-bold text-white ml-1.5">📥 Скачать JSON</a>`, 'success');
      } else {
        alert(`Бэкап колоды создан!\nФайл: ${data.filename}\nКарточек: ${data.cards_count}`);
      }
      if (typeof loadBackups === 'function') {
        loadBackups();
      }
    } else {
      alert(data.detail || 'Ошибка при создании бэкапа колоды');
    }
  } catch (e) {
    console.error('Failed to create deck backup', e);
    alert('Ошибка сети при создании бэкапа колоды');
  }
}
