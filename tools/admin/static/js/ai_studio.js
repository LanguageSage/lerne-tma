/**
 * ai_studio.js — Lerne TMA Admin Module
 */
async function loadPrompts(langOverride = null, targetLangOverride = null) {
      const nativeLang = langOverride || document.getElementById('regen-native-lang-select').value || 'uk';
      const targetLang = targetLangOverride || activeDeckTargetLang || 'de';
      try {
        const res = await fetch(`/api/admin/prompts?native_lang=${encodeURIComponent(nativeLang)}&target_lang=${encodeURIComponent(targetLang)}`);
        const data = await res.json();
        promptsData = data.prompts || [];
        
        const select = document.getElementById('regen-prompt-select');
        select.innerHTML = '';
        promptsData.forEach(p => {
          select.innerHTML += `<option value="${p.id}" data-target-lang="${p.target_lang || targetLang}" ${p.is_default ? 'selected' : ''}>${p.name}</option>`;
        });
        onPromptSelectChange();
      } catch (err) {
        console.error("Failed to load prompts", err);
      }
    }

function onNativeLangChange() {
      const selectedLang = document.getElementById('regen-native-lang-select').value;
      loadPrompts(selectedLang, activeDeckTargetLang);
    }

function onPromptSelectChange() {
      const select = document.getElementById('regen-prompt-select');
      const selectedId = select.value;
      const found = promptsData.find(p => p.id === selectedId);
      const descEl = document.getElementById('regen-prompt-desc');
      const fulltextEl = document.getElementById('regen-prompt-fulltext');
      
      if (found) {
        if (descEl) descEl.innerText = found.description || '';
        if (fulltextEl) fulltextEl.innerText = found.instruction || 'Инструкция по умолчанию';

        const promptTargetLang = found.target_lang || activeDeckTargetLang || 'de';
        renderVoiceOptions(promptTargetLang);
      }
    }

function togglePromptFulltext() {
      const wrapper = document.getElementById('regen-prompt-fulltext-wrapper');
      const btn = document.getElementById('prompt-fulltext-toggle-btn');
      if (wrapper.classList.contains('hidden')) {
        wrapper.classList.remove('hidden');
        btn.innerText = '▲ Скрыть полный текст инструкции для ИИ';
      } else {
        wrapper.classList.add('hidden');
        btn.innerText = '👁 Показать полный текст инструкции для ИИ';
      }
    }

    let currentDeckCards = [];
    let currentPlayingAudio = null;
    let currentPreviewAudio = null;

function onCardCheckboxChange(cb) {
      const cardId = Number(cb.value);
      if (cb.checked) {
        committedDryRunCardIds.delete(cardId);
        const badge = cb.closest('label')?.querySelector('.committed-test-badge');
        if (badge) badge.remove();
      }
    }

