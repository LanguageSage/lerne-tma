/**
 * media_manager.js — Lerne TMA Admin Media & Images Gallery Module
 */

let mediaCurrentFilter = 'orphaned';
let mediaCurrentQuery = '';
let mediaCurrentPage = 1;
const mediaPageLimit = 48;
let mediaSelectedFilenames = new Set();
let mediaSearchTimeout = null;
let isMediaManagerInitialized = false;

function initMediaManager() {
  if (!isMediaManagerInitialized) {
    isMediaManagerInitialized = true;
    const searchInput = document.getElementById('media-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        clearTimeout(mediaSearchTimeout);
        mediaSearchTimeout = setTimeout(() => {
          mediaCurrentQuery = e.target.value.trim();
          mediaCurrentPage = 1;
          loadMediaCatalog(1, false);
        }, 300);
      });
    }
  }
  loadMediaCatalog(mediaCurrentPage, false);
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

async function loadMediaCatalog(page = 1, forceRefresh = false) {
  mediaCurrentPage = page;
  const gridEl = document.getElementById('media-grid-container');
  const paginationEl = document.getElementById('media-pagination');
  const refreshBtn = document.getElementById('btn-media-refresh');

  if (refreshBtn && forceRefresh) {
    refreshBtn.classList.add('animate-spin');
  }

  if (gridEl) {
    gridEl.innerHTML = `
      <div class="col-span-full py-16 flex flex-col items-center justify-center text-slate-400 gap-3">
        <div class="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
        <p class="text-sm font-medium">Загрузка каталога картинок...</p>
      </div>
    `;
  }

  try {
    const url = `/api/admin/media/images?filter=${encodeURIComponent(mediaCurrentFilter)}&q=${encodeURIComponent(mediaCurrentQuery)}&page=${page}&limit=${mediaPageLimit}&refresh=${forceRefresh ? 'true' : 'false'}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Ошибка ответа сервера: ' + res.status);
    const data = await res.json();

    renderMediaStats(data.stats);
    renderMediaGrid(data.items);
    renderMediaPagination(data.total, data.page, data.pages, data.limit);
    updateMediaSelectionUI();
  } catch (err) {
    console.error('Error loading media catalog:', err);
    if (gridEl) {
      gridEl.innerHTML = `
        <div class="col-span-full py-12 text-center text-rose-400">
          <p class="font-bold">Не удалось загрузить картинки</p>
          <p class="text-xs text-slate-400 mt-1">${err.message}</p>
          <button onclick="loadMediaCatalog(1, true)" class="mt-4 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-xl border border-slate-700">Повторить</button>
        </div>
      `;
    }
  } finally {
    if (refreshBtn) {
      refreshBtn.classList.remove('animate-spin');
    }
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }
}

function renderMediaStats(stats) {
  if (!stats) return;
  const totalCountEl = document.getElementById('media-stat-total-count');
  const totalSizeEl = document.getElementById('media-stat-total-size');
  const orphanedCountEl = document.getElementById('media-stat-orphaned-count');
  const orphanedSizeEl = document.getElementById('media-stat-orphaned-size');
  const activeCountEl = document.getElementById('media-stat-active-count');
  const activeSizeEl = document.getElementById('media-stat-active-size');

  if (totalCountEl) totalCountEl.innerText = stats.total_images.toLocaleString();
  if (totalSizeEl) totalSizeEl.innerText = formatBytes(stats.total_size_bytes);
  if (orphanedCountEl) orphanedCountEl.innerText = stats.orphaned_count.toLocaleString();
  if (orphanedSizeEl) orphanedSizeEl.innerText = formatBytes(stats.orphaned_size_bytes);
  if (activeCountEl) activeCountEl.innerText = stats.active_count.toLocaleString();
  if (activeSizeEl) activeSizeEl.innerText = formatBytes(stats.active_size_bytes);

  // Update filter button badge counts
  const badgeAll = document.getElementById('media-badge-all');
  const badgeOrphaned = document.getElementById('media-badge-orphaned');
  const badgeActive = document.getElementById('media-badge-active');

  if (badgeAll) badgeAll.innerText = stats.total_images;
  if (badgeOrphaned) badgeOrphaned.innerText = stats.orphaned_count;
  if (badgeActive) badgeActive.innerText = stats.active_count;

  // Header quick backup text
  const quickZipBtnText = document.getElementById('media-quick-zip-text');
  if (quickZipBtnText) {
    quickZipBtnText.innerText = `📥 Скачать все осиротевшие (${stats.orphaned_count} шт • ${formatBytes(stats.orphaned_size_bytes)})`;
  }
}

function setMediaFilter(filterType) {
  mediaCurrentFilter = filterType;
  mediaCurrentPage = 1;

  ['all', 'orphaned', 'active'].forEach(f => {
    const btn = document.getElementById(`media-filter-${f}`);
    if (btn) {
      if (f === filterType) {
        btn.className = 'px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm bg-indigo-600 text-white flex items-center gap-1.5';
      } else {
        btn.className = 'px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-800 flex items-center gap-1.5';
      }
    }
  });

  loadMediaCatalog(1, false);
}

function renderMediaGrid(items) {
  const gridEl = document.getElementById('media-grid-container');
  if (!gridEl) return;

  if (!items || items.length === 0) {
    gridEl.innerHTML = `
      <div class="col-span-full py-16 text-center text-slate-500 glass rounded-2xl border border-slate-800 space-y-2">
        <i data-lucide="image" class="w-10 h-10 mx-auto text-slate-600"></i>
        <p class="text-sm font-semibold text-slate-400">Картинки не найдены</p>
        <p class="text-xs text-slate-500">Попробуйте изменить поисковый запрос или фильтр</p>
      </div>
    `;
    return;
  }

  let html = '';
  for (const item of items) {
    const isChecked = mediaSelectedFilenames.has(item.filename);
    const badgeHtml = item.is_orphaned
      ? `<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/20 border border-amber-500/40 text-amber-300">Осиротела</span>`
      : `<button onclick="openMediaUsageModal('${encodeURIComponent(item.filename)}', '${item.url}', false, ${item.size_bytes})" class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 transition">В карточке ℹ️</button>`;

    html += `
      <div class="glass rounded-xl border border-slate-800 overflow-hidden flex flex-col group hover:border-indigo-500/50 transition shadow-sm hover:shadow-lg relative ${isChecked ? 'ring-2 ring-indigo-500' : ''}">
        <!-- Image Thumbnail -->
        <div class="relative w-full aspect-square bg-slate-950 flex items-center justify-center overflow-hidden cursor-pointer" onclick="openMediaUsageModal('${encodeURIComponent(item.filename)}', '${item.url}', ${item.is_orphaned}, ${item.size_bytes})">
          <img src="${item.url}" alt="${item.filename}" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition duration-300" onerror="this.onerror=null; this.src='data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'48\\' height=\\'48\\' fill=\\'none\\' stroke=\\'%23666\\' stroke-width=\\'2\\'%3E%3Crect width=\\'40\\' height=\\'40\\' x=\\'4\\' y=\\'4\\' rx=\\'4\\'/%3E%3Ccircle cx=\\'16\\' cy=\\'16\\' r=\\'4\\'/%3E%3Cpath d=\\'m4 32 12-12 8 8 10-10 10 10\\'/%3E%3C/svg%3E'; this.className='w-12 h-12 opacity-40';">
          <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition"></div>
          
          <!-- Top Left Checkbox -->
          <div class="absolute top-2 left-2 z-10" onclick="event.stopPropagation()">
            <input type="checkbox" class="w-4 h-4 rounded text-indigo-600 bg-slate-900/90 border-slate-700 cursor-pointer focus:ring-0 shadow"
              ${isChecked ? 'checked' : ''}
              onchange="toggleMediaSelect('${item.filename}', this.checked)">
          </div>

          <!-- Top Right Badge -->
          <div class="absolute top-2 right-2 z-10" onclick="event.stopPropagation()">
            ${badgeHtml}
          </div>
        </div>

        <!-- Info Footer -->
        <div class="p-2.5 bg-slate-900/70 border-t border-slate-800/80 flex flex-col gap-1 text-xs">
          <div class="flex items-center justify-between gap-1">
            <span class="font-mono text-slate-300 font-semibold truncate text-[11px]" title="${item.filename}">
              ${item.filename}
            </span>
            <a href="/api/admin/media/download/${encodeURIComponent(item.filename)}" download class="p-1 rounded text-slate-400 hover:text-indigo-400 hover:bg-slate-800 transition" title="Скачать файл">
              <i data-lucide="download" class="w-3.5 h-3.5"></i>
            </a>
          </div>
          <div class="flex items-center justify-between text-[10px] text-slate-500 font-mono">
            <span>${formatBytes(item.size_bytes)}</span>
            <button onclick="openMediaUsageModal('${encodeURIComponent(item.filename)}', '${item.url}', ${item.is_orphaned}, ${item.size_bytes})" class="text-indigo-400 hover:underline">
              Инфо
            </button>
          </div>
        </div>
      </div>
    `;
  }

  gridEl.innerHTML = html;
}

