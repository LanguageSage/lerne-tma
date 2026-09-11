/**
 * bulk_creator.js — Lerne TMA Admin Module
 */
function initBulkCreator() {
      const select = document.getElementById('bulk-target-deck-select');
      if (select && decksData.length > 0) {
        const prevVal = select.value;
        select.innerHTML = '<option value="">-- Выберите колоду --</option>';
        decksData.forEach(d => {
          const isLib = d.is_library ? '⭐ ' : '';
          select.innerHTML += `<option value="${d.id}">${isLib}${d.name} (${(d.target_language || 'de').toUpperCase()} • ${d.card_count} карт.)</option>`;
        });
        if (prevVal) select.value = prevVal;
      }
      renderBulkVoiceOptions('de');
    }

function toggleBulkDeckMode() {
      const mode = document.querySelector('input[name="bulk-deck-mode"]:checked').value;
      const existBox = document.getElementById('bulk-existing-deck-box');
      const newBox = document.getElementById('bulk-new-deck-box');

      if (mode === 'new') {
        existBox.classList.add('hidden');
        newBox.classList.remove('hidden');
      } else {
        existBox.classList.remove('hidden');
        newBox.classList.add('hidden');
      }
    }

function onBulkDeckSelectChange() {
      const selVal = document.getElementById('bulk-target-deck-select').value;
      const found = decksData.find(d => String(d.id) === String(selVal));
      if (found && found.target_language) {
        renderBulkVoiceOptions(found.target_language);
      }
    }

function onBulkTargetLangChange() {
      const lang = document.getElementById('bulk-target-lang-select').value;
      renderBulkVoiceOptions(lang);
    }

function renderBulkVoiceOptions(targetLang = 'de') {
      const select = document.getElementById('bulk-voice-select');
      if (!select) return;

      const langCode = (targetLang || 'de').toLowerCase().trim();
      const groups = ADMIN_VOICES_BY_LANG[langCode] || ADMIN_VOICES_BY_LANG['de'];

      select.innerHTML = '';
      let defaultVoice = null;

      groups.forEach(g => {
        const optGroup = document.createElement('optgroup');
        optGroup.label = g.group;
        g.voices.forEach(v => {
          const opt = document.createElement('option');
          opt.value = v.value;
          opt.textContent = `${v.value} (${v.label})`;
          if (v.default) defaultVoice = v.value;
          optGroup.appendChild(opt);
        });
        select.appendChild(optGroup);
      });

      if (defaultVoice) select.value = defaultVoice;
    }

async function playBulkVoicePreview() {
      const voice = document.getElementById('bulk-voice-select')?.value || 'de-DE-KatjaNeural';
      const rate = document.getElementById('bulk-rate-select')?.value || '+0%';
      const btn = document.getElementById('btn-bulk-voice-preview');

      if (currentPreviewAudio) {
        currentPreviewAudio.pause();
        currentPreviewAudio = null;
      }

      if (btn) btn.innerHTML = `⏳ Превью...`;

      try {
        const url = `/api/admin/voice-preview?voice=${encodeURIComponent(voice)}&rate=${encodeURIComponent(rate)}&t=${Date.now()}`;
        currentPreviewAudio = new Audio(url);
        currentPreviewAudio.onplaying = () => { if (btn) btn.innerHTML = `🔊 Играет...`; };
        currentPreviewAudio.onended = () => { if (btn) btn.innerHTML = `<i data-lucide="volume-2" class="w-3.5 h-3.5 text-amber-400"></i> Тест голоса`; lucide.createIcons(); };
        currentPreviewAudio.onerror = () => { if (btn) btn.innerHTML = `Тест голоса`; };
        await currentPreviewAudio.play();
      } catch (e) {
        console.error("Voice preview error", e);
        if (btn) btn.innerHTML = `Тест голоса`;
      }
    }

function onBulkPhrasesInput() {
      const raw = document.getElementById('bulk-phrases-textarea').value;
      const phrases = raw.split(/[\n,;]+/).map(s => s.trim()).filter(s => s.length > 0);
      document.getElementById('bulk-words-count').innerText = phrases.length;
    }

async function suggestTopicWords() {
      const topic = document.getElementById('bulk-suggest-topic-input').value.trim();
      const count = parseInt(document.getElementById('bulk-suggest-count-input').value, 10) || 20;
      const btn = document.getElementById('btn-bulk-suggest');

      if (!topic) {
        alert("Введите тему для генерации (например: Ресторан, Покупки, Путешествия)!");
        return;
      }

      const mode = document.querySelector('input[name="bulk-deck-mode"]:checked').value;
      let targetLang = 'de';
      let level = 'B1';

      if (mode === 'new') {
        targetLang = document.getElementById('bulk-target-lang-select').value;
        level = document.getElementById('bulk-deck-level-select').value;
      } else {
        const selId = document.getElementById('bulk-target-deck-select').value;
        const deck = decksData.find(d => String(d.id) === String(selId));
        if (deck) {
          targetLang = deck.target_language || 'de';
          level = deck.level || 'B1';
        }
      }

      if (btn) {
        btn.innerHTML = `<span class="animate-spin inline-block">⏳</span> Генерация...`;
        btn.disabled = true;
      }

      try {
        const res = await fetch('/api/admin/cards/bulk-suggest-words', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic, level, target_lang: targetLang, count })
        });
        const data = await res.json();
        const words = data.words || [];

        if (words.length > 0) {
          const textarea = document.getElementById('bulk-phrases-textarea');
          const currentText = textarea.value.trim();
          textarea.value = currentText ? `${currentText}\n${words.join('\n')}` : words.join('\n');
          onBulkPhrasesInput();
        } else {
          alert("ИИ не вернул слова по этой теме. Попробуйте уточнить запрос.");
        }
      } catch (err) {
        alert("Ошибка генерации списка слов: " + err);
      } finally {
        if (btn) {
          btn.innerHTML = `<span>🤖 Сгенерировать</span>`;
          btn.disabled = false;
        }
      }
    }