async function loadDeckCardsForSelector(deckId) {
      const countEl = document.getElementById('deck-cards-selector-count');
      const listEl = document.getElementById('deck-cards-selector-list');
      countEl.innerText = '0';
      listEl.innerHTML = '<div class="text-slate-500 text-center py-2">Загрузка карточек...</div>';
      
      try {
        const res = await fetch(`/api/admin/decks/${deckId}/cards`);
        const data = await res.json();
        currentDeckCards = data.cards || [];
        countEl.innerText = currentDeckCards.length;

        listEl.innerHTML = '';
        currentDeckCards.forEach(c => {
          const safeAudio = (c.audio_path || '').replace(/'/g, "\\'");
          const audioBadge = c.has_audio 
            ? `<button type="button" onclick="playAudioFile('${safeAudio}', event)" title="Воспроизвести озвучку" class="px-1.5 py-0.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 font-bold rounded text-[10px] flex items-center gap-1 transition">
                 <i data-lucide="volume-2" class="w-3 h-3"></i> Аудио
               </button>` 
            : `<span class="px-1.5 py-0.5 bg-amber-500/10 text-amber-400/80 rounded text-[10px]">⚠️ Без аудио</span>`;

          const isCommitted = committedDryRunCardIds.has(Number(c.id));
          const checkedAttr = isCommitted ? '' : 'checked';
          const committedBadge = isCommitted 
            ? `<span class="committed-test-badge ml-1.5 px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 rounded text-[10px] font-bold border border-emerald-500/30">✅ В БД (снята)</span>` 
            : '';

          listEl.innerHTML += `
            <label class="flex items-start gap-2.5 p-1.5 hover:bg-slate-900 rounded cursor-pointer border border-transparent hover:border-slate-800">
              <input type="checkbox" class="card-select-checkbox w-3.5 h-3.5 mt-0.5 text-indigo-600 rounded" value="${c.id}" ${checkedAttr} onchange="onCardCheckboxChange(this)">
              <div class="flex-1 min-w-0 flex items-center justify-between gap-2">
                <div class="truncate">
                  <span class="text-indigo-400 font-bold">#${c.position}</span>
                  <span class="text-white font-medium ml-1">${c.front || '(пусто)'}</span>
                  ${c.back ? `<span class="text-slate-400 text-[11px] ml-1.5">— ${c.back}</span>` : ''}
                  ${committedBadge}
                </div>
                <div class="shrink-0">
                  ${audioBadge}
                </div>
              </div>
            </label>
          `;
        });
        lucide.createIcons();
      } catch (e) {
        console.error("Failed to load deck cards", e);
        listEl.innerHTML = '<div class="text-rose-400 text-center py-2">Ошибка загрузки карточек</div>';
      }
    }

function selectAllCardSelector(checked) {
      document.querySelectorAll('.card-select-checkbox').forEach(cb => cb.checked = checked);
    }

    let activeStudioPreset = 'context_only';

function selectStudioPreset(presetKey) {
      activeStudioPreset = presetKey;
      const presets = ['context_only', 'audio_only', 'smart_fill', 'full_regen'];
      
      presets.forEach(p => {
        const card = document.getElementById(`preset-card-${p}`);
        if (!card) return;
        if (p === presetKey) {
          card.classList.remove('bg-slate-900', 'border-slate-800');
          if (p === 'context_only') card.classList.add('bg-purple-950/60', 'border-purple-500', 'shadow-md', 'shadow-purple-500/20');
          else if (p === 'audio_only') card.classList.add('bg-emerald-950/60', 'border-emerald-500', 'shadow-md', 'shadow-emerald-500/20');
          else if (p === 'smart_fill') card.classList.add('bg-indigo-950/60', 'border-indigo-500', 'shadow-md', 'shadow-indigo-500/20');
          else card.classList.add('bg-blue-950/60', 'border-blue-500', 'shadow-md', 'shadow-blue-500/20');
        } else {
          card.classList.remove(
            'bg-purple-950/60', 'border-purple-500', 'shadow-purple-500/20',
            'bg-emerald-950/60', 'border-emerald-500', 'shadow-emerald-500/20',
            'bg-indigo-950/60', 'border-indigo-500', 'shadow-indigo-500/20',
            'bg-blue-950/60', 'border-blue-500', 'shadow-blue-500/20', 'shadow-md'
          );
          card.classList.add('bg-slate-900', 'border-slate-800');
        }
      });

      const voiceSelect = document.getElementById('regen-voice-select');
      const chkSkipCompleted = document.getElementById('regen-skip-completed');

      if (presetKey === 'context_only') {
        if (voiceSelect) voiceSelect.value = 'none';
        if (chkSkipCompleted) chkSkipCompleted.checked = true;
      } else if (presetKey === 'audio_only') {
        if (voiceSelect && voiceSelect.value === 'none') {
          voiceSelect.value = getDefaultVoiceForLang(activeDeckTargetLang || 'de');
        }
        if (chkSkipCompleted) chkSkipCompleted.checked = true;
      } else if (presetKey === 'smart_fill') {
        if (voiceSelect && voiceSelect.value === 'none') {
          voiceSelect.value = getDefaultVoiceForLang(activeDeckTargetLang || 'de');
        }
        if (chkSkipCompleted) chkSkipCompleted.checked = true;
      } else if (presetKey === 'full_regen') {
        if (voiceSelect && voiceSelect.value === 'none') {
          voiceSelect.value = getDefaultVoiceForLang(activeDeckTargetLang || 'de');
        }
        if (chkSkipCompleted) chkSkipCompleted.checked = false;
      }
    }

function openRegenModal(deckId, deckName, initialMode = 'context_only') {
      isBatchStudioMode = false;
      activeRegenDeckId = deckId;
      switchTab('ai');

      // Adjust Studio Mode UI
      document.getElementById('ai-mode-pill').innerText = 'Одиночная колода';
      document.getElementById('ai-mode-pill').className = 'px-2.5 py-0.5 text-[11px] font-bold rounded-lg border bg-indigo-500/10 text-indigo-300 border-indigo-500/20';
      document.getElementById('ai-batch-header-actions').classList.add('hidden');
      document.getElementById('single-deck-actions').classList.remove('hidden');
      document.getElementById('batch-deck-actions').classList.add('hidden');
      document.getElementById('single-card-selector-box').classList.remove('hidden');
      document.getElementById('batch-decks-selector-box').classList.add('hidden');
      document.getElementById('single-progress-bar-container').classList.remove('hidden');
      document.getElementById('batch-progress-bar-container').classList.add('hidden');

      const deck = decksData.find(d => String(d.id) === String(deckId));
      const title = deck ? deck.name : deckName || '#' + deckId;
      activeDeckTargetLang = (deck && deck.target_language) ? deck.target_language : 'de';

      let normalizedPreset = 'context_only';
      if (initialMode === 'audio' || initialMode === 'audio_only') normalizedPreset = 'audio_only';
      else if (initialMode === 'context_only') normalizedPreset = 'context_only';
      else if (initialMode === 'smart' || initialMode === 'smart_fill') normalizedPreset = 'smart_fill';
      else if (initialMode === 'full' || initialMode === 'full_regen' || initialMode === 'ai') normalizedPreset = 'full_regen';

      selectStudioPreset(normalizedPreset);

      document.getElementById('ai-active-deck-title').innerText = normalizedPreset === 'audio_only' 
        ? `🎙️ Озвучивание: ${title}` 
        : (normalizedPreset === 'context_only' ? `✨ Генерация контекста: ${title}` : `🚀 ИИ Студия: ${title}`);
      document.getElementById('ai-active-deck-subtitle').innerText = `ID колоды: #${deckId} • Язык: ${activeDeckTargetLang.toUpperCase()}`;

      // Reset studio progress and previews
      document.getElementById('ai-progress-bar').style.width = '0%';
      document.getElementById('ai-percent-badge').innerText = '0%';
      document.getElementById('ai-active-status-text').innerText = 'Статус: Готов к запуску';
      document.getElementById('ai-current-deck-badge').innerText = '';
      document.getElementById('ai-current-card-badge').innerText = '';
      document.getElementById('dryrun-preview-section').classList.add('hidden');
      document.getElementById('dryrun-cards-grid').innerHTML = '';
      document.getElementById('ai-logs-container').innerHTML = normalizedPreset === 'audio_only'
        ? '<div class="text-emerald-400">Готов к генерации озвучки. Выберите голос, скорость и нажмите "Перегенерировать ТОЛЬКО озвучку".</div>'
        : (normalizedPreset === 'context_only'
          ? '<div class="text-purple-300">Готов к генерации контекста. Нажмите "Перегенерировать ТОЛЬКО контекст (ИИ)". Озвучка затрагиваться не будет.</div>'
          : '<div class="text-slate-400">Готов к запуску. Выберите задачу в блоке "Быстрый выбор задачи" или настройте чекбоксы вручную.</div>');

      renderVoiceOptions(activeDeckTargetLang);
      loadPrompts(null, activeDeckTargetLang);
      loadDeckCardsForSelector(deckId);
    }

async function openBatchRegenStudio(initialMode = 'context_only') {
      const stagedIds = Object.keys(stagedDecks);
      if (stagedIds.length === 0) {
        alert("В очереди нет отложенных колод! Сначала найдите и отложите колоды через поиск.");
        switchTab('decks');
        return;
      }

      isBatchStudioMode = true;
      switchTab('ai');

      // Adjust Studio Mode UI for Batch
      document.getElementById('ai-mode-pill').innerText = `Пакетный режим (${stagedIds.length} колод)`;
      document.getElementById('ai-mode-pill').className = 'px-2.5 py-0.5 text-[11px] font-bold rounded-lg border bg-purple-500/20 text-purple-300 border-purple-500/30 animate-pulse';
      document.getElementById('ai-batch-header-actions').classList.remove('hidden');
      document.getElementById('single-deck-actions').classList.add('hidden');
      document.getElementById('batch-deck-actions').classList.remove('hidden');
      document.getElementById('single-card-selector-box').classList.add('hidden');
      document.getElementById('batch-decks-selector-box').classList.remove('hidden');
      document.getElementById('single-progress-bar-container').classList.add('hidden');
      document.getElementById('batch-progress-bar-container').classList.remove('hidden');

      let normalizedPreset = 'context_only';
      if (initialMode === 'audio' || initialMode === 'audio_only') normalizedPreset = 'audio_only';
      else if (initialMode === 'context_only') normalizedPreset = 'context_only';
      else if (initialMode === 'smart' || initialMode === 'smart_fill') normalizedPreset = 'smart_fill';
      else if (initialMode === 'full' || initialMode === 'full_regen' || initialMode === 'ai') normalizedPreset = 'full_regen';

      selectStudioPreset(normalizedPreset);

      document.getElementById('ai-active-deck-title').innerText = normalizedPreset === 'audio_only'
        ? `🎙️ Пакетное озвучивание: ${stagedIds.length} отложенных колод`
        : (normalizedPreset === 'context_only' 
          ? `✨ Пакетное дополнение контекста: ${stagedIds.length} отложенных колод` 
          : `📦✨ Массовая ИИ Студия: ${stagedIds.length} отложенных колод`);
      document.getElementById('ai-active-deck-subtitle').innerText = `Массовая обработка для всех колод из очереди`;

      // Reset studio progress and previews
      document.getElementById('ai-batch-decks-bar').style.width = '0%';
      document.getElementById('ai-batch-cards-bar').style.width = '0%';
      document.getElementById('ai-percent-badge').innerText = '0%';
      document.getElementById('ai-batch-decks-progress-text').innerText = `0 / ${stagedIds.length} (0%)`;
      document.getElementById('ai-batch-cards-progress-text').innerText = `0 / ~0 (0%)`;
      document.getElementById('ai-active-status-text').innerText = 'Статус: Готов к массовому запуску';
      document.getElementById('ai-current-deck-badge').innerText = '';
      document.getElementById('ai-current-card-badge').innerText = '';
      document.getElementById('dryrun-preview-section').classList.add('hidden');
      document.getElementById('dryrun-cards-grid').innerHTML = '';
      document.getElementById('ai-logs-container').innerHTML = normalizedPreset === 'audio_only'
        ? `<div class="text-emerald-400">Готов к пакетному озвучиванию ${stagedIds.length} колод. Нажмите "Массовая озвучка всех (${stagedIds.length}) колод (TTS)".</div>`
        : (normalizedPreset === 'context_only'
          ? `<div class="text-purple-300">Готов к пакетному добавлению контекста для ${stagedIds.length} колод. Нажмите "Массово добавить ТОЛЬКО контекст".</div>`
          : `<div class="text-indigo-400">Готов к массовой генерации ${stagedIds.length} колод. Выберите "ТЕСТ пакета" или "Запустить МАССОВУЮ генерацию".</div>`);

      renderVoiceOptions('de');
      loadPrompts(null, 'de');
      loadBatchStudioSummary();
    }

async function loadBatchStudioSummary() {
      const stagedIds = Object.keys(stagedDecks);
      const listEl = document.getElementById('ai-batch-decks-list');
      if (!listEl) return;

      if (stagedIds.length === 0) {
        listEl.innerHTML = '<div class="text-slate-500 text-center py-4">Очередь колод пуста</div>';
        return;
      }

      listEl.innerHTML = '<div class="text-slate-500 text-center py-2">Загрузка информации о колодах...</div>';

      try {
        const res = await fetch('/api/admin/decks/batch/summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deck_ids: stagedIds })
        });
        const data = await res.json();
        const decks = data.decks || [];

        listEl.innerHTML = decks.map(d => `
          <div class="glass p-2.5 rounded-xl border border-slate-800 bg-slate-900/80 flex items-center justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 truncate">
                <span class="font-mono text-[10px] text-slate-500">#${d.id}</span>
                <span class="font-bold text-white text-xs truncate">${d.name}</span>
              </div>
              <div class="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400">
                <span class="uppercase font-semibold text-indigo-400">${d.target_language || 'DE'}</span>
                <span>•</span>
                <span class="text-slate-200">${d.card_count} карточек</span>
                ${d.missing_context_count > 0 ? `<span class="text-purple-400">• ${d.missing_context_count} без контекста</span>` : ''}
                ${d.missing_audio_count > 0 ? `<span class="text-amber-400">• ${d.missing_audio_count} без аудио</span>` : ''}
              </div>
            </div>
            <button onclick="removeStagedDeck('${d.id}')" title="Убрать из пакета" class="p-1 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition">
              <i data-lucide="x" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        `).join('');

        const summaryCards = document.getElementById('ai-batch-summary-cards-lbl');
        const summaryNoAudio = document.getElementById('ai-batch-summary-noaudio-lbl');
        if (summaryCards) summaryCards.innerText = data.total_cards || 0;
        if (summaryNoAudio) summaryNoAudio.innerText = `${data.total_missing_audio || 0} без озвучки`;
        document.getElementById('ai-batch-cards-progress-text').innerText = `0 / ${data.total_cards || 0} (0%)`;

        lucide.createIcons();
      } catch (err) {
        console.error("Failed to load batch summary", err);
        listEl.innerHTML = '<div class="text-rose-400 text-center py-2">Ошибка загрузки деталей пакета</div>';
      }
    }