function renderMediaPagination(total, page, pages, limit) {
  const paginationEl = document.getElementById('media-pagination');
  if (!paginationEl) return;

  if (total === 0 || pages <= 1) {
    paginationEl.innerHTML = total > 0 ? `<div class="text-xs text-slate-500">Показаны все ${total} картинок</div>` : '';
    return;
  }

  const startIdx = (page - 1) * limit + 1;
  const endIdx = Math.min(page * limit, total);

  let html = `
    <div class="flex flex-col sm:flex-row items-center justify-between gap-3 w-full">
      <div class="text-xs text-slate-400 font-medium">
        Показано <b class="text-white font-mono">${startIdx}–${endIdx}</b> из <b class="text-white font-mono">${total}</b>
      </div>
      <div class="flex items-center gap-1.5">
        <button onclick="loadMediaCatalog(${page - 1})" ${page <= 1 ? 'disabled class="opacity-40 cursor-not-allowed px-3 py-1.5 rounded-lg border border-slate-800 text-xs font-semibold text-slate-500 flex items-center gap-1"' : 'class="hover:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-800 text-xs font-semibold text-slate-300 transition flex items-center gap-1"'}>
          <i data-lucide="chevron-left" class="w-3.5 h-3.5"></i> Назад
        </button>
        <span class="px-3 py-1.5 text-xs font-mono font-bold text-white bg-slate-900 border border-slate-800 rounded-lg">
          ${page} / ${pages}
        </span>
        <button onclick="loadMediaCatalog(${page + 1})" ${page >= pages ? 'disabled class="opacity-40 cursor-not-allowed px-3 py-1.5 rounded-lg border border-slate-800 text-xs font-semibold text-slate-500 flex items-center gap-1"' : 'class="hover:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-800 text-xs font-semibold text-slate-300 transition flex items-center gap-1"'}>
          Вперёд <i data-lucide="chevron-right" class="w-3.5 h-3.5"></i>
        </button>
      </div>
    </div>
  `;

  paginationEl.innerHTML = html;
}

