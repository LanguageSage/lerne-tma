/**
 * staged.js — Lerne TMA Admin Module
 */
function loadStagedDecksFromStorage() {
      try {
        const raw = localStorage.getItem(STAGED_STORAGE_KEY);
        if (raw) {
          stagedDecks = JSON.parse(raw) || {};
        }
      } catch (e) {
        stagedDecks = {};
      }
    }

function saveStagedDecksToStorage() {
      try {
        localStorage.setItem(STAGED_STORAGE_KEY, JSON.stringify(stagedDecks));
      } catch (e) {
        console.error("Failed to save staged decks to localStorage", e);
      }
    }

function isDeckStaged(deckId) {
      return Boolean(stagedDecks[String(deckId)]);
    }

function toggleStageDeck(deckId) {
      const sId = String(deckId);
      if (stagedDecks[sId]) {
        delete stagedDecks[sId];
      } else {
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
        } else {
          stagedDecks[sId] = {
            id: sId,
            name: `Колода #${sId}`,
            target_language: 'de',
            level: '',
            card_count: 0,
            is_library: false
          };
        }
      }
      saveStagedDecksToStorage();
      updateStagingUI();
      renderDecksTable(currentRenderedDecks);
    }

function removeStagedDeck(deckId) {
      const sId = String(deckId);
      delete stagedDecks[sId];
      saveStagedDecksToStorage();
      updateStagingUI();
      renderDecksTable(currentRenderedDecks);
      if (!document.getElementById('modal-staged-decks').classList.contains('hidden')) {
        renderStagedDecksModalList();
      }
      if (isBatchStudioMode) {
        loadBatchStudioSummary();
      }
    }

function clearStagedDecks() {
      if (Object.keys(stagedDecks).length === 0) {
        alert("Очередь колод уже пуста.");
        return;
      }
      if (!confirm(`Очистить всю очередь (${Object.keys(stagedDecks).length} колод)?`)) return;
      stagedDecks = {};
      globalBatchExcludedCards.clear();
      saveStagedDecksToStorage();
      updateStagingUI();
      renderDecksTable(currentRenderedDecks);
      closeModal('modal-staged-decks');
      if (isBatchStudioMode) {
        loadBatchStudioSummary();
      }
    }

function clearStagedDecksAndReturn() {
      stagedDecks = {};
      globalBatchExcludedCards.clear();
      saveStagedDecksToStorage();
      updateStagingUI();
      switchTab('decks');
      renderDecksTable(currentRenderedDecks);
    }

    // ─── Unified Deck Selection State ──────────────────────────────────────────
    let selectedDeckIds = new Set();

function stageSelectedDecks() {
      if (selectedDeckIds.size === 0) return;

      selectedDeckIds.forEach(sId => {
        if (!stagedDecks[sId]) {
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
        }
      });

      saveStagedDecksToStorage();
      updateStagingUI();
      renderDecksTable(currentRenderedDecks);
      clearDeckSelection();
    }

function updateStagingUI() {
      const stagedList = Object.values(stagedDecks);
      const count = stagedList.length;
      let totalCards = 0;
      const langs = new Set();

      stagedList.forEach(d => {
        totalCards += (d.card_count || 0);
        if (d.target_language) langs.add(d.target_language.toUpperCase());
      });

      // Update Header Queue Bar
      const headerCount = document.getElementById('header-staged-count');
      const headerCards = document.getElementById('header-staged-cards');
      const headerClearBtn = document.getElementById('btn-header-clear-staged');
      const headerBox = document.getElementById('btn-header-staged');
      if (headerCount) headerCount.innerText = count;
      if (headerCards) headerCards.innerText = totalCards;
      if (headerClearBtn) {
        if (count > 0) {
          headerClearBtn.classList.remove('hidden');
        } else {
          headerClearBtn.classList.add('hidden');
        }
      }
      if (headerBox) {
        if (count > 0) {
          headerBox.className = 'px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 bg-indigo-950/60 hover:bg-indigo-900/80 text-indigo-200 border border-indigo-500/40 shadow-sm cursor-pointer';
        } else {
          headerBox.className = 'px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 bg-slate-800/80 hover:bg-slate-800 text-slate-300 border border-slate-700/60 cursor-pointer';
        }
      }

      // Update Toolbar badge
      const toolbarCount = document.getElementById('toolbar-staged-count');
      if (toolbarCount) toolbarCount.innerText = count;

      // Update modal stats
      const modalStatDecks = document.getElementById('modal-staged-stat-decks');
      const modalStatCards = document.getElementById('modal-staged-stat-cards');
      if (modalStatDecks && modalStatCards) {
        modalStatDecks.innerText = count;
        modalStatCards.innerText = totalCards;
      }

      // Update labels in batch AI Studio
      document.querySelectorAll('.batch-total-decks-lbl').forEach(el => el.innerText = count);
      const summaryCardsLbl = document.getElementById('ai-batch-summary-cards-lbl');
      if (summaryCardsLbl) summaryCardsLbl.innerText = totalCards;
      try { lucide.createIcons(); } catch(_) {}
    }

