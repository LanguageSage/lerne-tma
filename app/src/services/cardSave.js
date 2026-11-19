import { tr } from '../i18n/locale';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUiStore } from '../store/useUiStore';
import { getSessionIdentity, getUserId } from '../utils/auth';
import { cardWriteError, parseCardSource, validateStandardDraft } from '../utils/cardDraft';
import api from './api';
import { prepareLocalDb } from './localDb';
import { notifyCardEdit, syncService } from './syncService';

// Preserve the request identifier after transport failure, for the same draft only.
let pendingSave;
let activeSave;
const mediaPaths = ['image_path', 'audio_path', 'audio_back_path', 'video_front_path', 'video_back_path'];

export async function saveCard(manualCardData = null, { awaitDelivery = false } = {}) {
  const session = useSessionStore.getState();
  const ui = useUiStore.getState();
  const { setLoading, showToast } = ui;
  const { currentDeck } = useDeckStore.getState();

  const isEvent = manualCardData && typeof manualCardData === 'object' && 'preventDefault' in manualCardData;
  const data = (manualCardData && !isEvent) ? manualCardData : session.editingCard;

  const identity = getSessionIdentity();
  const account = getUserId();
  if (!data?.content_v2 || (activeSave?.identity === identity && activeSave?.account === account)) return;
  const flight = { identity, account };
  activeSave = flight;
  const isCurrent = () => identity === getSessionIdentity() && account === getUserId();
  setLoading(true);
  try {
    // All save callers, including local publication, consume the same source.
    const content = data.content_v2_source != null ? parseCardSource(data.content_v2_source) : data.content_v2;
    if (data.offline_move) throw new Error(tr('Сначала завершите синхронизацию переноса.'));
    if (data.id < 0) throw new Error(tr('Сначала синхронизируйте новую карточку.'));
    let finalDeckId = data.deck_id;
    if (finalDeckId === 'duplicates' || !finalDeckId) {
      finalDeckId = currentDeck?.id !== 'duplicates' ? currentDeck?.id : null;
    }

    const path = data.id ? '/cards/' + data.id : '/cards/save';
    const reqData = { content_v2: content };
    if (data.id) reqData.revision = data.revision;
    else {
      if (finalDeckId) reqData.deck_id = Number(finalDeckId);
      if (data.after_card_id) reqData.after_card_id = Number(data.after_card_id);
    }
    for (const field of mediaPaths) {
      if (data[field] !== undefined) reqData[field] = data[field] || null;
    }
    const fingerprint = JSON.stringify([path, reqData]);
    if (pendingSave?.identity !== identity || pendingSave.account !== account || pendingSave.fingerprint !== fingerprint) {
      pendingSave = { identity, account, fingerprint, id: crypto.randomUUID() };
    }
    reqData.request_id = pendingSave.id;
    const nativeEdit = data.id > 0;
    const conflict = data.offline_edit?.status === 'conflict';
    if (!data.id && content.card.type === 'standard') validateStandardDraft(content.card);
    if (content.card.type === 'puzzle') {
      const { tokens } = content.card.data;
      if (!tokens.length || tokens.some(token => !/[^\p{White_Space}]/u.test(token))) {
        throw new Error(tr('Введите предложение'));
      }
    }
    const res = nativeEdit ? await api.patch(path, reqData, {
      offlineCardEdit: true, offlineEditConflict: conflict ? data.offline_edit.requestId : undefined,
    })
      : await api.post(path, reqData, { offlineCreateFlag: data.flag });
    if (!isCurrent()) return;
    pendingSave = null;

    if (nativeEdit) res.data = { ...data, ...res.data };
    const deliverEdit = nativeEdit && navigator.onLine && !conflict;
    if (deliverEdit && awaitDelivery) {
      const db = await prepareLocalDb();
      if (!isCurrent()) return;
      await syncService.sync({ pendingNativeOnly: true, skipPull: true });
      const cached = await db.cards.get(data.id);
      if (!isCurrent()) return;
      const visible = useSessionStore.getState().editingCard;
      if (cached) {
        // The receipt event carries study fields omitted from the pull snapshot.
        res.data = visible?.id === cached.id && visible.revision === cached.revision
          ? { ...visible, ...cached } : cached;
      }
    }
    if (nativeEdit && res.data.offline_edit?.status === 'conflict') {
      notifyCardEdit(res.data, getUserId());
      session.setEditingCard(res.data);
      if (conflict) showToast(tr('Карточка сохранена на устройстве'), 'success');
      return res.data;
    }

    const savedLocally = Boolean(res.data.offline_create_status || res.data.offline_edit);
    if (!savedLocally && !data.id && useSettingsStore.getState().autoGenerateCardAudio && !res.data.audio_path && !res.data.audio_back_path) {
      try {
        const audio = await api.post('/media/generate-card-audio', { card_id: res.data.id, side: 'front' });
        Object.assign(res.data, { audio_path: audio.data.path, audio_url: audio.data.url, revision: audio.data.revision });
      } catch {
        if (!isCurrent()) return;
        showToast(tr("Аудио не сгенерировано"), 'warning');
      }
    }

    if (!isCurrent()) return;
    if ((!savedLocally || nativeEdit) && res?.data?.id && data.flag !== undefined && Number(data.flag) !== Number(res.data.flag || 0)) {
      try {
        await api.post(`/cards/${res.data.id}/flag`, { flag: Number(data.flag) });
        res.data.flag = Number(data.flag);
      } catch {
        if (!isCurrent()) return;
        showToast(tr("Ошибка при установке метки"), 'warning');
      }
    }

    if (!isCurrent()) return;
    if (savedLocally || !nativeEdit) {
      showToast(tr(savedLocally ? 'Карточка сохранена на устройстве' : 'Карточка сохранена'), 'success');
    }

    const { deckCards } = useDeckStore.getState();
    let savedCard = (res?.data && res.data.id) ? res.data : data;
    if (!savedLocally && data.image_height) {
      savedCard = { ...savedCard, image_height: data.image_height };
      if (currentDeck?.id) {
        try {
          let meta = currentDeck.metadata;
          if (typeof meta === 'string') {
            try { meta = JSON.parse(meta); } catch { meta = {}; }
          } else {
            meta = meta ? { ...meta } : {};
          }
          if (meta.imageHeight !== data.image_height) {
            meta.imageHeight = data.image_height;
            useDeckStore.getState().updateDeckMetadata(currentDeck.id, meta).catch(() => {});
          }
        } catch {
          // ignore
        }
      }
    }
    if (res?.data && res.data.id) {
      const existingIdx = (deckCards || []).findIndex(c => String(c.id) === String(savedCard.id));
      let nextCards = [...(deckCards || [])];
      if (existingIdx !== -1) {
        nextCards[existingIdx] = { ...nextCards[existingIdx], ...savedCard };
        if (!savedCard.offline_edit) delete nextCards[existingIdx].offline_edit;
      } else if (data.after_card_id) {
        const afterIdx = nextCards.findIndex(c => String(c.id) === String(data.after_card_id));
        if (afterIdx !== -1) {
          nextCards.splice(afterIdx + 1, 0, savedCard);
        } else {
          nextCards.push(savedCard);
        }
      } else {
        nextCards.push(savedCard);
      }

      const currentDeckState = useDeckStore.getState();
      const targetDeckId = finalDeckId || currentDeckState.currentDeck?.id;
      const updatedCardsByDeck = targetDeckId
        ? { ...currentDeckState.cardsByDeck, [targetDeckId]: nextCards }
        : currentDeckState.cardsByDeck;

      const isNewCard = !data.id;
      const updatedDecks = isNewCard && targetDeckId
        ? (currentDeckState.decks || []).map(d => {
            if (d.id === targetDeckId) {
              const oldStats = d.stats || { total: 0, new: 0, learning: 0, due: 0 };
              return {
                ...d,
                stats: {
                  ...oldStats,
                  total: (oldStats.total || 0) + 1,
                  new: (oldStats.new || 0) + 1
                }
              };
            }
            return d;
          })
        : currentDeckState.decks;

      useDeckStore.setState({
        deckCards: nextCards,
        cardsByDeck: updatedCardsByDeck,
        decks: updatedDecks
      });
    }

    const sourceView = ui.editorSourceView || 'cards';
    session.setEditingCard(null);
    if (savedCard?.id) {
      ui.setLastSelectedCardId(savedCard.id);
    }

    if (sourceView === 'study' && savedCard?.id) {
      session.setCard(savedCard);
      const { studyHistory, historyIndex } = session;
      if (data.id && historyIndex >= 0 && studyHistory[historyIndex]?.id === savedCard.id) {
        const updatedHistory = [...studyHistory];
        updatedHistory[historyIndex] = savedCard;
        session.setStudyHistory(updatedHistory);
      } else if (!data.id) {
        session.addToHistory(savedCard);
      }
    }
    if (window.history.state?.view === 'editor' || window.history.state?.view === 'creator') {
      window.history.back();
    } else {
      ui.setView(sourceView);
    }
    if (deliverEdit && !awaitDelivery) void syncService.sync({ pendingNativeOnly: true, skipPull: true });
    return savedCard;
  } catch (err) {
    if (!isCurrent()) return;
    console.error(err);
    const detail = cardWriteError(err);
    if (err.response?.status && err.response.status < 500) pendingSave = null;
    showToast(tr("Ошибка сохранения: {{p0}}", { p0: detail }), "error");
    if (err.response?.status === 409 && data.id) {
      ui.showToast(tr('Карточка изменилась на сервере. Черновик сохранён в форме. Откройте актуальную карточку перед повторной правкой.'), 'warning');
    }
  } finally {
    if (activeSave === flight) activeSave = null;
    if (isCurrent()) setLoading(false);
  }
}
