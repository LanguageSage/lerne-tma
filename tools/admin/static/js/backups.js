/**
 * backups.js — Lerne TMA Admin Module
 */
async function loadBackups() {
      try {
        const res = await fetch('/api/admin/backups');
        const data = await res.json();

        document.getElementById('backup-stat-count').innerText = `${data.total_count || 0} файлов`;
        document.getElementById('backup-stat-size').innerText = `${data.total_size_mb || 0} МБ`;
        if (data.custom_dir) {
          document.getElementById('backup-custom-dir-input').value = data.custom_dir;
        }

        const tbody = document.getElementById('backups-table-body');
        tbody.innerHTML = '';

        const backups = data.backups || [];
        if (backups.length === 0) {
          tbody.innerHTML = `<tr><td colspan="7" class="px-6 py-8 text-center text-slate-500">Бэкапы не найдены</td></tr>`;
          updateSelectedBackupsCount();
          return;
        }

        backups.forEach(b => {
          const detailStr = b.deck_name ? `Колода: <b>${b.deck_name}</b> (${b.card_count || 0} карт.)` : (b.card_count ? `Содержит: ${b.card_count} элементов` : 'Снимок базы/файлов');
          const sizeStr = b.size_mb >= 1 ? `${b.size_mb} MB` : `${b.size_kb} KB`;
          const folderName = b.folder ? `<div class="text-[10px] text-slate-500 truncate max-w-[220px]" title="${b.folder}">${b.folder}</div>` : '';
          tbody.innerHTML += `
            <tr class="hover:bg-slate-900/50 transition">
              <td class="px-4 py-4 text-center">
                <input type="checkbox" class="backup-select-cb w-4 h-4 rounded text-indigo-600 focus:ring-0 cursor-pointer" 
                       data-filename="${b.filename}" data-folder="${b.folder || ''}" 
                       onchange="updateSelectedBackupsCount()">
              </td>
              <td class="px-6 py-4 font-mono text-xs font-semibold text-white">
                <div>${b.filename}</div>
                ${folderName}
              </td>
              <td class="px-6 py-4 text-xs">
                <span class="px-2.5 py-1 text-xs font-semibold rounded-lg border ${b.type === 'Полная БД' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' : (b.type === 'Снимок карточек' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20')}">
                  ${b.type}
                </span>
              </td>
              <td class="px-6 py-4 text-xs text-slate-300">${detailStr}</td>
              <td class="px-6 py-4 text-xs font-mono text-slate-400">${sizeStr}</td>
              <td class="px-6 py-4 text-xs text-slate-400">${b.created_at}</td>
              <td class="px-6 py-4 text-right whitespace-nowrap">
                <div class="inline-flex items-center gap-2">
                  <a href="/api/admin/backups/download/${encodeURIComponent(b.filename)}?folder=${encodeURIComponent(b.folder || '')}" download class="px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 text-xs font-medium rounded-lg border border-indigo-500/20 inline-flex items-center gap-1.5 transition">
                    <i data-lucide="download" class="w-3.5 h-3.5"></i> Скачать
                  </a>
                  <button onclick="deleteBackupFile('${encodeURIComponent(b.filename)}', '${encodeURIComponent(b.folder || '')}')" class="px-3 py-1.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 text-xs font-medium rounded-lg border border-rose-500/20 inline-flex items-center gap-1.5 transition">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i> Удалить
                  </button>
                </div>
              </td>
            </tr>
          `;
        });
        lucide.createIcons();
        updateSelectedBackupsCount();
      } catch (e) {
        console.error("Failed to load backups", e);
      }
    }

function toggleSelectAllBackups(checked) {
      const cbs = document.querySelectorAll('.backup-select-cb');
      cbs.forEach(cb => { cb.checked = checked; });
      updateSelectedBackupsCount();
    }

function updateSelectedBackupsCount() {
      const cbs = document.querySelectorAll('.backup-select-cb:checked');
      const count = cbs.length;
      const countDl = document.getElementById('selected-backups-count-dl');
      const countDel = document.getElementById('selected-backups-count-del');
      const bannerCountEl = document.getElementById('selected-backups-count-banner');
      const badges = document.querySelectorAll('.selected-backups-count-badge');
      const actionsEl = document.getElementById('backups-bulk-actions');
      const toolbarEl = document.getElementById('backups-table-toolbar');
      const selectAllCb = document.getElementById('backups-select-all');
      const allCbs = document.querySelectorAll('.backup-select-cb');

      if (countDl) countDl.innerText = count;
      if (countDel) countDel.innerText = count;
      if (bannerCountEl) bannerCountEl.innerText = count;
      badges.forEach(b => { b.innerText = count; });

      if (actionsEl) {
        if (count > 0) actionsEl.classList.remove('hidden');
        else actionsEl.classList.add('hidden');
      }
      if (toolbarEl) {
        if (count > 0) toolbarEl.classList.remove('hidden');
        else toolbarEl.classList.add('hidden');
      }
      if (selectAllCb && allCbs.length > 0) {
        selectAllCb.checked = (count === allCbs.length);
      }
    }