async function startContextOnlyProcess() {
      selectStudioPreset('context_only');
      if (!activeRegenDeckId) {
        alert("Сначала выберите колоду!");
        return;
      }
      const deck = decksData.find(d => String(d.id) === String(activeRegenDeckId));
      const deckTitle = deck ? deck.name : '#' + activeRegenDeckId;
      if (!confirm(`Запустить генерацию ТОЛЬКО контекста (ИИ) для колоды "${deckTitle}"?\n\n• Обрабатываются только карточки БЕЗ контекста\n• Озвучка затрагиваться НЕ будет`)) {
        return;
      }
      await startAiProcess(false);
    }

async function startBatchContextOnlyProcess() {
      selectStudioPreset('context_only');
      const stagedIds = Object.keys(stagedDecks);
      if (stagedIds.length === 0) {
        alert("В очереди нет выбранных колод!");
        return;
      }
      if (!confirm(`Запустить МАССОВОЕ добавление ТОЛЬКО контекста для ${stagedIds.length} колод?\n\n• Будут обработаны только карточки БЕЗ контекста\n• Озвучка затрагиваться НЕ будет`)) {
        return;
      }
      await startBatchAiProcess(false);
    }

async function startAudioOnlyProcess() {
      if (!activeRegenDeckId) {
        alert("Сначала выберите колоду в списке 'Все колоды'!");
        switchTab('decks');
        return;
      }

      const selectedVoice = document.getElementById('regen-voice-select')?.value || 'de-DE-KatjaNeural';
      if (selectedVoice === 'none') {
        alert("Для перегенерации озвучки необходимо выбрать голос в списке!");
        return;
      }

      const uncheckedBoxes = document.querySelectorAll('.card-select-checkbox:not(:checked)');
      const excludedCardSet = new Set(Array.from(uncheckedBoxes).map(cb => parseInt(cb.value, 10)));
      committedDryRunCardIds.forEach(id => excludedCardSet.add(id));
      const excludedCardIds = Array.from(excludedCardSet);
      const skipCompleted = document.getElementById('regen-skip-completed')?.checked || false;
      const selectedRate = document.getElementById('regen-rate-select')?.value || '+0%';

      const options = {
        voice: selectedVoice,
        rate: selectedRate,
        only_missing_audio: false,
        skip_completed: skipCompleted,
        sync_copies: document.getElementById('regen-sync-copies')?.checked ?? true,
        exclude_card_ids: excludedCardIds,
        exclude_range_str: document.getElementById('regen-exclude-range')?.value.trim() || null
      };

      const deck = decksData.find(d => String(d.id) === String(activeRegenDeckId));
      const deckTitle = deck ? deck.name : '#' + activeRegenDeckId;

      if (!confirm(`Запустить перегенерацию ТОЛЬКО озвучки?\nКолода: "${deckTitle}"\nГолос: ${selectedVoice}\nСкорость: ${selectedRate}\n\nТексты, переводы и контексты затронуты НЕ будут.`)) {
        return;
      }

      document.getElementById('dryrun-preview-section').classList.add('hidden');
      document.getElementById('ai-progress-bar').style.width = '0%';
      document.getElementById('ai-percent-badge').innerText = '0%';
      document.getElementById('ai-active-status-text').innerText = 'Запуск озвучивания...';
      document.getElementById('ai-logs-container').innerHTML = `<div class="text-emerald-400">🎙️ Инициализация генерации озвучки (голос: ${selectedVoice}, скорость: ${selectedRate})...</div>`;

      try {
        const res = await fetch(`/api/admin/decks/${activeRegenDeckId}/regenerate-audio`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options)
        });
        const data = await res.json();
        startPollRegenStatus(activeRegenDeckId);
      } catch (err) {
        alert("Ошибка при запуске перегенерации озвучки: " + err);
      }
    }

