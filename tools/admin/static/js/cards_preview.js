/**
 * cards_preview.js — Lerne TMA Admin Module
 */
async function openDeckPreviewModal(deckId, deckName = '') {
      previewDeckId = deckId;
      const modal = document.getElementById('modal-deck-preview');
      modal.classList.remove('hidden');

      const titleEl = document.getElementById('preview-deck-title');
      const idBadge = document.getElementById('preview-deck-id-badge');
      const libBadge = document.getElementById('preview-deck-lib-badge');
      const subtitleEl = document.getElementById('preview-deck-subtitle');
      const tbody = document.getElementById('preview-cards-tbody');

      if (titleEl) titleEl.innerText = deckName || `Колода #${deckId}`;
      if (idBadge) idBadge.innerText = `#${deckId}`;
      tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-slate-500">Загрузка карточек колоды...</td></tr>';

      try {
        const res = await fetch(`/api/admin/decks/${deckId}/cards`);
        const data = await res.json();
        previewDeckData = data;
        previewCardsList = data.cards || [];

        const isLib = Boolean(data.deck_is_library || String(deckId).startsWith('lib_'));
        if (libBadge) {
          if (isLib) libBadge.classList.remove('hidden');
          else libBadge.classList.add('hidden');
        }

        const lang = (data.target_language || 'de').toUpperCase();
        const lvl = data.level || '';
        if (subtitleEl) subtitleEl.innerText = `Язык: ${lang} • Уровень: ${lvl || 'Не указан'} • Владелец: ${data.user_id ? 'ID ' + data.user_id : 'Библиотека'}`;

        // Health overview stats
        const total = data.total_cards || previewCardsList.length || 0;
        const withAudio = data.cards_with_audio || previewCardsList.filter(c => c.has_audio).length;
        const withContext = data.cards_with_context || previewCardsList.filter(c => c.has_context).length;
        const missingAudioCount = Math.max(0, total - withAudio);
        const missingContextCount = Math.max(0, total - withContext);

        const missingAudioLbl = document.getElementById('preview-missing-audio-count');
        const missingCtxLbl = document.getElementById('preview-missing-ctx-count');
        if (missingAudioLbl) missingAudioLbl.innerText = missingAudioCount;
        if (missingCtxLbl) missingCtxLbl.innerText = missingContextCount;

        const audioPct = total > 0 ? Math.round((withAudio / total) * 100) : 0;
        const ctxPct = total > 0 ? Math.round((withContext / total) * 100) : 0;

        document.getElementById('preview-stat-audio').innerText = `${withAudio} / ${total} (${audioPct}%)`;
        document.getElementById('preview-bar-audio').style.width = `${audioPct}%`;

        document.getElementById('preview-stat-context').innerText = `${withContext} / ${total} (${ctxPct}%)`;
        document.getElementById('preview-bar-context').style.width = `${ctxPct}%`;

        const healthPill = document.getElementById('preview-health-pill');
        if (total === 0) {
          healthPill.className = 'px-2.5 py-1 font-bold rounded-lg text-[11px] bg-slate-800 text-slate-400';
          healthPill.innerText = '⚪ Пустая колода';
        } else if (audioPct === 100 && ctxPct === 100) {
          healthPill.className = 'px-2.5 py-1 font-bold rounded-lg text-[11px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
          healthPill.innerText = '✅ Полностью готова (100%)';
        } else if (audioPct < 100 && ctxPct === 100) {
          healthPill.className = 'px-2.5 py-1 font-bold rounded-lg text-[11px] bg-amber-500/20 text-amber-300 border border-amber-500/30';
          healthPill.innerText = `⚠️ Требуется озвучка (${missingAudioCount} без звука)`;
        } else {
          healthPill.className = 'px-2.5 py-1 font-bold rounded-lg text-[11px] bg-purple-500/20 text-purple-300 border border-purple-500/30';
          healthPill.innerText = `⚠️ Требуется ИИ генерация (${missingContextCount} без контекста)`;
        }

        renderPreviewCardsTable(previewCardsList);
      } catch (err) {
        console.error("Preview load error", err);
        tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-rose-400">Ошибка загрузки карточек колоды</td></tr>';
      }
    }

