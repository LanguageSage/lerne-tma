/**
 * users.js — Lerne TMA Admin Module
 */
async function loadUsers(searchQuery = '') {
      try {
        const url = searchQuery ? `/api/admin/users?search=${encodeURIComponent(searchQuery)}` : '/api/admin/users';
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const data = await res.json();
        usersData = data.users || [];
        usersStats = {
          total: data.total_count || usersData.length,
          registered: data.registered_count || 0,
          guest: data.guest_count || 0
        };

        const badge = document.getElementById('users-stats-badge');
        if (badge) {
          badge.innerHTML = `<span class="text-emerald-400 font-bold">${usersStats.registered} зарег.</span> • <span class="text-slate-400">${usersStats.guest} гостей</span> (всего ${usersStats.total})`;
        }

        renderUsersGrid(usersData);
      } catch (err) {
        console.error("Failed to load users", err);
      }
    }

function renderUsersGrid(users) {
      const grid = document.getElementById('users-grid');
      grid.innerHTML = '';

      if (users.length === 0) {
        grid.innerHTML = `<div class="p-8 text-center text-slate-500 col-span-full">Пользователи не найдены</div>`;
        return;
      }

      users.forEach(u => {
        const rawName = `${u.first_name || ''} ${u.last_name || ''}`.trim();
        const fullName = rawName || (u.username ? '@' + u.username : `User ${u.user_id}`);
        const initial = (u.first_name || u.username || 'U')[0].toUpperCase();
        const isReg = u.is_registered;

        // Avatar HTML
        let avatarHtml = '';
        if (u.photo_url) {
          avatarHtml = `
            <img src="${u.photo_url}" alt="${fullName}" class="w-12 h-12 rounded-xl object-cover border border-indigo-500/40 shadow-sm shrink-0" onerror="this.outerHTML='<div class=\\'w-12 h-12 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center font-bold text-white text-base shadow-sm shrink-0\\'>${initial}</div>'">
          `;
        } else {
          const bgGrad = isReg ? 'bg-gradient-to-tr from-indigo-600 to-purple-600 text-white' : 'bg-slate-800 text-slate-400 border border-slate-700';
          avatarHtml = `
            <div class="w-12 h-12 rounded-xl ${bgGrad} flex items-center justify-center font-bold text-base shadow-sm shrink-0">
              ${isReg ? initial : '👻'}
            </div>
          `;
        }

        const typeBadge = isReg 
          ? `<span class="px-2 py-0.5 text-[10px] font-bold rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">✅ Зарегистрирован</span>`
          : `<span class="px-2 py-0.5 text-[10px] font-semibold rounded-md bg-slate-800 text-slate-400 border border-slate-700">👻 Гость</span>`;

        grid.innerHTML += `
          <div onclick="viewUserDecks(${u.user_id}, '${fullName.replace(/'/g, "\\'")}')" 
               class="glass p-5 rounded-2xl border ${isReg ? 'border-slate-800 bg-slate-900/80 hover:border-indigo-500/60' : 'border-slate-800/60 bg-slate-950/60 hover:border-slate-700'} space-y-3.5 hover:bg-slate-900/90 transition cursor-pointer group shadow-sm relative overflow-hidden">
            
            <div class="flex items-start justify-between gap-2.5">
              <div class="flex items-center gap-3 min-w-0">
                <input type="checkbox" class="user-select-cb w-4 h-4 rounded text-indigo-600 focus:ring-0 cursor-pointer shrink-0" 
                       value="${u.user_id}" data-uid="${u.user_id}" data-name="${fullName.replace(/"/g, '&quot;')}" 
                       onchange="updateSelectedUsersCount()" onclick="event.stopPropagation()">
                ${avatarHtml}
                <div class="min-w-0">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <h4 class="font-bold text-white text-sm group-hover:text-indigo-300 transition-colors truncate max-w-[170px]" title="${fullName}">${fullName}</h4>
                  </div>
                  <p class="text-xs text-slate-400 truncate mt-0.5">${u.username ? '@' + u.username : 'без юзернейма'} • ID: <span class="font-mono text-slate-300">${u.user_id}</span></p>
                  <div class="mt-1">${typeBadge}</div>
                </div>
              </div>

              <!-- Delete single user button -->
              <button onclick="deleteSingleUserPrompt(${u.user_id}, '${fullName.replace(/'/g, "\\'")}', event)" title="Удалить пользователя" class="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition shrink-0">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            </div>

            <div class="flex justify-between items-center text-xs pt-2.5 border-t border-slate-800/80">
              <span class="text-slate-400">Колод в аккаунте:</span>
              <span class="px-2.5 py-1 bg-indigo-500/10 text-indigo-300 font-bold rounded-lg border border-indigo-500/20 flex items-center gap-1.5">
                <i data-lucide="layers" class="w-3.5 h-3.5"></i> ${u.deck_count}
              </span>
            </div>

            ${u.last_activity ? `
              <div class="text-[11px] text-slate-400 flex items-center gap-1.5">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
                <span>Активность: ${u.last_activity.split('.')[0]}</span>
              </div>
            ` : `
              <div class="text-[11px] text-slate-500 flex items-center gap-1.5">
                <span class="w-1.5 h-1.5 rounded-full bg-slate-600 inline-block"></span>
                <span>Визиты: Нет данных</span>
              </div>
            `}
          </div>
        `;
      });
      lucide.createIcons();
      updateSelectedUsersCount();
    }

function toggleSelectAllUsers(checked) {
      const cbs = document.querySelectorAll('.user-select-cb');
      cbs.forEach(cb => { cb.checked = checked; });
      updateSelectedUsersCount();
    }