async function startBatchAudioProcess() {
      const stagedIds = Object.keys(stagedDecks);
      if (stagedIds.length === 0) {
        alert("В очереди нет выбранных колод!");
        return;
      }

      const selectedVoice = document.getElementById('regen-voice-select')?.value || 'de-DE-KatjaNeural';
      if (selectedVoice === 'none') {
        alert("Для пакетного озвучивания необходимо выбрать голос в списке!");
        return;
      }

      const skipCompleted = document.getElementById('regen-skip-completed')?.checked || false;
      const selectedRate = document.getElementById('regen-rate-select')?.value || '+0%';

      committedDryRunCardIds.forEach(id => globalBatchExcludedCards.add(id));

      const options = {
        deck_ids: stagedIds,
        voice: selectedVoice,
        rate: selectedRate,
        only_missing_audio: false,
        skip_completed: skipCompleted,
        sync_copies: document.getElementById('regen-sync-copies')?.checked ?? true,
        delay: 0.3,
        exclude_card_ids: Array.from(globalBatchExcludedCards)
      };

      if (!confirm(`Запустить МАССОВОЕ озвучивание (TTS) для ${stagedIds.length} колод?\nГолос: ${selectedVoice}\nСкорость: ${selectedRate}`)) {
        return;
      }

      stopDryRunAudio();
      lastSingleDryRunKey = '';
      lastBatchDryRunKey = '';
      document.getElementById('dryrun-preview-section').classList.add('hidden');
      document.getElementById('ai-batch-decks-bar').style.width = '0%';
      document.getElementById('ai-batch-cards-bar').style.width = '0%';
      document.getElementById('ai-percent-badge').innerText = '0%';
      document.getElementById('ai-active-status-text').innerText = 'Запуск пакетного озвучивания...';
      document.getElementById('ai-logs-container').innerHTML = `<div class="text-emerald-400">🎙️ Инициализация массового TTS (${stagedIds.length} колод)...</div>`;

      try {
        const res = await fetch(`/api/admin/decks/batch/regenerate-audio`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options)
        });

        if (!res.ok) {
          let errText = '';
          try { const errData = await res.json(); errText = JSON.stringify(errData); } catch(_) { errText = await res.text().catch(() => ''); }
          document.getElementById('ai-logs-container').innerHTML = `<div class="text-rose-400">❌ Сервер вернул ошибку ${res.status}: ${errText.substring(0, 200)}</div>`;
          document.getElementById('ai-active-status-text').innerText = 'Статус: Ошибка запуска';
          return;
        }

        const data = await res.json();

        if (!data.task_id) {
          document.getElementById('ai-logs-container').innerHTML = `<div class="text-rose-400">❌ Сервер не вернул task_id. Ответ: ${JSON.stringify(data).substring(0, 200)}</div>`;
          document.getElementById('ai-active-status-text').innerText = 'Статус: Ошибка — нет task_id';
          return;
        }

        activeBatchTaskId = data.task_id;
        document.getElementById('ai-active-status-text').innerText = `Статус: Запущено (Task: ${data.task_id})`;
        startPollBatchRegenStatus(data.task_id);
      } catch (err) {
        document.getElementById('ai-logs-container').innerHTML = `<div class="text-rose-400">❌ Ошибка запуска: ${err}</div>`;
        document.getElementById('ai-active-status-text').innerText = 'Статус: Ошибка соединения';
        console.error("startBatchAudioProcess error:", err);
      }
    }

async function startAiProcess(isDryRun) {
      if (!activeRegenDeckId) {
        alert("Сначала выберите колоду в списке 'Все колоды'!");
        switchTab('decks');
        return;
      }

      const uncheckedBoxes = document.querySelectorAll('.card-select-checkbox:not(:checked)');
      const excludedCardSet = new Set(Array.from(uncheckedBoxes).map(cb => parseInt(cb.value, 10)));
      committedDryRunCardIds.forEach(id => excludedCardSet.add(id));
      const excludedCardIds = Array.from(excludedCardSet);
      const selectedVoice = document.getElementById('regen-voice-select')?.value || 'de-DE-KatjaNeural';
      const selectedRate = document.getElementById('regen-rate-select')?.value || '+0%';
      const skipCompleted = document.getElementById('regen-skip-completed')?.checked || false;
      const isNoAudio = (selectedVoice === 'none');

      const options = {
        dry_run: isDryRun,
        skip_completed: skipCompleted,
        no_audio: isNoAudio,
        sync_copies: document.getElementById('regen-sync-copies')?.checked ?? true,
        voice: selectedVoice,
        rate: selectedRate,
        prompt_id: document.getElementById('regen-prompt-select')?.value || 'preset_b1',
        native_lang: document.getElementById('regen-native-lang-select')?.value || 'uk',
        target_lang: activeDeckTargetLang || 'de',
        exclude_card_ids: excludedCardIds,
        exclude_range_str: document.getElementById('regen-exclude-range')?.value.trim() || null
      };

      if (!isDryRun) {
        if (!confirm(`Вы действительно хотите запустить генерацию карточек в боевую БД?`)) return;
      }

      stopDryRunAudio();
      lastSingleDryRunKey = '';
      lastBatchDryRunKey = '';
      document.getElementById('dryrun-preview-section').classList.add('hidden');
      document.getElementById('ai-progress-bar').style.width = '0%';
      document.getElementById('ai-percent-badge').innerText = '0%';
      document.getElementById('ai-active-status-text').innerText = `Запуск ${isDryRun ? 'Теста' : 'генерации'}...`;
      document.getElementById('ai-logs-container').innerHTML = `<div class="text-indigo-400">Инициализация ${isDryRun ? 'Dry-Run Теста (3 карточки)' : 'боевой генерации'}...</div>`;

      try {
        const res = await fetch(`/api/admin/decks/${activeRegenDeckId}/regenerate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options)
        });
        const data = await res.json();
        startPollRegenStatus(activeRegenDeckId);
      } catch (err) {
        alert("Ошибка при запуске перегенерации: " + err);
      }
    }

async function startBatchAiProcess(isDryRun) {
      const stagedIds = Object.keys(stagedDecks);
      if (stagedIds.length === 0) {
        alert("В очереди нет выбранных колод!");
        return;
      }

      const selectedVoice = document.getElementById('regen-voice-select')?.value || 'de-DE-KatjaNeural';
      const selectedRate = document.getElementById('regen-rate-select')?.value || '+0%';
      const skipCompleted = document.getElementById('regen-skip-completed')?.checked || false;
      const isNoAudio = (selectedVoice === 'none');

      committedDryRunCardIds.forEach(id => globalBatchExcludedCards.add(id));

      const options = {
        deck_ids: stagedIds,
        dry_run: isDryRun,
        skip_completed: skipCompleted,
        no_audio: isNoAudio,
        sync_copies: document.getElementById('regen-sync-copies')?.checked ?? true,
        voice: selectedVoice,
        rate: selectedRate,
        prompt_id: document.getElementById('regen-prompt-select')?.value || 'preset_b1',
        native_lang: document.getElementById('regen-native-lang-select')?.value || 'uk',
        target_lang: 'de',
        delay: 1.2,
        exclude_card_ids: Array.from(globalBatchExcludedCards)
      };

      const modeTitle = isDryRun ? 'ТЕСТ (Dry-Run: по 2 карточки на колоду)' : 'МАССОВУЮ генерацию в БД';
      if (!confirm(`Вы действительно хотите запустить ${modeTitle} для ${stagedIds.length} колод?`)) {
        return;
      }

      stopDryRunAudio();
      lastSingleDryRunKey = '';
      lastBatchDryRunKey = '';
      document.getElementById('dryrun-preview-section').classList.add('hidden');
      document.getElementById('ai-batch-decks-bar').style.width = '0%';
      document.getElementById('ai-batch-cards-bar').style.width = '0%';
      document.getElementById('ai-percent-badge').innerText = '0%';
      document.getElementById('ai-active-status-text').innerText = `Запуск ${isDryRun ? 'Теста' : 'Массовой генерации'}...`;
      document.getElementById('ai-logs-container').innerHTML = `<div class="text-indigo-400">Инициализация ${isDryRun ? 'Dry-Run Теста пакета' : 'массовой генерации'} (${stagedIds.length} колод)...</div>`;

      try {
        const res = await fetch(`/api/admin/decks/batch/regenerate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options)
        });

        if (!res.ok) {
          let errText = '';
          try { const errData = await res.json(); errText = JSON.stringify(errData); } catch(_) { errText = await res.text().catch(() => ''); }
          document.getElementById('ai-logs-container').innerHTML = `<div class="text-rose-400">❌ Сервер вернул ошибку ${res.status}: ${errText.substring(0, 200)}</div>`;
          document.getElementById('ai-active-status-text').innerText = 'Статус: Ошибка запуска';
          return;
        }

        const data = await res.json();

        if (!data.task_id) {
          document.getElementById('ai-logs-container').innerHTML = `<div class="text-rose-400">❌ Сервер не вернул task_id. Ответ: ${JSON.stringify(data).substring(0, 200)}</div>`;
          document.getElementById('ai-active-status-text').innerText = 'Статус: Ошибка — нет task_id';
          return;
        }

        activeBatchTaskId = data.task_id;
        document.getElementById('ai-active-status-text').innerText = `Статус: Запущено (Task: ${data.task_id})`;
        startPollBatchRegenStatus(data.task_id);
      } catch (err) {
        document.getElementById('ai-logs-container').innerHTML = `<div class="text-rose-400">❌ Ошибка запуска: ${err}</div>`;
        document.getElementById('ai-active-status-text').innerText = 'Статус: Ошибка соединения';
        console.error("startBatchAiProcess error:", err);
      }
    }