function toggleMediaSelect(filename, checked) {
  if (checked) {
    mediaSelectedFilenames.add(filename);
  } else {
    mediaSelectedFilenames.delete(filename);
  }
  updateMediaSelectionUI();
}

function toggleMediaSelectAllVisible(checked) {
  const checkboxes = document.querySelectorAll('#media-grid-container input[type="checkbox"]');
  checkboxes.forEach(cb => {
    cb.checked = checked;
    const filename = cb.getAttribute('onchange')?.match(/'(.*?)'/)?.[1];
    if (filename) {
      if (checked) {
        mediaSelectedFilenames.add(filename);
      } else {
        mediaSelectedFilenames.delete(filename);
      }
    }
  });
  updateMediaSelectionUI();
}

function clearMediaSelection() {
  mediaSelectedFilenames.clear();
  const selectAllCb = document.getElementById('media-select-all');
  if (selectAllCb) selectAllCb.checked = false;
  const checkboxes = document.querySelectorAll('#media-grid-container input[type="checkbox"]');
  checkboxes.forEach(cb => cb.checked = false);
  updateMediaSelectionUI();
}

function updateMediaSelectionUI() {
  const count = mediaSelectedFilenames.size;
  const badge = document.getElementById('media-selected-count-badge');
  const btnZipSelected = document.getElementById('btn-media-download-selected');
  const btnDeleteSelected = document.getElementById('btn-media-delete-selected');

  if (badge) {
    badge.innerText = count;
  }

  if (count > 0) {
    if (btnZipSelected) {
      btnZipSelected.disabled = false;
      btnZipSelected.classList.remove('opacity-50', 'pointer-events-none');
    }
    if (btnDeleteSelected) {
      btnDeleteSelected.disabled = false;
      btnDeleteSelected.classList.remove('opacity-50', 'pointer-events-none');
    }
  } else {
    if (btnZipSelected) {
      btnZipSelected.disabled = true;
      btnZipSelected.classList.add('opacity-50', 'pointer-events-none');
    }
    if (btnDeleteSelected) {
      btnDeleteSelected.disabled = true;
      btnDeleteSelected.classList.add('opacity-50', 'pointer-events-none');
    }
  }
}