function renderPreviewCardsTable(cards) {
      const tbody = document.getElementById('preview-cards-tbody');
      if (!tbody) return;

      if (!cards || cards.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-slate-500">В этой выборке нет карточек</td></tr>';
        return;
      }

      tbody.innerHTML = cards.map(c => {
        const safeAudio = (c.audio_path || '').replace(/'/g, "\\'");
        const safeFront = (c.front || '').replace(/'/g, "\\'");

        let audioCell = '';
        if (c.has_audio) {
          audioCell = `
            <button onclick="playAudioFile('${safeAudio}', event)" title="Воспроизвести озвучку" class="p-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 rounded-lg transition inline-flex items-center gap-1 font-bold text-[11px]">
              <i data-lucide="volume-2" class="w-3.5 h-3.5"></i> ▶
            </button>
          `;
        } else {
          audioCell = `
            <button onclick="synthesizeSingleCardAudio('${c.id}', '${safeFront}')" id="btn-synth-card-${c.id}" title="Сгенерировать озвучку Edge-TTS" class="px-2 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded-lg text-[10px] font-bold transition inline-flex items-center gap-1 border border-amber-500/30">
              <i data-lucide="mic" class="w-3 h-3"></i> Озвучить
            </button>
          `;
        }

        return `
          <tr class="hover:bg-slate-900/60 transition ${!c.is_complete ? 'bg-amber-950/10' : ''}">
            <td class="px-3 py-2.5 font-mono text-slate-500 text-[11px]">#${c.position || c.id}</td>
            <td class="px-3 py-2.5 font-bold text-white text-xs">${c.front || '<i class="text-slate-600">(пусто)</i>'}</td>
            <td class="px-3 py-2.5 text-center">${audioCell}</td>
            <td class="px-3 py-2.5 text-emerald-300 font-medium text-xs">${c.back || '<i class="text-slate-600">(нет перевода)</i>'}</td>
            <td class="px-3 py-2.5 text-[11px] text-slate-300 font-sans leading-relaxed max-w-xs truncate" title="${(c.context || '').replace(/"/g, '&quot;')}">
              ${c.context || '<span class="text-purple-400/80">⚠️ Нет контекста</span>'}
            </td>
            <td class="px-3 py-2.5 text-[10px] font-mono font-bold text-indigo-400">${c.tags || c.level || '—'}</td>
            <td class="px-3 py-2.5 text-right space-x-1 whitespace-nowrap">
              <button onclick="openCardEditModal('${c.id}')" title="Редактировать" class="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition">
                <i data-lucide="edit-3" class="w-3.5 h-3.5 inline"></i>
              </button>
              <button onclick="deleteCard('${c.id}')" title="Удалить карточку" class="p-1 text-rose-400 hover:bg-rose-500/20 rounded transition">
                <i data-lucide="trash-2" class="w-3.5 h-3.5 inline"></i>
              </button>
            </td>
          </tr>
        `;
      }).join('');

      lucide.createIcons();
    }

function filterPreviewCards() {
      const q = (document.getElementById('preview-cards-search')?.value || '').toLowerCase().trim();
      const filterType = document.getElementById('preview-filter-select')?.value || 'all';

      let filtered = previewCardsList;

      if (filterType === 'missing_audio') {
        filtered = filtered.filter(c => !c.has_audio);
      } else if (filterType === 'missing_context') {
        filtered = filtered.filter(c => !c.has_context);
      } else if (filterType === 'incomplete') {
        filtered = filtered.filter(c => !c.is_complete);
      }

      if (q) {
        filtered = filtered.filter(c => 
          (c.front && c.front.toLowerCase().includes(q)) ||
          (c.back && c.back.toLowerCase().includes(q)) ||
          (c.context && c.context.toLowerCase().includes(q))
        );
      }

      renderPreviewCardsTable(filtered);
    }

function openCurrentDeckInTMA() {
      if (!previewDeckId) return;
      window.open(`http://localhost:5173/?deck_id=${previewDeckId}`, '_blank');
    }

async function synthesizeSingleCardAudio(cardId, frontText) {
      const btn = document.getElementById(`btn-synth-card-${cardId}`);
      if (btn) {
        btn.innerHTML = `<span class="animate-spin inline-block text-[10px]">⏳</span>`;
        btn.disabled = true;
      }

      try {
        const res = await fetch(`/api/admin/cards/${cardId}/synthesize-audio`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ voice: 'de-DE-KatjaNeural', rate: '+0%' })
        });
        const data = await res.json();

        if (data.status === 'success' && data.audio_path) {
          playAudioFile(data.audio_path);
          openDeckPreviewModal(previewDeckId, document.getElementById('preview-deck-title')?.innerText);
        } else {
          alert("Не удалось синтезировать озвучку: " + (data.message || 'ошибка'));
        }
      } catch (err) {
        alert("Ошибка озвучки карточки: " + err);
      }
    }

function openCardEditModal(cardId) {
      const card = previewCardsList.find(c => String(c.id) === String(cardId));
      if (!card) return;

      document.getElementById('edit-card-id').value = card.id;
      document.getElementById('edit-card-front').value = card.front || '';
      document.getElementById('edit-card-back').value = card.back || '';
      document.getElementById('edit-card-context').value = card.context || '';
      document.getElementById('edit-card-tags').value = card.tags || card.level || '';

      document.getElementById('modal-edit-card').classList.remove('hidden');
    }

