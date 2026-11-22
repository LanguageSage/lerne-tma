import { tr } from '../i18n/locale';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUiStore } from '../store/useUiStore';
import { getSessionIdentity, getUserId } from '../utils/auth';
import { cardWriteError, parseCardSource } from '../utils/cardDraft';
import { findCardDeck, parseDeckMetadata } from '../utils/deckUtils';
import { NativeV2ValidationError } from '../utils/nativeV2Contract.js';
import { IS_STANDALONE } from '../utils/standaloneMode.js';
import api from './api';
import { mediaPaths } from './cardOfflineQueue';
import { prepareLocalDb } from './localDb';
import { notifyCardEdit, syncService } from './syncService';

// Preserve the request identifier after transport failure, for the same draft only.
let pendingSave;
let activeSave;
const draftFingerprint = draft => JSON.stringify([
  draft.content_v2, draft.content_v2_source, draft.pendingLayoutImages, draft.deck_id,
  draft.after_card_id, draft.flag, draft.image_height, ...mediaPaths.map(field => draft[field]),
]);

export async function saveCard(manualCardData = null, {
  awaitDelivery = false, getDraft = () => useSessionStore.getState().editingCard,
  setDraft = useSessionStore.getState().setEditingCard,
} = {}) {
  const session = useSessionStore.getState();
  const ui = useUiStore.getState();
  const { setLoading, showToast } = ui;
  const { currentDeck } = useDeckStore.getState();

  const isEvent = manualCardData && typeof manualCardData === 'object' && 'preventDefault' in manualCardData;
  const draft = (manualCardData && !isEvent) ? manualCardData : session.editingCard;

  const identity = getSessionIdentity();
  const account = getUserId();
  if (!draft?.content_v2 || (activeSave?.identity === identity && activeSave?.account === account)) return;
  const { draftImageHeight, savedPersonalFlag, ...data } = structuredClone(draft);
  const sentDraft = draftFingerprint(data);
  const currentDraft = savedId => {
    if (useUiStore.getState().view !== ui.view
        || useSessionStore.getState().editorDraftVersion !== session.editorDraftVersion) return null;
    const current = getDraft();
    return current && (current.id === draft.id || (draft.id < 0 && current.id === savedId)) ? current : null;
  };
  const retainDraft = (current, saved) => setDraft({
    ...current, id: saved.id, deck_id: saved.deck_id, revision: saved.revision,
    offline_edit: saved.offline_edit, offline_create_status: saved.offline_create_status,
    offline_create_error: saved.offline_create_error, offline_create_request_id: saved.offline_create_request_id,
    savedPersonalFlag: saved.flag ?? 0,
  });
  const flight = { identity, account };
  activeSave = flight;
  const isCurrent = () => identity === getSessionIdentity() && account === getUserId();
  setLoading(true);
  try {
    // All save callers, including local publication, consume the same source.
    const content = data.content_v2_source != null ? parseCardSource(data.content_v2_source) : data.content_v2;
    if (data.offline_move) throw new Error(tr('Сначала завершите синхронизацию переноса.'));
    if (data.id < 0) {
      const db = await prepareLocalDb();
      const readCreate = async () => {
        const aliases = (await db.syncState.get('aliases'))?.mappings.cards;
        return db.cards.get(aliases?.[data.id] ?? data.id);
      };
      let local = await readCreate();
      if (local?.id < 0 && !local.offline_create_error && navigator.onLine) {
        await syncService.sync({ pendingNativeOnly: true, skipPull: true });
        local = await readCreate();
        if (!isCurrent()) return;
        if (local?.offline_create_error) {
          const current = currentDraft();
          if (current) retainDraft(current, local);
          return;
        }
      }
      if (!isCurrent()) return;
      if (local?.id > 0) {
        Object.assign(data, { id: local.id, revision: local.revision, offline_edit: local.offline_edit });
      } else if (!local?.offline_create_error) {
        throw new Error(tr('Сначала синхронизируйте новую карточку.'));
      } else if (!data.offline_create_error) {
        data.offline_create_request_id = local.offline_create_request_id;
      }
    }
    let finalDeckId = data.deck_id;
    if (finalDeckId === 'duplicates' || !finalDeckId) {
      finalDeckId = currentDeck?.id !== 'duplicates' ? currentDeck?.id : null;
    }

    const nativeEdit = data.id > 0;
    if (IS_STANDALONE && !nativeEdit && !finalDeckId) throw new Error(tr('Выберите колоду'));
    const path = nativeEdit ? '/cards/' + data.id : '/cards/save';
    const reqData = { content_v2: content };
    if (nativeEdit) reqData.revision = data.revision;
    else {
      if (finalDeckId) reqData.deck_id = Number(finalDeckId);
      if (data.after_card_id) reqData.after_card_id = Number(data.after_card_id);
    }
    for (const field of mediaPaths) {
      if (data[field] !== undefined) reqData[field] = data[field] || null;
    }
    const fingerprint = JSON.stringify(IS_STANDALONE ? [path, reqData, data.flag ?? null] : [path, reqData]);
    if (pendingSave?.identity !== identity || pendingSave.account !== account || pendingSave.fingerprint !== fingerprint) {
      pendingSave = { identity, account, fingerprint, id: crypto.randomUUID() };
    }
    reqData.request_id = pendingSave.id;
    const conflict = !IS_STANDALONE && data.offline_edit?.status === 'conflict';
    const res = nativeEdit
      ? await api.patch(path, reqData, {
        offlineCardEdit: true,
        ...(IS_STANDALONE ? { standaloneFlag: data.flag } : {
          offlineEditConflict: conflict ? data.offline_edit.requestId : undefined,
        }),
      })
      : await api.post(path, reqData, {
        offlineCreateFlag: data.flag,
        ...(!IS_STANDALONE && {
          offlineCreateId: data.id < 0 ? data.id : undefined,
          offlineCreateRequestId: data.offline_create_request_id,
        }),
      });
    if (!isCurrent()) return;
    pendingSave = null;

    let deliverEdit = false;
    let savedLocally = IS_STANDALONE;
    let createError;
    if (IS_STANDALONE) {
      showToast(tr('Карточка сохранена'), 'success');
    } else {
      // Pull keeps personal progress separately. An unsynced personal change
      // also takes precedence over any flag carried by the cached card.
      let originalFlag = res.data.flag;
      if (nativeEdit && data.flag !== undefined) {
        const db = await prepareLocalDb();
        const progress = await db.progress.get([data.id, account]);
        originalFlag = progress?.is_dirty ? progress.flag : savedPersonalFlag ?? originalFlag ?? progress?.flag;
      }
      if (!isCurrent()) return;
      if (nativeEdit) res.data = { ...data, ...res.data, flag: originalFlag ?? data.flag };
      deliverEdit = nativeEdit && navigator.onLine && !conflict;
      if (deliverEdit && awaitDelivery) {
        const db = await prepareLocalDb();
        if (!isCurrent()) return;
        await syncService.sync({ pendingNativeOnly: true, skipPull: true });
        const cached = await db.cards.get(data.id);
        if (!isCurrent()) return;
        if (cached) {
          res.data = { ...res.data, ...cached, offline_edit: cached.offline_edit };
        }
      }
      if (nativeEdit && res.data.offline_edit?.status === 'conflict') {
        notifyCardEdit(res.data, account, false, res.data.offline_edit.requestId);
        const current = currentDraft(res.data.id);
        if (!current) return;
        const changed = draftFingerprint(current) !== sentDraft;
        if (changed) retainDraft(current, res.data);
        else setDraft(res.data);
        if (conflict) showToast(tr('Карточка сохранена на устройстве'), 'success');
        return changed ? undefined : res.data;
      }

      savedLocally = Boolean(res.data.offline_create_status || res.data.offline_edit);
      if (!savedLocally && !nativeEdit && useSettingsStore.getState().autoGenerateCardAudio && !res.data.audio_path && !res.data.audio_back_path) {
        try {
          const audio = await api.post('/media/generate-card-audio', { card_id: res.data.id, side: 'front' });
          Object.assign(res.data, { audio_path: audio.data.path, audio_url: audio.data.url,
            revision: audio.data.revision ?? res.data.revision });
        } catch {
          if (!isCurrent()) return;
          showToast(tr("Аудио не сгенерировано"), 'warning');
        }
      }

      if (!isCurrent()) return;
      if ((!savedLocally || nativeEdit) && res?.data?.id && data.flag !== undefined
          && Number(data.flag) !== Number(originalFlag ?? 0)) {
        try {
          await api.post(`/cards/${res.data.id}/flag`, { flag: Number(data.flag) });
          res.data.flag = Number(data.flag);
        } catch {
          if (!isCurrent()) return;
          showToast(tr("Ошибка при установке метки"), 'warning');
        }
      }

      if (!isCurrent()) return;
      createError = !nativeEdit && res.data.offline_create_error;
      if (!createError && (savedLocally || !nativeEdit)) {
        showToast(tr(savedLocally ? 'Карточка сохранена на устройстве' : 'Карточка сохранена'), 'success');
      }
    }

    const savedCard = res?.data?.id ? res.data : data;
    if (res?.data?.id || (IS_STANDALONE && savedCard.id)) useDeckStore.setState(currentDeckState => {
      const targetDeckId = savedCard.deck_id;
      if (!targetDeckId) return {};
      const isDisplayed = String(currentDeckState.currentDeck?.id) === String(targetDeckId);
      const nextCards = [...(isDisplayed ? currentDeckState.deckCards : currentDeckState.cardsByDeck[targetDeckId] ?? [])];
      const existingIdx = nextCards.findIndex(c => String(c.id) === String(savedCard.id));
      if (existingIdx !== -1) {
        nextCards[existingIdx] = { ...nextCards[existingIdx], ...savedCard };
        for (const field of ['offline_edit', 'offline_create_error', 'offline_create_request_id']) {
          if (!savedCard[field]) delete nextCards[existingIdx][field];
        }
      } else {
        const afterIdx = nextCards.findIndex(c => String(c.id) === String(data.after_card_id));
        const insertIdx = afterIdx >= 0 ? afterIdx + 1 : nextCards.findIndex(c => c.position >= savedCard.position);
        nextCards.splice(insertIdx < 0 ? nextCards.length : insertIdx, 0, savedCard);
      }

      const updatedDecks = !data.id && existingIdx < 0
        ? (currentDeckState.decks || []).map(d => {
            if (String(d.id) === String(targetDeckId)) {
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

      return {
        ...(isDisplayed && { deckCards: nextCards }),
        cardsByDeck: { ...currentDeckState.cardsByDeck, [targetDeckId]: nextCards },
        decks: updatedDecks
      };
    });

    if (IS_STANDALONE && savedCard.id) {
      if (savedCard.deck_id) void useDeckStore.getState().fetchDeckCards(savedCard.deck_id).catch(() => {});
      void useDeckStore.getState().fetchDecks(true).catch(() => {});
    }

    const current = currentDraft(savedCard.id);
    const keepOpen = current && (createError || draftFingerprint(current) !== sentDraft
      || (awaitDelivery && savedCard.offline_edit?.status === 'error'));
    if (keepOpen) retainDraft(current, savedCard);
    if (deliverEdit && !awaitDelivery) void syncService.sync({ pendingNativeOnly: true, skipPull: true });
    if (!current || keepOpen) return;

    const sourceView = ui.editorSourceView || 'cards';
    session.setEditingCard(null);
    if (savedCard?.id) {
      ui.setLastSelectedCardId(savedCard.id);
    }

    if (sourceView === 'study' && savedCard?.id) {
      session.setCard(savedCard);
      if (IS_STANDALONE) session.setIsFlipped(false);
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
    // Commit the deck setting separately, after publishing the card to the UI.
    // The edit receipt can arrive while the metadata request is in flight.
    const savedDeckId = savedCard.deck_id ?? finalDeckId;
    if (!IS_STANDALONE && draftImageHeight && savedDeckId > 0 && navigator.onLine && (deliverEdit || !savedLocally)) {
      const deckState = useDeckStore.getState();
      const deck = findCardDeck(deckState, savedDeckId);
      const metadata = parseDeckMetadata(deck);
      if (deck && Number(metadata?.imageHeight || 220) !== draftImageHeight) {
        try {
          const deckMetadata = await deckState.updateDeckMetadata(deck.id, { ...metadata, imageHeight: draftImageHeight });
          if (!isCurrent()) return;
          if (sourceView === 'study') session.updateCardInSession(savedCard.id, { deck_metadata: deckMetadata });
        } catch {
          if (!isCurrent()) return;
          showToast(tr('Не удалось обновить настройки'), 'warning');
        }
      }
    }
    return savedCard;
  } catch (err) {
    if (!isCurrent()) return;
    const localConflict = IS_STANDALONE && err.response?.data?.detail?.code === 'card_revision_conflict';
    if (!localConflict && !(err instanceof NativeV2ValidationError)) console.error(err);
    const detail = cardWriteError(err);
    if (IS_STANDALONE || (err.response?.status && err.response.status < 500)) pendingSave = null;
    if (!currentDraft(data.id)) return;
    showToast(tr("Ошибка сохранения: {{p0}}", { p0: detail }), "error");
    if (!IS_STANDALONE && err.response?.status === 409 && data.id) {
      ui.showToast(tr('Карточка изменилась на сервере. Черновик сохранён в форме. Откройте актуальную карточку перед повторной правкой.'), 'warning');
    }
  } finally {
    if (activeSave === flight) activeSave = null;
    if (isCurrent()) setLoading(false);
  }
}