function startBatchFromSelection(mode = 'ai') {
      if (selectedDeckIds.size === 0) {
        alert("Выберите хотя бы одну колоду чекбоксом!");
        return;
      }

      stagedDecks = {};
      selectedDeckIds.forEach(sId => {
        const found = decksData.find(d => String(d.id) === sId);
        if (found) {
          stagedDecks[sId] = {
            id: sId,
            name: found.name || `Колода #${sId}`,
            target_language: found.target_language || 'de',
            level: found.level || '',
            card_count: found.card_count || 0,
            is_library: Boolean(found.is_library)
          };
        }
      });

      saveStagedDecksToStorage();
      updateStagingUI();
      openBatchRegenStudio(mode);
    }

function markDryRunCardsCommitted(cardIds) {
      if (!cardIds || cardIds.length === 0) return;
      cardIds.forEach(id => committedDryRunCardIds.add(Number(id)));

      // 1. In Single Deck Studio: uncheck these cards in #deck-cards-selector-list and add badge
      cardIds.forEach(id => {
        const cb = document.querySelector(`.card-select-checkbox[value="${id}"]`);
        if (cb) {
          cb.checked = false;
          const parentLabel = cb.closest('label');
          if (parentLabel && !parentLabel.querySelector('.committed-test-badge')) {
            const badge = document.createElement('span');
            badge.className = 'committed-test-badge ml-1.5 px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 rounded text-[10px] font-bold border border-emerald-500/30';
            badge.innerText = '✅ В БД (снята)';
            const textContainer = parentLabel.querySelector('.truncate');
            if (textContainer) textContainer.appendChild(badge);
          }
        }
      });

      // 2. In Batch Studio: add to globalBatchExcludedCards
      cardIds.forEach(id => globalBatchExcludedCards.add(Number(id)));
      const exclCardsLbl = document.getElementById('folder-excluded-cards-lbl');
      if (exclCardsLbl) {
        exclCardsLbl.innerText = `Исключено карточек: ${globalBatchExcludedCards.size}`;
      }

      // 3. Update preview cards UI in dryrun-cards-grid
      cardIds.forEach(id => {
        const btn = document.getElementById(`btn-dryrun-commit-${id}`);
        if (btn) {
          btn.outerHTML = `
            <span class="px-2 py-0.5 text-[10px] font-bold bg-emerald-500/20 text-emerald-300 rounded border border-emerald-500/30 inline-flex items-center gap-1">
              <i data-lucide="check-check" class="w-3 h-3"></i> В БД (снята)
            </span>
          `;
        }
      });
      if (window.lucide && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
      }
    }

async function commitSingleDryRunCard(cardId, btnEl) {
      if (btnEl) btnEl.disabled = true;
      const numId = Number(cardId);
      if (isBatchStudioMode) {
        if (!activeBatchTaskId) return;
        try {
          const res = await fetch(`/api/admin/decks/batch/${activeBatchTaskId}/control`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'commit_dry_run', card_ids: [numId] })
          });
          const data = await res.json();
          const committed = data.committed_card_ids || [numId];
          markDryRunCardsCommitted(committed);
        } catch (e) {
          console.error("Single dry run commit error", e);
          if (btnEl) btnEl.disabled = false;
        }
      } else {
        if (!activeRegenDeckId) return;
        try {
          const res = await fetch(`/api/admin/decks/${activeRegenDeckId}/regen-control`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'commit_dry_run', card_ids: [numId] })
          });
          const data = await res.json();
          const committed = data.committed_card_ids || [numId];
          markDryRunCardsCommitted(committed);
        } catch (e) {
          console.error("Single dry run commit error", e);
          if (btnEl) btnEl.disabled = false;
        }
      }
    }