function updateSelectedUsersCount() {
      const cbs = document.querySelectorAll('.user-select-cb:checked');
      const count = cbs.length;
      const toolbarEl = document.getElementById('users-table-toolbar');
      const bannerCountEl = document.getElementById('selected-users-count-banner');
      const badges = document.querySelectorAll('.selected-users-count-badge');
      const selectAllCb = document.getElementById('users-select-all');
      const allCbs = document.querySelectorAll('.user-select-cb');
      
      if (bannerCountEl) bannerCountEl.innerText = count;
      badges.forEach(b => { b.innerText = count; });

      if (toolbarEl) {
        if (count > 0) toolbarEl.classList.remove('hidden');
        else toolbarEl.classList.add('hidden');
      }
      if (selectAllCb && allCbs.length > 0) {
        selectAllCb.checked = (count === allCbs.length);
      }
    }

function clearSelectedUsers() {
      const cbs = document.querySelectorAll('.user-select-cb');
      cbs.forEach(cb => { cb.checked = false; });
      const selectAllCb = document.getElementById('users-select-all');
      if (selectAllCb) selectAllCb.checked = false;
      updateSelectedUsersCount();
    }

async function deleteSelectedUsers() {
      const cbs = document.querySelectorAll('.user-select-cb:checked');
      const userIds = Array.from(cbs)
        .map(cb => parseInt(cb.dataset.uid || cb.value, 10))
        .filter(id => !isNaN(id) && id > 0);

      if (userIds.length === 0) {
        alert("Выберите хотя бы одного пользователя для удаления!");
        return;
      }

      if (!confirm(`⚠️ Вы действительно хотите удалить ВСЕХ ${userIds.length} выбранных пользователей и все их персональные колоды, папки и прогресс?`)) {
        return;
      }

      const btn = document.getElementById('btn-delete-selected-users');
      const origHtml = btn ? btn.innerHTML : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> Удаление...`;
        lucide.createIcons();
      }

      try {
        const res = await fetch('/api/admin/users/batch-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_ids: userIds })
        });
        const data = await res.json();
        if (res.ok) {
          alert(data.message || `Успешно удалено ${userIds.length} пользователей!`);
          clearSelectedUsers();
          loadUsers();
          loadDecks();
        } else {
          alert(`Ошибка при удалении: ${data.detail || 'Не удалось удалить пользователей'}`);
        }
      } catch (err) {
        alert(`Ошибка при удалении пользователей: ${err.message}`);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = origHtml;
          lucide.createIcons();
        }
      }
    }

async function cleanupGuestAccounts() {
      if (!confirm("⚠️ Вы уверены, что хотите удалить ВСЕ гостевые (анонимные) аккаунты и их временные колоды?\n\nЗарегистрированные пользователи с реальными данными затронуты НЕ будут.")) {
        return;
      }
      try {
        const res = await fetch('/api/admin/users/guests', { method: 'DELETE' });
        const data = await res.json();
        alert(data.message || "Гостевые аккаунты успешно очищены!");
        loadUsers();
        loadDecks();
      } catch (err) {
        alert("Ошибка при очистке гостевых аккаунтов: " + err);
      }
    }

async function purgeDeletedItems() {
      if (!confirm("⚠️ Вы действительно хотите окончательно очистить все элементы, находящиеся в корзине (папки, колоды и карточки с флагом удалён)?\n\nЭто действие безвозвратно удалит удалённые записи из базы данных.")) {
        return;
      }
      try {
        const res = await fetch('/api/admin/purge-deleted', { method: 'POST' });
        const data = await res.json();
        alert(data.message || "Удалённые элементы успешно очищены!");
        loadDecks();
        loadUsers();
      } catch (err) {
        alert("Ошибка при очистке корзины: " + err);
      }
    }

async function deleteSingleUserPrompt(userId, userName, event) {
      if (event) event.stopPropagation();
      const checkedCount = document.querySelectorAll('.user-select-cb:checked').length;
      
      let confirmMsg = `⚠️ Удалить пользователя "${userName}" (ID: ${userId}) и ВСЕ его персональные колоды и прогресс?`;
      if (checkedCount > 1) {
        confirmMsg = `⚠️ Внимание: у вас отмечено галочками ${checkedCount} пользователей!\nВы нажали кнопку удаления у отдельного пользователя: "${userName}" (ID: ${userId}).\n\n(Чтобы удалить сразу ВСЕХ ${checkedCount} отмеченных пользователей, нажмите красную кнопку «Удалить ВСЕХ выбранных (${checkedCount})» на панели сверху).\n\nУдалить только этого ОДНОГО пользователя?`;
      }

      if (!confirm(confirmMsg)) {
        return;
      }
      try {
        const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
        const data = await res.json();
        alert(data.message || "Пользователь успешно удалён!");
        loadUsers();
        loadDecks();
      } catch (err) {
        alert("Ошибка при удалении пользователя: " + err);
      }
    }

function filterUsers() {
      const q = document.getElementById('user-search').value.trim();
      loadUsers(q);
    }

function viewUserDecks(userId, userName) {
      activeUserFilter = userId;
      clearDeckSelection();
      document.getElementById('user-filter-name').innerText = `${userName} (ID: ${userId})`;
      document.getElementById('user-filter-banner').classList.remove('hidden');
      switchTab('decks');
      loadDecks(userId);
    }

function clearUserFilter() {
      activeUserFilter = null;
      clearDeckSelection();
      document.getElementById('user-filter-banner').classList.add('hidden');
      document.getElementById('deck-search').value = '';
      loadDecks();
    }