async function openStagedDecksModal() {
      const stagedIds = Object.keys(stagedDecks);
      if (stagedIds.length === 0) {
        alert("В очереди пока нет отложенных колод. Найдите колоды через поиск и нажмите '➕ Отложить'!");
        switchTab('decks');
        return;
      }

      renderStagedDecksModalList();
      document.getElementById('modal-staged-decks').classList.remove('hidden');
      lucide.createIcons();

      // Fetch fresh summary stats in background
      try {
        const res = await fetch('/api/admin/decks/batch/summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deck_ids: stagedIds })
        });
        const data = await res.json();
        if (data.decks) {
          data.decks.forEach(d => {
            if (stagedDecks[d.id]) {
              stagedDecks[d.id].card_count = d.card_count;
              stagedDecks[d.id].missing_audio_count = d.missing_audio_count;
            }
          });
          saveStagedDecksToStorage();
          renderStagedDecksModalList(data);
        }
      } catch (e) {
        console.error("Batch summary error", e);
      }
    }

function renderStagedDecksModalList(summaryData = null) {
      const listEl = document.getElementById('modal-staged-decks-list');
      if (!listEl) return;

      const decks = summaryData && summaryData.decks ? summaryData.decks : Object.values(stagedDecks);
      if (decks.length === 0) {
        listEl.innerHTML = '<div class="text-slate-500 text-center py-6">В очереди нет отложенных колод</div>';
        return;
      }

      let totalCards = 0;
      let totalMissingAudio = 0;

      listEl.innerHTML = decks.map(d => {
        const cCount = d.card_count || 0;
        const mAudio = d.missing_audio_count !== undefined ? d.missing_audio_count : 0;
        totalCards += cCount;
        totalMissingAudio += mAudio;

        return `
          <div class="glass p-3 rounded-xl border border-slate-800 bg-slate-900/80 flex items-center justify-between gap-3 hover:border-slate-700 transition">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-mono text-[11px] text-slate-500">#${d.id}</span>
                <span class="font-bold text-white text-xs truncate">${d.name}</span>
                ${d.is_library ? '<span class="px-1.5 py-0.5 bg-amber-500/10 text-amber-300 text-[10px] font-bold rounded border border-amber-500/20">Библиотека ⭐</span>' : ''}
              </div>
              <div class="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                <span class="uppercase font-semibold text-indigo-400">${d.target_language || 'DE'}</span>
                <span>•</span>
                <span class="text-slate-300 font-medium">${cCount} карточек</span>
                ${mAudio > 0 ? `<span class="text-amber-400">• ${mAudio} без звука</span>` : ''}
              </div>
            </div>
            <button onclick="removeStagedDeck('${d.id}')" title="Убрать из очереди" class="px-2 py-1.5 text-rose-400 hover:bg-rose-500/20 rounded-lg text-xs transition shrink-0 flex items-center gap-1 font-semibold">
              <i data-lucide="x" class="w-3.5 h-3.5"></i> Убрать
            </button>
          </div>
        `;
      }).join('');

      const statDecks = document.getElementById('modal-staged-stat-decks');
      const statCards = document.getElementById('modal-staged-stat-cards');
      const statNoAudio = document.getElementById('modal-staged-stat-noaudio');
      if (statDecks) statDecks.innerText = decks.length;
      if (statCards) statCards.innerText = totalCards;
      if (statNoAudio) statNoAudio.innerText = totalMissingAudio;
      lucide.createIcons();
    }

    const ADMIN_VOICES_BY_LANG = {
      de: [
        { group: '🇩🇪 Германия', voices: [
          { value: 'de-DE-KatjaNeural', label: 'Катя (♀️ Женский — по умолчанию)', default: true },
          { value: 'de-DE-AmalaNeural', label: 'Амала (♀️ Женский)' },
          { value: 'de-DE-SeraphinaMultilingualNeural', label: 'Серафина (♀️ Женский)' },
          { value: 'de-DE-KillianNeural', label: 'Киллиан (♂️ Мужской)' },
          { value: 'de-DE-ConradNeural', label: 'Конрад (♂️ Мужской)' },
          { value: 'de-DE-FlorianMultilingualNeural', label: 'Флориан (♂️ Мужской)' },
        ]},
        { group: '🇦🇹 Австрия', voices: [
          { value: 'de-AT-IngridNeural', label: 'Ингрид (♀️ Женский)' },
          { value: 'de-AT-JonasNeural', label: 'Йонас (♂️ Мужской)' },
        ]},
        { group: '🇨🇭 Швейцария', voices: [
          { value: 'de-CH-JanNeural', label: 'Ян (♂️ Мужской)' },
          { value: 'de-CH-LeniNeural', label: 'Лени (♀️ Женский)' },
        ]}
      ],
      en: [
        { group: '🇺🇸 США', voices: [
          { value: 'en-US-JennyNeural', label: 'Дженни (♀️ Женский — по умолчанию)', default: true },
          { value: 'en-US-AriaNeural', label: 'Ария (♀️ Женский)' },
          { value: 'en-US-AvaNeural', label: 'Ава (♀️ Женский)' },
          { value: 'en-US-EmmaNeural', label: 'Эмма (♀️ Женский)' },
          { value: 'en-US-GuyNeural', label: 'Гай (♂️ Мужской)' },
          { value: 'en-US-BrianNeural', label: 'Брайан (♂️ Мужской)' },
          { value: 'en-US-AndrewNeural', label: 'Эндрю (♂️ Мужской)' },
        ]},
        { group: '🇬🇧 Великобритания', voices: [
          { value: 'en-GB-SoniaNeural', label: 'Соня (♀️ Женский)' },
          { value: 'en-GB-MaisieNeural', label: 'Мэйзи (♀️ Женский)' },
          { value: 'en-GB-RyanNeural', label: 'Райан (♂️ Мужской)' },
          { value: 'en-GB-ThomasNeural', label: 'Томас (♂️ Мужской)' },
        ]}
      ],
      no: [
        { group: '🇳🇴 Норвегия (Bokmål)', voices: [
          { value: 'nb-NO-FinnNeural', label: 'Финн (♂️ Мужской — по умолчанию)', default: true },
          { value: 'nb-NO-PernilleNeural', label: 'Пернилле (♀️ Женский)' },
          { value: 'nb-NO-IselinNeural', label: 'Иселин (♀️ Женский)' },
        ]}
      ],
      uk: [
        { group: '🇺🇦 Украина', voices: [
          { value: 'uk-UA-PolinaNeural', label: 'Поліна (♀️ Жіночий — за замовчуванням)', default: true },
          { value: 'uk-UA-OstapNeural', label: 'Остап (♂️ Чоловічий)' },
        ]}
      ],
      ru: [
        { group: '🇷🇺 Россия', voices: [
          { value: 'ru-RU-SvetlanaNeural', label: 'Светлана (♀️ Женский — по умолчанию)', default: true },
          { value: 'ru-RU-DmitryNeural', label: 'Дмитрий (♂️ Мужской)' },
        ]}
      ]
    };

