/**
 * api.js — Lerne TMA Admin Module
 */
function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

function getDefaultVoiceForLang(targetLang = 'de') {
      const langCode = (targetLang || 'de').toLowerCase().trim();
      const groups = ADMIN_VOICES_BY_LANG[langCode] || ADMIN_VOICES_BY_LANG['de'];
      let def = null;
      groups.forEach(g => {
        g.voices.forEach(v => {
          if (v.default && !def) def = v.value;
        });
      });
      return def || 'de-DE-KatjaNeural';
    }

function renderVoiceOptions(targetLang = 'de', currentVoiceToKeep = null) {
      const select = document.getElementById('regen-voice-select');
      if (!select) return;

      const langCode = (targetLang || 'de').toLowerCase().trim();
      const groups = ADMIN_VOICES_BY_LANG[langCode] || ADMIN_VOICES_BY_LANG['de'];

      const prevValue = currentVoiceToKeep || select.value;
      select.innerHTML = '';

      // First Option: No Audio (Text and AI context only)
      const optNoAudio = document.createElement('option');
      optNoAudio.value = 'none';
      optNoAudio.textContent = '🔇 Без озвучки (только текст и контекст)';
      select.appendChild(optNoAudio);

      let defaultVoice = null;
      let hasPrevValue = (prevValue === 'none');

      groups.forEach(g => {
        const optGroup = document.createElement('optgroup');
        optGroup.label = g.group;
        g.voices.forEach(v => {
          const opt = document.createElement('option');
          opt.value = v.value;
          opt.textContent = `${v.value} (${v.label})`;
          if (v.default) defaultVoice = v.value;
          if (v.value === prevValue) hasPrevValue = true;
          optGroup.appendChild(opt);
        });
        select.appendChild(optGroup);
      });

      if (hasPrevValue && prevValue) {
        select.value = prevValue;
      } else if (defaultVoice) {
        select.value = defaultVoice;
      }
    }

function onRateSelectChange() {
      const select = document.getElementById('regen-rate-select');
      const badge = document.getElementById('regen-rate-badge');
      if (select && badge) {
        badge.innerText = select.value;
      }
    }

function playAudioFile(audioPath, event) {
      if (event) event.stopPropagation();
      if (!audioPath) return;
      if (currentPlayingAudio) {
        currentPlayingAudio.pause();
        currentPlayingAudio = null;
      }
      const url = audioPath.startsWith('http') ? audioPath : `/api/media/audio/${encodeURIComponent(audioPath)}`;
      currentPlayingAudio = new Audio(url);
      currentPlayingAudio.play().catch(e => {
        console.error("Audio play error", e);
      });
    }

async function playVoicePreview() {
      const voiceSelect = document.getElementById('regen-voice-select');
      const voice = voiceSelect ? voiceSelect.value : 'de-DE-KatjaNeural';
      if (voice === 'none') {
        alert("Выбран режим 'Без озвучки'. Для прослушивания превью выберите один из голосов в списке.");
        return;
      }
      const rateSelect = document.getElementById('regen-rate-select');
      const rate = rateSelect ? rateSelect.value : '+0%';
      const btn = document.getElementById('btn-voice-preview');
      
      if (currentPreviewAudio) {
        currentPreviewAudio.pause();
        currentPreviewAudio = null;
      }

      if (btn) {
        btn.innerHTML = `<span class="animate-spin inline-block text-xs">⏳</span> <span>Синтез...</span>`;
        btn.disabled = true;
      }

      try {
        const url = `/api/admin/voice-preview?voice=${encodeURIComponent(voice)}&rate=${encodeURIComponent(rate)}&t=${Date.now()}`;
        currentPreviewAudio = new Audio(url);
        currentPreviewAudio.onplaying = () => {
          if (btn) {
            btn.innerHTML = `<span class="text-emerald-300 animate-pulse">🔊 Играет (${rate})...</span>`;
          }
        };
        currentPreviewAudio.onended = () => {
          if (btn) {
            btn.innerHTML = `<i data-lucide="volume-2" class="w-3.5 h-3.5 text-amber-400"></i> <span>🔊 Превью</span>`;
            btn.disabled = false;
            lucide.createIcons();
          }
          currentPreviewAudio = null;
        };
        currentPreviewAudio.onerror = (e) => {
          console.error("Voice preview error", e);
          alert("Ошибка воспроизведения превью голоса");
          if (btn) {
            btn.innerHTML = `<i data-lucide="volume-2" class="w-3.5 h-3.5 text-amber-400"></i> <span>🔊 Превью</span>`;
            btn.disabled = false;
            lucide.createIcons();
          }
          currentPreviewAudio = null;
        };
        await currentPreviewAudio.play();
      } catch (err) {
        console.error("Voice preview error", err);
        alert("Не удалось загрузить превью голоса: " + err);
        if (btn) {
          btn.innerHTML = `<i data-lucide="volume-2" class="w-3.5 h-3.5 text-amber-400"></i> <span>🔊 Превью</span>`;
          btn.disabled = false;
          lucide.createIcons();
        }
      }
    }

    let committedDryRunCardIds = new Set();


/**
 * Shows a temporary floating toast notification in the UI.
 */
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  const bgClass = type === 'error' ? 'bg-rose-600 border-rose-400' :
                  type === 'success' ? 'bg-emerald-600 border-emerald-400' :
                  'bg-indigo-600 border-indigo-400';
  toast.className = `fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-white text-xs font-semibold shadow-2xl border ${bgClass} flex items-center gap-2 transition-all transform duration-300 opacity-0 translate-y-4`;
  toast.innerHTML = `<span>${message}</span>`;
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.remove('opacity-0', 'translate-y-4');
  });
  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-4');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