async function startBulkCardCreationProcess() {
      const mode = document.querySelector('input[name="bulk-deck-mode"]:checked').value;
      const rawPhrases = document.getElementById('bulk-phrases-textarea').value;
      const phrases = rawPhrases.split(/[\n,;]+/).map(s => s.trim()).filter(s => s.length > 0);

      if (phrases.length === 0) {
        alert("Введите хотя бы одно слово или сгенерируйте список по теме!");
        return;
      }

      let deckId = null;
      let newDeckName = null;
      let targetLang = 'de';
      let level = 'B1';
      let isLib = false;
      let isDef = false;

      if (mode === 'existing') {
        deckId = document.getElementById('bulk-target-deck-select').value;
        if (!deckId) {
          alert("Выберите существующую колоду назначения!");
          return;
        }
        const found = decksData.find(d => String(d.id) === String(deckId));
        if (found) targetLang = found.target_language || 'de';
      } else {
        newDeckName = document.getElementById('bulk-new-deck-name').value.trim();
        if (!newDeckName) {
          alert("Введите название для новой колоды!");
          return;
        }
        targetLang = document.getElementById('bulk-target-lang-select').value;
        level = document.getElementById('bulk-deck-level-select').value;
        isLib = document.getElementById('bulk-is-library-cb').checked;
        isDef = document.getElementById('bulk-is-default-cb').checked;
      }

      const generateAi = document.getElementById('bulk-opt-ai').checked;
      const generateAudio = document.getElementById('bulk-opt-audio').checked;
      const voice = document.getElementById('bulk-voice-select').value;
      const rate = document.getElementById('bulk-rate-select').value;
      const nativeLang = document.getElementById('bulk-native-lang-select').value;
      const syncCopies = document.getElementById('bulk-sync-copies').checked;

      const payload = {
        deck_id: deckId,
        new_deck_name: newDeckName,
        target_lang: targetLang,
        level: level,
        is_library: isLib,
        is_default: isDef,
        phrases: phrases,
        generate_ai: generateAi,
        generate_audio: generateAudio,
        voice: voice,
        rate: rate,
        native_lang: nativeLang,
        sync_copies: syncCopies
      };

      if (!confirm(`Создать ${phrases.length} карточек с авто-переводом и озвучкой?`)) return;

      document.getElementById('bulk-progress-bar').style.width = '0%';
      document.getElementById('bulk-percent-badge').innerText = '0%';
      document.getElementById('bulk-active-status-text').innerText = 'Статус: Запуск создания...';
      document.getElementById('bulk-logs-container').innerHTML = `<div class="text-emerald-400">🚀 Запуск массового добавления ${phrases.length} слов...</div>`;

      try {
        const res = await fetch('/api/admin/cards/bulk-create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.task_id) {
          activeBulkTaskId = data.task_id;
          startPollBulkStatus(data.task_id);
        } else {
          alert("Не удалось запустить задачу: " + JSON.stringify(data));
        }
      } catch (err) {
        alert("Ошибка запуска создания карточек: " + err);
      }
    }

function startPollBulkStatus(taskId) {
      if (bulkPollInterval) clearInterval(bulkPollInterval);

      bulkPollInterval = setInterval(async () => {
        try {
          const res = await fetch(`/api/admin/cards/bulk/${taskId}/status`);
          const data = await res.json();

          const total = data.total_cards || 1;
          const processed = data.processed_cards || 0;
          const pct = Math.round((processed / total) * 100);

          document.getElementById('bulk-progress-bar').style.width = `${pct}%`;
          document.getElementById('bulk-percent-badge').innerText = `${pct}%`;
          document.getElementById('bulk-progress-count-badge').innerText = `${processed} / ${total}`;
          document.getElementById('bulk-active-status-text').innerText = `Статус: ${data.status.toUpperCase()} (${processed}/${total})`;

          if (data.current_card) {
            document.getElementById('bulk-current-card-badge').innerText = `• ${data.current_card}`;
          }

          const logsContainer = document.getElementById('bulk-logs-container');
          logsContainer.innerHTML = (data.logs || []).map(l => `<div>${l}</div>`).join('');
          logsContainer.scrollTop = logsContainer.scrollHeight;

          if (data.status === 'completed' || data.status === 'failed' || data.status === 'stopped') {
            clearInterval(bulkPollInterval);
            loadDecks();
          }
        } catch (e) {
          console.error("Bulk poll error", e);
        }
      }, 1000);
    }

async function controlBulkCreation(action) {
      if (!activeBulkTaskId) return;
      try {
        await fetch(`/api/admin/cards/bulk/${activeBulkTaskId}/control`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action })
        });
      } catch (e) {
        console.error("Control bulk error", e);
      }
    }

    // ==========================================
    // CEFR CLASSIFICATION WORKSPACE
    // ==========================================


/**
 * Copies Bulk creator live logs to clipboard.
 */
function copyBulkLogsToClipboard() {
  const container = document.getElementById('bulk-logs-container');
  if (!container) return;
  navigator.clipboard.writeText(container.innerText).then(() => {
    if (typeof showToast === 'function') showToast('Лог массового добавления скопирован!', 'info');
  }).catch(() => {
    alert('Лог скопирован');
  });
}