async function controlActiveRegen(action) {
      if (isBatchStudioMode) {
        if (!activeBatchTaskId) return;
        try {
          const res = await fetch(`/api/admin/decks/batch/${activeBatchTaskId}/control`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: action })
          });
          const data = await res.json();
          if (action === 'commit_dry_run') {
            const committed = data.committed_card_ids || (window.currentDryRunResults || []).map(c => c.card_id);
            markDryRunCardsCommitted(committed);
            alert(data.message || `Успешно сохранено ${data.committed_count || committed.length} карточек в БД! Они сняты с последующей генерации.`);
            const commitAllBtn = document.getElementById('btn-commit-dryrun-all');
            if (commitAllBtn) {
              commitAllBtn.innerHTML = `<i data-lucide="check-check" class="w-3.5 h-3.5"></i> ✅ Все в БД (сняты с генерации)`;
              commitAllBtn.disabled = true;
              commitAllBtn.className = "px-3.5 py-1.5 bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-500/20 flex items-center gap-1.5 opacity-90";
              if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
            }
          }
        } catch (e) {
          console.error("Batch control error", e);
        }
      } else {
        if (!activeRegenDeckId) return;
        try {
          const res = await fetch(`/api/admin/decks/${activeRegenDeckId}/regen-control`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: action })
          });
          const data = await res.json();
          if (action === 'commit_dry_run') {
            stopDryRunAudio();
            const committed = data.committed_card_ids || (window.currentDryRunResults || []).map(c => c.card_id);
            markDryRunCardsCommitted(committed);
            alert(data.message || `Успешно сохранено ${data.committed_count || committed.length} карточек в БД! Они сняты с последующей генерации.`);
            const commitAllBtn = document.getElementById('btn-commit-dryrun-all');
            if (commitAllBtn) {
              commitAllBtn.innerHTML = `<i data-lucide="check-check" class="w-3.5 h-3.5"></i> ✅ Все в БД (сняты с генерации)`;
              commitAllBtn.disabled = true;
              commitAllBtn.className = "px-3.5 py-1.5 bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-500/20 flex items-center gap-1.5 opacity-90";
              if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
            }
          }
        } catch (e) {
          console.error("Regen control error", e);
        }
      }
    }

    let currentDryRunAudio = null;
    let currentPlayingDryRunIndex = null;
    let currentPlayingDryRunBtn = null;
    let lastSingleDryRunKey = '';
    let lastBatchDryRunKey = '';

function stopDryRunAudio() {
      if (currentDryRunAudio) {
        currentDryRunAudio.pause();
        currentDryRunAudio = null;
      }
      if (currentPlayingDryRunBtn) {
        setDryRunBtnState(currentPlayingDryRunBtn, false);
        currentPlayingDryRunBtn = null;
      }
      currentPlayingDryRunIndex = null;
    }

function setDryRunBtnState(btn, isPlaying) {
      if (!btn) return;
      if (isPlaying) {
        btn.className = "dryrun-audio-btn px-2.5 py-1.5 bg-emerald-600/30 text-emerald-300 border border-emerald-500/50 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shrink-0 shadow-sm mt-0.5";
        btn.innerHTML = `<i data-lucide="square" class="w-3.5 h-3.5 animate-pulse"></i> <span>Стоп</span>`;
      } else {
        btn.className = "dryrun-audio-btn px-2.5 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 hover:text-white border border-indigo-500/30 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shrink-0 shadow-sm mt-0.5";
        btn.innerHTML = `<i data-lucide="volume-2" class="w-3.5 h-3.5"></i> <span>Озвучка</span>`;
      }
      if (window.lucide && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
      }
    }

async function playDryRunCard(index, btn) {
      const card = window.currentDryRunResults && window.currentDryRunResults[index];
      if (!card || !card.front) return;

      if (currentPlayingDryRunIndex === index) {
        stopDryRunAudio();
        return;
      }

      stopDryRunAudio();

      currentPlayingDryRunIndex = index;
      currentPlayingDryRunBtn = btn;
      setDryRunBtnState(btn, true);

      let url;
      if (card.audio_path && card.audio_path.trim()) {
        const ap = card.audio_path.trim();
        url = ap.startsWith('http') ? ap : `/api/media/audio/${encodeURIComponent(ap)}?t=${Date.now()}`;
      } else {
        const voiceSelect = document.getElementById('regen-voice-select');
        const voice = (voiceSelect && voiceSelect.value !== 'none') ? voiceSelect.value : (card.voice || 'de-DE-KatjaNeural');
        const rateSelect = document.getElementById('regen-rate-select');
        const rate = rateSelect ? rateSelect.value : (card.rate || '+0%');
        url = `/api/admin/voice-preview?voice=${encodeURIComponent(voice)}&rate=${encodeURIComponent(rate)}&text=${encodeURIComponent(card.front)}&t=${Date.now()}`;
      }

      currentDryRunAudio = new Audio(url);
      currentDryRunAudio.onended = () => {
        stopDryRunAudio();
      };
      currentDryRunAudio.onerror = (e) => {
        console.error("Dry-run audio playback error", e);
        stopDryRunAudio();
        alert("Не удалось воспроизвести озвучку для тестовой карточки.");
      };

      try {
        await currentDryRunAudio.play();
      } catch (err) {
        console.error("Audio play failed", err);
        stopDryRunAudio();
      }
    }