function clearSelectedBackups() {
      const cbs = document.querySelectorAll('.backup-select-cb');
      cbs.forEach(cb => { cb.checked = false; });
      const selectAllCb = document.getElementById('backups-select-all');
      if (selectAllCb) selectAllCb.checked = false;
      updateSelectedBackupsCount();
    }

async function downloadSelectedBackups() {
      const cbs = document.querySelectorAll('.backup-select-cb:checked');
      if (cbs.length === 0) return;

      const items = Array.from(cbs).map(cb => ({
        filename: cb.dataset.filename,
        folder: cb.dataset.folder || ''
      }));

      // Trigger sequential browser downloads
      items.forEach((item, index) => {
        setTimeout(() => {
          const folderParam = item.folder ? `?folder=${encodeURIComponent(item.folder)}` : '';
          const link = document.createElement('a');
          link.href = `/api/admin/backups/download/${encodeURIComponent(item.filename)}${folderParam}`;
          link.download = item.filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }, index * 300);
      });
    }

async function deleteSelectedBackups() {
      const cbs = document.querySelectorAll('.backup-select-cb:checked');
      if (cbs.length === 0) return;

      const items = Array.from(cbs).map(cb => ({
        filename: cb.dataset.filename,
        folder: cb.dataset.folder || ''
      }));

      if (!confirm(`⚠️ Вы действительно хотите безвозвратно удалить ВСЕ ${items.length} выбранных файлов бэкапа?`)) {
        return;
      }

      try {
        const res = await fetch('/api/admin/backups/batch-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ backups: items })
        });
        const data = await res.json();
        if (res.ok) {
          alert(`Успешно удалено ${data.deleted_count || items.length} файлов бэкапов!`);
          clearSelectedBackups();
          loadBackups();
        } else {
          alert(`Ошибка при удалении: ${data.detail || 'Не удалось удалить выбранные файлы'}`);
        }
      } catch (err) {
        alert(`Ошибка при удалении бэкапов: ${err.message}`);
      }
    }

async function deleteBackupFile(encodedFilename, encodedFolder) {
      const filename = decodeURIComponent(encodedFilename);
      const folder = decodeURIComponent(encodedFolder);
      const checkedCount = document.querySelectorAll('.backup-select-cb:checked').length;
      
      let confirmMsg = `Вы действительно хотите удалить бэкап?\n\nФайл: ${filename}\nПапка: ${folder || 'по умолчанию'}`;
      if (checkedCount > 1) {
        confirmMsg = `⚠️ Внимание: у вас отмечено галочками ${checkedCount} файлов!\nВы нажали «Удалить» у отдельной строки: "${filename}".\n\n(Чтобы удалить сразу ВСЕ ${checkedCount} выбранных файлов, нажмите красную кнопку «Удалить ВСЕ выбранные (${checkedCount})» на панели над таблицей).\n\nУдалить только этот ОДИН файл?`;
      }

      if (!confirm(confirmMsg)) {
        return;
      }
      try {
        const folderParam = folder ? `?folder=${encodeURIComponent(folder)}` : '';
        const res = await fetch(`/api/admin/backups/${encodeURIComponent(filename)}${folderParam}`, {
          method: 'DELETE'
        });
        const data = await res.json();
        if (res.ok) {
          loadBackups();
        } else {
          alert(`Ошибка при удалении: ${data.detail || 'Не удалось удалить файл'}`);
        }
      } catch (e) {
        alert(`Ошибка при удалении бэкапа: ${e.message}`);
      }
    }

async function saveBackupSettings() {
      const customDir = document.getElementById('backup-custom-dir-input').value.trim();
      try {
        const res = await fetch('/api/admin/backups/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ custom_dir: customDir })
        });
        const data = await res.json();
        alert(`Путь локальной папки сохранен: ${data.custom_backup_dir || 'по умолчанию'}`);
        loadBackups();
      } catch (e) {
        alert("Ошибка при сохранении пути к папке!");
      }
    }

async function triggerCreateFullBackup() {
      if (!confirm("Создать полный снимок резервной копии всей базы данных?")) return;
      try {
        const res = await fetch('/api/admin/backups/create', { method: 'POST' });
        const data = await res.json();
        alert(`Полная резервная копия успешно создана!\nФайл: ${data.filename}\nПапка: ${data.folder || 'по умолчанию'}\nКарточек: ${data.cards_count}, Колод: ${data.decks_count}, Пользователей: ${data.users_count}`);
        loadBackups();
      } catch (e) {
        alert("Ошибка при создании бэкапа!");
      }
    }

    // ==========================================
    // DECK PREVIEW & INTERACTIVE CARDS MANAGER
    // ==========================================
    let previewDeckId = null;
    let previewDeckData = null;
    let previewCardsList = [];