// ── Batch ZIP Downloads ──────────────────────────────────────────────────────

async function downloadAllOrphanedZip() {
  const btn = document.getElementById('btn-media-download-all-orphaned');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<div class="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> <span>Формирование архива...</span>`;
  }

  try {
    const res = await fetch('/api/admin/media/download-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orphaned_only: true })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Ошибка выгрузки' }));
      throw new Error(err.detail || 'Не удалось скачать архив');
    }

    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = 'orphaned_images_backup.zip';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(blobUrl);
  } catch (e) {
    alert('Ошибка при скачивании архива: ' + e.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
      if (window.lucide) window.lucide.createIcons();
    }
  }
}

async function downloadSelectedZip() {
  if (mediaSelectedFilenames.size === 0) {
    alert('Выберите хотя бы одну картинку для скачивания');
    return;
  }

  const btn = document.getElementById('btn-media-download-selected');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<div class="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> <span>Формирование...</span>`;
  }

  try {
    const res = await fetch('/api/admin/media/download-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filenames: Array.from(mediaSelectedFilenames) })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Ошибка выгрузки' }));
      throw new Error(err.detail || 'Не удалось скачать архив');
    }

    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = 'selected_images.zip';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(blobUrl);
  } catch (e) {
    alert('Ошибка при скачивании архива: ' + e.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
      if (window.lucide) window.lucide.createIcons();
    }
  }
}

// ── Cleanup Orphaned Images ──────────────────────────────────────────────────

async function cleanupOrphanedImages(onlySelected = false) {
  let targetCount = 0;
  if (onlySelected) {
    targetCount = mediaSelectedFilenames.size;
    if (targetCount === 0) {
      alert('Сначала отметьте галочками картинки для удаления');
      return;
    }
  }

  const confirmMsg = onlySelected
    ? `⚠️ ВНИМАНИЕ!\n\nВы собираетесь безвозвратно удалить выбранные картинки (${targetCount} шт.) из базы данных.\n\nПеред удалением убедитесь, что вы скачали архив (кнопка «📥 Скачать выбранные»).\n\nУдалить эти файлы?`
    : `⚠️ ВНИМАНИЕ!\n\nВы собираетесь безвозвратно удалить ВСЕ осиротевшие картинки из базы данных.\nАктивные картинки, используемые в карточках, гарантированно НЕ будут затронуты.\n\nПеред удалением обязательно скачайте резервную копию по кнопке «📥 Скачать все осиротевшие (ZIP)»!\n\nВы уверены, что хотите продолжить?`;

  if (!confirm(confirmMsg)) return;

  const btn = onlySelected ? document.getElementById('btn-media-delete-selected') : document.getElementById('btn-media-cleanup-all');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<div class="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> <span>Удаление...</span>`;
  }

  try {
    const payload = onlySelected ? { filenames: Array.from(mediaSelectedFilenames) } : {};
    const res = await fetch('/api/admin/media/cleanup-orphaned', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Ошибка очистки' }));
      throw new Error(err.detail || 'Не удалось выполнить очистку');
    }

    const result = await res.json();
    alert(`✅ Очистка завершена!\nУдалено картинок: ${result.deleted_count}\nОсвобождено места: ${formatBytes(result.freed_bytes)}`);

    clearMediaSelection();
    loadMediaCatalog(1, true);
  } catch (e) {
    alert('Ошибка при очистке: ' + e.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
      if (window.lucide) window.lucide.createIcons();
    }
  }
}

