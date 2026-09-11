/**
 * classification.js — Lerne TMA Admin Module
 */
function collectClassificationOptions(mode) {
      const limitRaw = document.getElementById('classification-limit-input')?.value;
      const delayRaw = document.getElementById('classification-delay-input')?.value;
      const limit = limitRaw ? parseInt(limitRaw, 10) : null;
      const delay = delayRaw ? parseFloat(delayRaw) : 1;

      return {
        mode,
        lang: document.getElementById('classification-lang-select')?.value || 'de',
        vocab_profile: document.getElementById('classification-vocab-select')?.value || 'medium',
        overwrite: Boolean(document.getElementById('classification-overwrite-cb')?.checked),
        clear_uncertain_local: Boolean(document.getElementById('classification-clear-uncertain-cb')?.checked),
        include_library: Boolean(document.getElementById('classification-library-cb')?.checked),
        limit: Number.isFinite(limit) && limit > 0 ? limit : null,
        delay: Number.isFinite(delay) && delay >= 0 ? delay : 1
      };
    }

async function startClassificationTask(mode) {
      const options = collectClassificationOptions(mode);
      const modeLabel = mode === 'audit' ? 'аудит без AI и записи'
        : mode === 'dry_run' ? 'dry-run с AI без записи'
        : 'полную переразметку с записью в БД';

      if (mode === 'run' && !confirm('Запустить полную переразметку CEFR? Перед записью будет создан полный бэкап БД.')) {
        return;
      }
      if (mode === 'run' && options.clear_uncertain_local && !confirm('Включена очистка CEFR при неуверенной локальной оценке. Такие карточки останутся без A1-C2 и не пойдут в AI. Продолжить?')) {
        return;
      }
      const dryRunMsg = options.clear_uncertain_local
        ? 'Запустить dry-run? Неуверенные локальные фразы будут помечены как CEFR-очистка, БД не изменится.'
        : 'Запустить dry-run? Будут вызовы AI для неуверенных фраз, но БД не изменится.';
      if (mode === 'dry_run' && !confirm(dryRunMsg)) {
        return;
      }

      resetClassificationView();
      document.getElementById('classification-logs-container').innerHTML = `<div class="text-cyan-300">Запуск: ${modeLabel}...</div>`;
      document.getElementById('classification-status-badge').innerText = 'pending';

      try {
        const res = await fetch('/api/admin/classification/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options)
        });
        const data = await res.json();
        if (!res.ok || !data.task_id) {
          throw new Error(data.detail || data.message || 'сервер не вернул task_id');
        }
        activeClassificationTaskId = data.task_id;
        startPollClassificationStatus(data.task_id);
      } catch (err) {
        document.getElementById('classification-status-badge').innerText = 'failed';
        document.getElementById('classification-logs-container').innerHTML = `<div class="text-rose-400">Ошибка запуска: ${escapeHtml(err.message || err)}</div>`;
      }
    }

function resetClassificationView() {
      document.getElementById('classification-progress-bar').style.width = '0%';
      document.getElementById('classification-progress-text').innerText = '0 / 0';
      document.getElementById('classification-ai-progress-text').innerText = '0 / 0';
      document.getElementById('classification-stat-scanned').innerText = '0';
      document.getElementById('classification-stat-unique').innerText = '0';
      document.getElementById('classification-stat-local').innerText = '0';
      document.getElementById('classification-stat-ai').innerText = '0';
      document.getElementById('classification-stat-cleared').innerText = '0';
      document.getElementById('classification-updated-badge').innerText = 'updated: 0';
      document.getElementById('classification-level-bars').innerHTML = '';
      document.getElementById('classification-results-tbody').innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-slate-500">Результатов пока нет</td></tr>';
    }

function startPollClassificationStatus(taskId) {
      if (classificationPollInterval) clearInterval(classificationPollInterval);

      classificationPollInterval = setInterval(async () => {
        try {
          const res = await fetch(`/api/admin/classification/${taskId}/status`);
          const data = await res.json();
          renderClassificationStatus(data);

          if (['completed', 'failed', 'stopped'].includes(data.status)) {
            clearInterval(classificationPollInterval);
            classificationPollInterval = null;
            if (data.status === 'completed' && data.mode === 'run') {
              loadDecks();
            }
          }
        } catch (err) {
          console.error('Classification poll error', err);
        }
      }, 1000);
    }

