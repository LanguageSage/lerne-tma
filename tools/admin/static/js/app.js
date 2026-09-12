/**
 * app.js — Lerne TMA Admin Module
 */
function switchTab(tab) {
      try {
        localStorage.setItem('lerne_admin_tab', tab);
      } catch (e) {}

      ['users', 'decks', 'folders', 'ai', 'bulk', 'classification', 'backups', 'backup-explorer', 'media-manager'].forEach(t => {
        const contentEl = document.getElementById(`content-${t}`);
        if (contentEl) contentEl.classList.add('hidden');
        const btn = document.getElementById(`tab-${t}`);
        if (btn) {
          btn.classList.remove('bg-indigo-600', 'text-white');
          btn.classList.add('text-slate-400');
        }
      });

      const activeContent = document.getElementById(`content-${tab}`);
      if (activeContent) activeContent.classList.remove('hidden');
      const activeBtn = document.getElementById(`tab-${tab}`);
      if (activeBtn) {
        activeBtn.classList.add('bg-indigo-600', 'text-white');
        activeBtn.classList.remove('text-slate-400');
      }

      if (tab === 'folders') {
        loadAdminFolders();
      } else if (tab === 'backups') {
        loadBackups();
      } else if (tab === 'backup-explorer') {
        initBackupExplorer();
      } else if (tab === 'bulk') {
        initBulkCreator();
      } else if (tab === 'ai') {
        checkSavedCheckpoint(false);
      } else if (tab === 'classification') {
        lucide.createIcons();
      } else if (tab === 'media-manager') {
        initMediaManager();
      }
      lucide.createIcons();
    }

function closeModal(id) {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    }

    // ── New: Promote to Library (1-click) ────────────────────────────────────


/**
 * Server Heartbeat & Global Task Monitoring
 */
let isServerOnline = true;

async function checkServerHeartbeat() {
  const pill = document.getElementById('server-status-pill');
  if (!pill) return;
  try {
    const res = await fetch('/api/admin/prompts', { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      isServerOnline = true;
      pill.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 text-xs font-semibold shadow-inner';
      pill.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> <span>8050 онлайн</span>';
    } else {
      throw new Error('Non-200');
    }
  } catch (e) {
    isServerOnline = false;
    pill.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-950/60 border border-rose-500/40 text-rose-400 text-xs font-semibold shadow-inner';
    pill.innerHTML = '<span class="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span> <span>Сервер оффлайн</span>';
  }
}

async function checkGlobalActiveTasks() {
  const badge = document.getElementById('global-task-badge');
  const txt = document.getElementById('global-task-text');
  if (!badge || !txt) return;

  try {
    const res = await fetch('/api/admin/tasks/checkpoint', { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    if (data.has_checkpoint && data.checkpoint && data.checkpoint.status === 'running') {
      const ckpt = data.checkpoint;
      const pct = Math.round((Number(ckpt.processed_cards || 0) / Math.max(Number(ckpt.total_cards || 1), 1)) * 100);
      badge.classList.remove('hidden');
      txt.innerText = `⚡ ${ckpt.task_type || 'Задача'}: ${pct}%`;
    } else {
      badge.classList.add('hidden');
    }
  } catch (e) {
    badge.classList.add('hidden');
  }
}

function onGlobalTaskBadgeClick() {
  switchTab('ai');
}

document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  loadStagedDecksFromStorage();
  updateStagingUI();
  renderVoiceOptions('de');
  renderBulkVoiceOptions('de');
  loadUsers();
  loadDecks();
  startDecksAutoRefresh();
  checkSavedCheckpoint(true);

  // Start heartbeat and task check
  checkServerHeartbeat();
  setInterval(checkServerHeartbeat, 10000);
  setInterval(checkGlobalActiveTasks, 5000);
});