// ── Image Usage Modal ────────────────────────────────────────────────────────

async function openMediaUsageModal(encodedFilename, url, isOrphaned, sizeBytes) {
  const filename = decodeURIComponent(encodedFilename);
  const modal = document.getElementById('modal-media-usage');
  if (!modal) return;

  document.getElementById('media-usage-title').innerText = filename;
  document.getElementById('media-usage-preview-img').src = url;
  document.getElementById('media-usage-filesize').innerText = formatBytes(sizeBytes);
  document.getElementById('media-usage-download-btn').href = `/api/admin/media/download/${encodeURIComponent(filename)}`;

  const statusBadge = document.getElementById('media-usage-status-badge');
  const usagesContainer = document.getElementById('media-usage-cards-list');

  if (isOrphaned) {
    statusBadge.className = 'px-2.5 py-1 text-xs font-bold rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40';
    statusBadge.innerText = '⚠️ Осиротевшая (не используется)';
  } else {
    statusBadge.className = 'px-2.5 py-1 text-xs font-bold rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
    statusBadge.innerText = '✅ Используется в карточках';
  }

  usagesContainer.innerHTML = `
    <div class="py-4 text-center text-slate-500 text-xs">
      <div class="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
      Поиск карточек...
    </div>
  `;

  modal.classList.remove('hidden');

  try {
    const res = await fetch(`/api/admin/media/usage/${encodeURIComponent(filename)}`);
    const data = await res.json();
    const usages = data.usages || [];

    if (usages.length === 0) {
      usagesContainer.innerHTML = `
        <div class="p-3 bg-slate-950 rounded-xl border border-slate-800/80 text-xs text-slate-400 space-y-1">
          <p class="font-bold text-amber-300">Файл не привязан ни к одной карточке.</p>
          <p class="text-slate-500">Возможно, карточка была удалена или у неё заменили иллюстрацию. Картинку можно безопасно скачать в архив и затем удалить для экономии места.</p>
        </div>
      `;
    } else {
      let cardsHtml = '';
      usages.forEach(u => {
        cardsHtml += `
          <div class="p-2.5 bg-slate-950 rounded-xl border border-slate-800/80 flex items-center justify-between text-xs gap-3">
            <div class="truncate">
              <span class="font-bold text-white">${u.front || '(Пустая сторона)'}</span>
              <div class="text-[11px] text-slate-400">
                Колода: <b class="text-indigo-300">${u.deck_name}</b> <span class="text-slate-500 font-mono">(#${u.deck_id})</span>
              </div>
            </div>
            <button onclick="closeModal('modal-media-usage'); openDeckPreview(${u.deck_id});" class="px-2.5 py-1 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 rounded-lg font-semibold text-[11px] shrink-0 border border-indigo-500/30 transition">
              Открыть колоду
            </button>
          </div>
        `;
      });
      usagesContainer.innerHTML = cardsHtml;
    }
  } catch (e) {
    usagesContainer.innerHTML = `<div class="text-rose-400 text-xs py-2">Ошибка загрузки сведений об использовании: ${e.message}</div>`;
  }

  if (window.lucide) window.lucide.createIcons();
}