function renderClassificationStatus(data) {
      const total = data.total_cards || 0;
      const processed = data.processed_cards || 0;
      const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

      const badge = document.getElementById('classification-status-badge');
      badge.innerText = data.status || 'idle';
      badge.className = `px-2.5 py-1 rounded-lg text-[11px] font-bold border ${classificationStatusClass(data.status)}`;

      document.getElementById('classification-progress-bar').style.width = `${pct}%`;
      document.getElementById('classification-progress-text').innerText = `${processed} / ${total}`;
      document.getElementById('classification-ai-progress-text').innerText = `${data.processed_ai_chunks || 0} / ${data.total_ai_chunks || 0}`;
      document.getElementById('classification-stat-scanned').innerText = data.cards_scanned || 0;
      document.getElementById('classification-stat-unique').innerText = data.unique_phrases || 0;
      document.getElementById('classification-stat-local').innerText = data.local_unique || 0;
      document.getElementById('classification-stat-ai').innerText = data.ai_unique || 0;
      document.getElementById('classification-stat-cleared').innerText = data.cleared_cards || 0;
      document.getElementById('classification-updated-badge').innerText = `updated: ${data.updated_cards || 0}`;

      const logsContainer = document.getElementById('classification-logs-container');
      logsContainer.innerHTML = (data.logs || []).map(line => `<div>${escapeHtml(line)}</div>`).join('') || '<div class="text-slate-500">Лог пуст</div>';
      logsContainer.scrollTop = logsContainer.scrollHeight;

      const levels = Object.keys(data.level_counts || {}).length ? data.level_counts : (data.local_level_counts || {});
      renderClassificationLevelBars(levels, total);
      renderClassificationResults(data.classification_results || []);
      lucide.createIcons();
    }

function classificationStatusClass(status) {
      if (status === 'completed') return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30';
      if (status === 'running') return 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30';
      if (status === 'paused') return 'bg-amber-500/10 text-amber-300 border-amber-500/30';
      if (status === 'failed' || status === 'stopped') return 'bg-rose-500/10 text-rose-300 border-rose-500/30';
      return 'bg-slate-800 text-slate-300 border-slate-700';
    }

function renderClassificationLevelBars(levelCounts, totalCards) {
      const container = document.getElementById('classification-level-bars');
      const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'NO_LEVEL'];
      const maxTotal = Math.max(1, totalCards || levels.reduce((sum, lvl) => sum + (levelCounts[lvl] || 0), 0));

      container.innerHTML = levels.map(level => {
        const count = levelCounts[level] || 0;
        const pct = Math.round((count / maxTotal) * 100);
        return `
          <div class="space-y-1">
            <div class="flex items-center justify-between text-xs">
              <span class="font-bold text-white">${level === 'NO_LEVEL' ? 'без CEFR' : level}</span>
              <span class="font-mono text-slate-400">${count} (${pct}%)</span>
            </div>
            <div class="h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
              <div class="h-full bg-cyan-500/80 rounded-full transition-all duration-300" style="width:${pct}%"></div>
            </div>
          </div>
        `;
      }).join('');
    }

function renderClassificationResults(results) {
      const tbody = document.getElementById('classification-results-tbody');
      if (!results.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-slate-500">Результатов пока нет</td></tr>';
        return;
      }

      tbody.innerHTML = results.map(item => `
        <tr class="hover:bg-slate-900/60 transition">
          <td class="px-4 py-3 font-mono text-slate-500">#${escapeHtml(item.card_id)}</td>
          <td class="px-4 py-3 text-white font-semibold max-w-md truncate" title="${escapeHtml(item.phrase)}">${escapeHtml(item.phrase)}</td>
          <td class="px-4 py-3">${classificationLevelPill(item.old_level || '—', 'slate')}</td>
          <td class="px-4 py-3">${classificationLevelPill(item.new_level || '—', 'cyan')}</td>
          <td class="px-4 py-3">
            <span class="px-2 py-0.5 rounded-md border text-[11px] font-bold ${item.source === 'local' ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30' : item.source === 'ai' ? 'bg-amber-500/10 text-amber-300 border-amber-500/30' : 'bg-slate-800 text-slate-300 border-slate-700'}">
              ${escapeHtml(item.source || 'fallback')} ${item.confidence !== undefined ? escapeHtml(item.confidence) : ''}
            </span>
          </td>
          <td class="px-4 py-3 font-mono text-slate-400">${escapeHtml(item.card_count || 1)}</td>
        </tr>
      `).join('');
    }

function classificationLevelPill(level, tone = 'cyan') {
      const cls = tone === 'cyan'
        ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'
        : 'bg-slate-800 text-slate-300 border-slate-700';
      return `<span class="px-2 py-0.5 rounded-md border text-[11px] font-bold ${cls}">${escapeHtml(level)}</span>`;
    }

async function controlClassificationTask(action) {
      if (!activeClassificationTaskId) return;
      try {
        await fetch(`/api/admin/classification/${activeClassificationTaskId}/control`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action })
        });
      } catch (err) {
        console.error('Classification control error', err);
      }
    }