async function saveCardEdit() {
      const cardId = document.getElementById('edit-card-id').value;
      const front = document.getElementById('edit-card-front').value.trim();
      const back = document.getElementById('edit-card-back').value.trim();
      const context = document.getElementById('edit-card-context').value.trim();
      const tags = document.getElementById('edit-card-tags').value.trim();

      try {
        const res = await fetch(`/api/admin/cards/${cardId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ front, back, context, tags })
        });
        const data = await res.json();
        closeModal('modal-edit-card');
        openDeckPreviewModal(previewDeckId, document.getElementById('preview-deck-title')?.innerText);
      } catch (err) {
        alert("Ошибка при сохранении карточки: " + err);
      }
    }

async function deleteCard(cardId) {
      if (!confirm(`Удалить карточку #${cardId}?`)) return;
      try {
        await fetch(`/api/admin/cards/${cardId}`, { method: 'DELETE' });
        openDeckPreviewModal(previewDeckId, document.getElementById('preview-deck-title')?.innerText);
        loadDecks();
      } catch (err) {
        alert("Ошибка при удалении карточки: " + err);
      }
    }

function previewTriggerContextOnlyRegen() {
      const dId = previewDeckId;
      const dName = document.getElementById('preview-deck-title')?.innerText || '';
      closeModal('modal-deck-preview');
      openRegenModal(dId, dName, 'context_only');
    }

function previewTriggerAudioOnlyRegen() {
      const dId = previewDeckId;
      const dName = document.getElementById('preview-deck-title')?.innerText || '';
      closeModal('modal-deck-preview');
      openRegenModal(dId, dName, 'audio_only');
    }

function previewTriggerAiRegen() {
      const dId = previewDeckId;
      const dName = document.getElementById('preview-deck-title')?.innerText || '';
      closeModal('modal-deck-preview');
      openRegenModal(dId, dName, 'full_regen');
    }

function previewOpenBulkAdd() {
      const dId = previewDeckId;
      closeModal('modal-deck-preview');
      switchTab('bulk');
      const select = document.getElementById('bulk-target-deck-select');
      if (select) select.value = String(dId);
    }

    // ==========================================
    // BULK CARD CREATOR WORKSPACE
    // ==========================================
    let activeBulkTaskId = null;
    let bulkPollInterval = null;


/**
 * Toggles quick add card form inside Deck Preview Modal.
 */
function toggleAddCardInlineForm() {
  const box = document.getElementById('preview-add-card-box');
  if (!box) return;
  box.classList.toggle('hidden');
  if (!box.classList.contains('hidden')) {
    const frontInput = document.getElementById('new-card-front');
    if (frontInput) frontInput.focus();
  }
}

/**
 * Submits adding a single card directly to the active preview deck.
 */
async function submitAddCardInline() {
  if (!previewDeckId) return;
  const front = (document.getElementById('new-card-front')?.value || '').trim();
  const back = (document.getElementById('new-card-back')?.value || '').trim();
  const context = (document.getElementById('new-card-context')?.value || '').trim();
  const tags = (document.getElementById('new-card-tags')?.value || '').trim();
  const autoAudio = Boolean(document.getElementById('new-card-auto-audio')?.checked);

  if (!front || !back) {
    alert('Слово (Front) и перевод (Back) обязательны!');
    return;
  }

  const btn = document.getElementById('btn-submit-add-card');
  if (btn) {
    btn.disabled = true;
    btn.innerText = 'Сохранение...';
  }

  try {
    const res = await fetch(`/api/admin/decks/${previewDeckId}/cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ front_text: front, back_text: back, context: context, tags: tags })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Не удалось добавить карточку');

    const createdCard = data.card;

    if (autoAudio && createdCard && createdCard.id) {
      try {
        const synthRes = await fetch(`/api/admin/cards/${createdCard.id}/synthesize-audio?voice=de-DE-KatjaNeural`, { method: 'POST' });
        const synthData = await synthRes.json();
        if (synthData.audio_path) {
          createdCard.has_audio = true;
          createdCard.audio_path = synthData.audio_path;
        }
      } catch (synthErr) {
        console.warn('Auto audio failed:', synthErr);
      }
    }

    // Insert into previewCardsList
    previewCardsList.push(createdCard);
    renderPreviewCardsTable(previewCardsList);

    // Reset inputs
    document.getElementById('new-card-front').value = '';
    document.getElementById('new-card-back').value = '';
    document.getElementById('new-card-context').value = '';
    document.getElementById('new-card-tags').value = '';
    toggleAddCardInlineForm();

    if (typeof showToast === 'function') {
      showToast('Карточка успешно добавлена в колоду!', 'success');
    }
  } catch (err) {
    alert('Ошибка добавления карточки: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = '💾 Добавить в колоду';
    }
  }
}