function renderDryRunCards(results, isBatch = false) {
      const cardsGrid = document.getElementById('dryrun-cards-grid');
      if (!cardsGrid) return;
      window.currentDryRunResults = results || [];

      const esc = typeof escapeHtml === 'function' ? escapeHtml : (v => String(v ?? ''));
      const allCommitted = results && results.length > 0 && results.every(c => committedDryRunCardIds.has(Number(c.card_id)));
      const commitAllBtn = document.getElementById('btn-commit-dryrun-all');
      if (commitAllBtn) {
        if (allCommitted) {
          commitAllBtn.innerHTML = `<i data-lucide="check-check" class="w-3.5 h-3.5"></i> ✅ Все в БД (сняты с генерации)`;
          commitAllBtn.disabled = true;
          commitAllBtn.className = "px-3.5 py-1.5 bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-500/20 flex items-center gap-1.5 opacity-90";
        } else {
          commitAllBtn.innerHTML = `<i data-lucide="save" class="w-3.5 h-3.5"></i> 💾 Добавить результаты в БД (снять с генерации)`;
          commitAllBtn.disabled = false;
          commitAllBtn.className = "px-3.5 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:opacity-95 text-white text-xs font-bold rounded-xl shadow-lg shadow-purple-500/20 flex items-center gap-1.5 transition";
        }
      }

      cardsGrid.innerHTML = (results || []).map((c, i) => {
        const isPlaying = (currentPlayingDryRunIndex === i);
        const hasAudio = !!(c.audio_path && c.audio_path.trim());
        const safeDeckName = c.deck_name ? esc(c.deck_name) : (c.deck_id ? '#' + esc(c.deck_id) : '');
        const isCommitted = committedDryRunCardIds.has(Number(c.card_id));
        return `
          <div class="glass p-4 rounded-2xl border border-indigo-500/30 bg-slate-900/90 space-y-2.5 shadow-lg">
            <div class="flex justify-between items-center border-b border-slate-800 pb-2 flex-wrap gap-2">
              <div>
                <span class="font-bold text-xs uppercase text-indigo-400">
                  ${isBatch ? `Тест #${i + 1}` : `Тестовая карточка #${i + 1} (ID: ${esc(c.card_id)})`}
                </span>
                ${isBatch && safeDeckName ? `
                  <span class="text-xs text-slate-300 font-semibold ml-2">📦 ${safeDeckName}</span>
                ` : ''}
              </div>
              <div class="flex items-center gap-1.5 flex-wrap">
                ${hasAudio ? `
                  <span class="px-2 py-0.5 text-[10px] font-bold bg-emerald-500/20 text-emerald-300 rounded border border-emerald-500/30 inline-flex items-center gap-1" title="Аудио сгенерировано">
                    <i data-lucide="check" class="w-3 h-3"></i> Аудио готово
                  </span>
                ` : ''}
                ${c.level ? `
                  <span class="px-2 py-0.5 text-[10px] font-bold bg-indigo-500/20 text-indigo-300 rounded border border-indigo-500/30">${esc(c.level)}</span>
                ` : ''}
                ${isCommitted ? `
                  <span class="px-2 py-0.5 text-[10px] font-bold bg-emerald-500/20 text-emerald-300 rounded border border-emerald-500/30 inline-flex items-center gap-1">
                    <i data-lucide="check-check" class="w-3 h-3"></i> В БД (снята)
                  </span>
                ` : `
                  <button type="button" onclick="commitSingleDryRunCard('${esc(c.card_id)}', this)" id="btn-dryrun-commit-${esc(c.card_id)}" class="px-2.5 py-0.5 text-[10px] font-bold bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white rounded border border-indigo-500/40 inline-flex items-center gap-1 transition shadow-sm" title="Добавить эту карточку в БД и снять с последующей генерации">
                    <i data-lucide="plus-circle" class="w-3 h-3"></i> 💾 В БД (снять)
                  </button>
                `}
              </div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
              <div class="bg-slate-950 p-2.5 rounded-xl border border-slate-800 flex justify-between items-start gap-2">
                <div class="min-w-0 flex-1">
                  <div class="text-[10px] font-semibold text-slate-500 uppercase">Лицевая сторона (Front):</div>
                  <div class="text-white font-bold text-sm mt-0.5 break-words">${esc(c.front || '')}</div>
                </div>
                ${c.front ? `
                  <button type="button" onclick="playDryRunCard(${i}, this)" id="btn-dryrun-audio-${i}" title="Прослушать озвучку" class="dryrun-audio-btn px-2.5 py-1.5 ${isPlaying ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500/50' : 'bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 hover:text-white border-indigo-500/30'} border rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shrink-0 shadow-sm mt-0.5">
                    <i data-lucide="${isPlaying ? 'square' : 'volume-2'}" class="w-3.5 h-3.5 ${isPlaying ? 'animate-pulse' : ''}"></i>
                    <span>${isPlaying ? 'Стоп' : 'Озвучка'}</span>
                  </button>
                ` : ''}
              </div>
              <div class="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                <div class="text-[10px] font-semibold text-slate-500 uppercase">Обратная сторона (Back):</div>
                <div class="text-emerald-300 font-semibold text-sm mt-0.5 break-words">${esc(c.back || '')}</div>
              </div>
            </div>
            ${c.context ? `
              <div class="bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs leading-relaxed text-slate-200">
                <div class="text-[10px] font-semibold text-indigo-400 uppercase mb-1">Сгенерированный контекст / Грамматика / Примеры:</div>
                <div class="whitespace-pre-wrap font-sans text-slate-300 text-[11px]">${esc(c.context)}</div>
              </div>
            ` : ''}
          </div>
        `;
      }).join('');

      if (window.lucide && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
      }
    }

function startPollRegenStatus(deckId) {
      if (regenInterval) clearInterval(regenInterval);

      regenInterval = setInterval(async () => {
        try {
          const res = await fetch(`/api/admin/decks/${deckId}/regen-status`);
          const data = await res.json();

          const total = data.total || 1;
          const processed = data.processed || 0;
          const pct = Math.round((processed / total) * 100);

          document.getElementById('ai-progress-bar').style.width = `${pct}%`;
          document.getElementById('ai-percent-badge').innerText = `${pct}%`;
          document.getElementById('ai-active-status-text').innerText = `Статус: ${data.status.toUpperCase()} (${processed}/${total})`;

          if (data.current_card) {
            document.getElementById('ai-current-card-badge').innerText = data.current_card;
          }

          const logsContainer = document.getElementById('ai-logs-container');
          logsContainer.innerHTML = (data.logs || []).map(l => `<div>${l}</div>`).join('');
          logsContainer.scrollTop = logsContainer.scrollHeight;

          const previewSec = document.getElementById('dryrun-preview-section');

          if (data.is_dry_run && data.dry_run_results && data.dry_run_results.length > 0) {
            if (previewSec) previewSec.classList.remove('hidden');
            const dryRunKey = JSON.stringify(data.dry_run_results.map(c => [c.card_id, c.audio_path || '', c.front || '']));
            if (dryRunKey !== lastSingleDryRunKey) {
              lastSingleDryRunKey = dryRunKey;
              renderDryRunCards(data.dry_run_results, false);
            }
          }

          if (data.status === 'completed' || data.status === 'failed' || data.status === 'stopped') {
            clearInterval(regenInterval);
          }
        } catch (e) {
          console.error("Poll status error", e);
        }
      }, 1000);
    }

function startPollBatchRegenStatus(taskId) {
      if (batchRegenInterval) clearInterval(batchRegenInterval);

      batchRegenInterval = setInterval(async () => {
        try {
          const res = await fetch(`/api/admin/decks/batch/${taskId}/status`);
          const data = await res.json();

          const totalDecks = data.total_decks || 1;
          const processedDecks = data.processed_decks || 0;
          const deckPct = Math.round((processedDecks / totalDecks) * 100);

          const totalCards = data.total_cards || 1;
          const processedCards = data.processed_cards || 0;
          const cardPct = Math.round((processedCards / totalCards) * 100);

          document.getElementById('ai-batch-decks-bar').style.width = `${deckPct}%`;
          document.getElementById('ai-batch-decks-progress-text').innerText = `${processedDecks} / ${totalDecks} (${deckPct}%)`;

          document.getElementById('ai-batch-cards-bar').style.width = `${cardPct}%`;
          document.getElementById('ai-batch-cards-progress-text').innerText = `${processedCards} / ${totalCards} (${cardPct}%)`;

          document.getElementById('ai-percent-badge').innerText = `${cardPct}%`;
          document.getElementById('ai-active-status-text').innerText = `Статус: ${data.status.toUpperCase()} (Колоды: ${processedDecks}/${totalDecks}, Карточки: ${processedCards}/${totalCards})`;

          if (data.current_deck_name) {
            document.getElementById('ai-current-deck-badge').innerText = `📦 ${data.current_deck_name}`;
          }
          if (data.current_card) {
            document.getElementById('ai-current-card-badge').innerText = `• 🗂️ ${data.current_card}`;
          }

          const logsContainer = document.getElementById('ai-logs-container');
          logsContainer.innerHTML = (data.logs || []).map(l => `<div>${l}</div>`).join('');
          logsContainer.scrollTop = logsContainer.scrollHeight;

          // Render Dry Run preview cards grouped by deck
          const previewSec = document.getElementById('dryrun-preview-section');

          if (data.is_dry_run && data.dry_run_results && data.dry_run_results.length > 0) {
            if (previewSec) previewSec.classList.remove('hidden');
            const dryRunKey = JSON.stringify(data.dry_run_results.map(c => [c.card_id, c.deck_id, c.audio_path || '', c.front || '']));
            if (dryRunKey !== lastBatchDryRunKey) {
              lastBatchDryRunKey = dryRunKey;
              renderDryRunCards(data.dry_run_results, true);
            }
          }

          const failedBanner = document.getElementById('ai-failed-actions-banner');
          const failedCountTitle = document.getElementById('ai-failed-count-title');
          const failedIds = data.failed_card_ids || [];

          if (failedIds.length > 0) {
            if (failedBanner) failedBanner.classList.remove('hidden');
            if (failedCountTitle) failedCountTitle.innerText = `⚠️ Обнаружены карточки с ошибками / неполные (${failedIds.length} шт.)`;
            lucide.createIcons();
          } else if (data.status === 'completed' && failedBanner) {
            failedBanner.classList.add('hidden');
          }

          if (data.status === 'completed' || data.status === 'failed' || data.status === 'stopped') {
            clearInterval(batchRegenInterval);
          }
        } catch (e) {
          console.error("Batch poll status error", e);
        }
      }, 1000);
    }

async function retryFailedCardsFromTask(customTaskId = null) {
      const taskId = customTaskId || activeBatchTaskId;
      try {
        const btn = document.getElementById('btn-retry-failed-cards');
        if (btn) {
          btn.disabled = true;
          btn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> Запуск...`;
        }

        const res = await fetch('/api/admin/tasks/retry-failed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task_id: taskId })
        });
        const data = await res.json();

        if (res.ok && data.status === 'ok') {
          activeBatchTaskId = data.task_id;
          isBatchStudioMode = true;
          document.getElementById('ai-failed-actions-banner')?.classList.add('hidden');
          document.getElementById('ai-active-status-text').innerText = `Статус: Повторная генерация ${data.cards_count} ошибок...`;
          startPollBatchRegenStatus(data.task_id);
        } else {
          alert("Не удалось запустить повтор: " + (data.detail || data.message || 'нет карточек для повтора'));
        }
      } catch (err) {
        alert("Ошибка при повторе: " + err);
      } finally {
        const btn = document.getElementById('btn-retry-failed-cards');
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = `<i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> 🔄 Перегенерировать ошибки`;
          lucide.createIcons();
        }
      }
    }

async function checkSavedCheckpoint(isInit = false) {
      try {
        const res = await fetch('/api/admin/tasks/checkpoint');
        const data = await res.json();
        const banner = document.getElementById('ai-resume-checkpoint-banner');

        if (data.checkpoint) {
          const ckpt = data.checkpoint;
          const isRunning = ckpt.status === 'running';

          if (isInit && isRunning) {
            // Auto-reconnect to running task on page load
            if (ckpt.task_type && ckpt.task_type.startsWith('batch_')) {
              isBatchStudioMode = true;
              activeBatchTaskId = ckpt.task_id;
              switchTab('ai');
              startPollBatchRegenStatus(ckpt.task_id);
              return;
            } else if (ckpt.task_type === 'single_ai' || ckpt.task_type === 'single_audio') {
              isBatchStudioMode = false;
              activeRegenDeckId = ckpt.deck_id || ckpt.current_deck_id;
              switchTab('ai');
              startPollRegenStatus(activeRegenDeckId);
              return;
            } else if (ckpt.task_type === 'classification') {
              activeClassificationTaskId = ckpt.task_id;
              switchTab('classification');
              startPollClassificationStatus(ckpt.task_id);
              return;
            } else if (ckpt.task_type === 'bulk_create') {
              activeBulkTaskId = ckpt.task_id;
              switchTab('bulk');
              startPollBulkStatus(ckpt.task_id);
              return;
            }
          }

          if (banner && data.can_resume) {
            const typeBadge = document.getElementById('ckpt-banner-type-badge');
            const descEl = document.getElementById('ckpt-banner-desc');
            const resumeBtn = document.getElementById('btn-resume-checkpoint');

            const typeName = ckpt.task_type === 'batch_ai' ? 'Массовый ИИ'
              : ckpt.task_type === 'batch_audio' ? 'Массовая озвучка'
              : ckpt.task_type === 'bulk_create' ? 'Массовое создание'
              : ckpt.task_type === 'classification' ? 'CEFR классификация'
              : ckpt.task_type === 'single_audio' ? 'Озвучка колоды' : 'ИИ Перегенерация';

            if (typeBadge) typeBadge.innerText = typeName;
            
            let desc = '';
            if (ckpt.task_type === 'classification') {
              desc = `Режим: <b>${ckpt.mode || 'audit'}</b> • Словарь: <b>${ckpt.vocab_profile || 'medium'}</b>`;
            } else {
              desc = `Колода: <b>${ckpt.current_deck_name || ('#' + ckpt.current_deck_id)}</b>`;
              if (ckpt.current_card) desc += ` • Карточка: <i>${ckpt.current_card}</i>`;
            }
            if (ckpt.processed_cards !== undefined) desc += ` (${ckpt.processed_cards}/${ckpt.total_cards || '?'})`;
            if (descEl) descEl.innerHTML = desc;

            const startIdx = (ckpt.current_card_index || 0) + 1;
            if (resumeBtn) resumeBtn.innerHTML = `<i data-lucide="play" class="w-3.5 h-3.5"></i> ▶ Продолжить с №${startIdx}`;

            banner.classList.remove('hidden');
            lucide.createIcons();
          } else if (banner) {
            banner.classList.add('hidden');
          }
        } else if (banner) {
          banner.classList.add('hidden');
        }

        if (isInit) {
          const savedTab = localStorage.getItem('lerne_admin_tab') || 'users';
          switchTab(savedTab);
        }
      } catch (e) {
        console.error("Checkpoint check error", e);
        if (isInit) {
          const savedTab = localStorage.getItem('lerne_admin_tab') || 'users';
          switchTab(savedTab);
        }
      }
    }

async function resumeSavedCheckpoint() {
      const banner = document.getElementById('ai-resume-checkpoint-banner');
      try {
        const res = await fetch('/api/admin/tasks/resume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const data = await res.json();

        if (res.ok && data.status === 'resumed') {
          banner.classList.add('hidden');
          const taskId = data.task_id;
          const taskType = data.task_type;

          if (taskType.startsWith('batch_')) {
            isBatchStudioMode = true;
            activeBatchTaskId = taskId;
            switchTab('ai');
            startPollBatchRegenStatus(taskId);
          } else if (taskType === 'bulk_create') {
            activeBulkTaskId = taskId;
            switchTab('bulk');
            startPollBulkStatus(taskId);
          } else if (taskType === 'classification') {
            activeClassificationTaskId = taskId;
            switchTab('classification');
            startPollClassificationStatus(taskId);
          } else {
            isBatchStudioMode = false;
            activeRegenDeckId = data.deck_id || data.current_deck_id;
            switchTab('ai');
            startPollRegenStatus(activeRegenDeckId);
          }
        } else {
          alert("Не удалось возобновить задачу: " + (data.detail || data.message || 'нет доступного чекпоинта'));
        }
      } catch (e) {
        alert("Ошибка при возобновлении: " + e);
      }
    }

async function clearSavedCheckpoint() {
      try {
        await fetch('/api/admin/tasks/clear-checkpoint', { method: 'POST' });
        const banner = document.getElementById('ai-resume-checkpoint-banner');
        if (banner) banner.classList.add('hidden');
      } catch (e) {
        console.error("Clear checkpoint error", e);
      }
    }

    let usersStats = { total: 0, registered: 0, guest: 0 };


/**
 * Copies AI studio live logs to clipboard.
 */
function copyAiLogsToClipboard() {
  const container = document.getElementById('ai-logs-container');
  if (!container) return;
  navigator.clipboard.writeText(container.innerText).then(() => {
    if (typeof showToast === 'function') showToast('Лог перегенерации скопирован!', 'info');
  }).catch(() => {
    alert('Лог скопирован');
  });
}
