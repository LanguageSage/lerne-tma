import { tr } from '../i18n/locale';
import api, { networkApi } from '../services/api';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUiStore } from '../store/useUiStore';

import { cardWriteError, validateStandardDraft } from '../utils/cardDraft';
import { getSessionIdentity, getUserId } from '../utils/auth';
import { prepareLocalDb } from '../services/localDb';
import { offlineMoveLabel } from '../services/offlineUi';
import { notifyCardEdit, syncService } from '../services/syncService';
import { getPublicShareUrl, executeShare } from '../utils/share';
import { isTelegram, isNative } from '../utils/platform';
import { useStudySession } from './useStudySession';


// Preserve the request identifier after transport failure, for the same draft only.
let pendingSave;
let activeSave;
const mediaPaths = ['image_path', 'audio_path', 'audio_back_path', 'video_front_path', 'video_back_path'];

function visibleCard(cardId) {
  const deck = useDeckStore.getState();
  const session = useSessionStore.getState();
  return [session.editingCard, session.card, ...deck.deckCards, ...deck.duplicateCards]
    .find(card => String(card?.id) === String(cardId) && card.revision);
}

export const useCardEditor = () => {
  const { fetchDecks, fetchDeckCards } = useDeckStore();
  const { setLoading, showToast } = useUiStore();
  const { fetchNextCard } = useStudySession();

  const saveCard = async (manualCardData = null, { awaitDelivery = false } = {}) => {
    const session = useSessionStore.getState();
    const ui = useUiStore.getState();
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
      if (data.offline_move) throw new Error(tr('Сначала завершите синхронизацию переноса.'));
      if (data.id < 0) throw new Error(tr('Сначала синхронизируйте новую карточку.'));
      let finalDeckId = data.deck_id;
      if (finalDeckId === 'duplicates' || !finalDeckId) {
        finalDeckId = currentDeck?.id !== 'duplicates' ? currentDeck?.id : null;
      }

      const path = data.id ? '/cards/' + data.id : '/cards/save';
      const reqData = { content_v2: data.content_v2 };
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
      if (!data.id && data.content_v2.card.type === 'standard') validateStandardDraft(data.content_v2.card);
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
        await syncService.sync({ pendingNativeOnly: true });
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
      if (!savedLocally && !data.id && useSettingsStore.getState().autoGenerateCardAudio && !res.data.audio_path) {
        try {
          const audio = await networkApi.post('/media/generate-card-audio', { card_id: res.data.id, side: 'front' });
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

      if (sourceView === 'study') {
        if (savedCard && savedCard.id) {
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
          ui.setView('study');
        }
      } else if (sourceView === 'duplicates') {
        if (window.history.state?.view === 'editor' || window.history.state?.view === 'creator') {
          window.history.back();
        } else {
          ui.setView('duplicates');
        }
      } else {
        if (window.history.state?.view === 'editor' || window.history.state?.view === 'creator') {
          window.history.back();
        } else {
          ui.setView(sourceView);
        }
      }
      if (deliverEdit && !awaitDelivery) void syncService.sync({ pendingNativeOnly: true });
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
  };

  const handleDeleteCard = async (cardId, skipConfirm = false) => {
    if (!skipConfirm && !window.confirm(tr("Удалить эту карточку?"))) return;
    setLoading(true);
    try {
      const card = visibleCard(cardId);
      if (!card) throw new Error("Card revision unavailable");
      const { data } = await api.post('/cards/batch-delete', {
        request_id: crypto.randomUUID(), card_ids: [Number(cardId)], revisions: { [cardId]: card.revision },
      });
      if (!data.is_deleted) return;
      showToast(tr(data.offline_lifecycle ? 'Ожидает синхронизации' : 'Карточка удалена'), 'success');
      
      const session = useSessionStore.getState();
      const ui = useUiStore.getState();
      const { currentDeck, deckCards, cardsByDeck, decks } = useDeckStore.getState();

      const updatedDeckCards = (deckCards || []).filter(c => String(c.id) !== String(cardId));
      const targetDeckId = currentDeck?.id;
      const updatedCardsByDeck = targetDeckId
        ? { ...cardsByDeck, [targetDeckId]: updatedDeckCards }
        : cardsByDeck;
      const updatedDecks = targetDeckId
        ? (decks || []).map(d => {
            if (d.id === targetDeckId) {
              const oldStats = d.stats || { total: 1, new: 0, learning: 0, due: 0 };
              return {
                ...d,
                stats: {
                  ...oldStats,
                  total: Math.max(0, (oldStats.total || 1) - 1)
                }
              };
            }
            return d;
          })
        : decks;

      useDeckStore.setState({
        deckCards: updatedDeckCards,
        cardsByDeck: updatedCardsByDeck,
        decks: updatedDecks
      });

      session.removeCardFromSession(cardId);
      
      const freshSession = useSessionStore.getState();
      if (ui.view === 'study' && currentDeck) {
        if (!freshSession.card) {
          if (updatedDeckCards.length > 0) {
            await fetchNextCard(currentDeck.id, true);
          } else {
            session.setCard(null);
          }
        }
      }
    } catch (err) {
      console.error('Delete Card Error:', err);
      showToast(err.message || tr("Ошибка при удалении"), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleMoveCard = async (targetCard, targetDeckId, onDuplicate = 'keep') => {
    if (!targetCard) return false;
    if (Number(targetCard.deck_id) === Number(targetDeckId)) return true;
    const identity = getSessionIdentity();
    const account = getUserId();
    const isCurrent = () => identity === getSessionIdentity() && account === getUserId();
    setLoading(true);
    try {
      const id = Number(targetCard.id);
      const target = Number(targetDeckId);
      const db = await prepareLocalDb();
      if (!isCurrent()) return false;
      // Study can open a card without loading its deck list first.
      if (id > 0 && navigator.onLine && !(await db.cards.get(id))) await api.get('/cards/' + id, { freshCard: true });
      if (!isCurrent()) return false;
      const { data: card } = await api.post('/cards/batch-move', {
        request_id: crypto.randomUUID(), card_ids: [id], revisions: { [id]: targetCard.revision },
        target_deck_id: target, on_duplicate: onDuplicate,
      });
      if (!isCurrent()) return false;
      if (card.offline_move) {
        showToast(offlineMoveLabel(card.offline_move), card.offline_move.status === 'rejected' ? 'error' : 'info');
      } else if (card.deck_id === target) {
        showToast(tr('Карточка перемещена'), 'success');
      } else {
        showToast(tr('Перемещено: {{p0}} (пропущено дубликатов: {{p1}})', { p0: 0, p1: 1 }), 'success');
        return true;
      }

      const session = useSessionStore.getState();
      const ui = useUiStore.getState();
      const { currentDeck, deckCards } = useDeckStore.getState();
      const updatedDeckCards = currentDeck?.id === target ? deckCards : (deckCards || []).filter(c => c.id !== id);
      useDeckStore.setState(state => {
        const cardsByDeck = { ...state.cardsByDeck };
        delete cardsByDeck[targetCard.deck_id];
        delete cardsByDeck[target];
        return { deckCards: updatedDeckCards, cardsByDeck };
      });

      session.removeCardFromSession(id);
      if (ui.view === 'study' && currentDeck && !useSessionStore.getState().card && updatedDeckCards.length > 0) {
        fetchNextCard(currentDeck.id, true).catch(() => {});
      }
      if (currentDeck && currentDeck.id !== 'duplicates') fetchDeckCards(currentDeck.id).catch(() => {});
      fetchDecks(true).catch(() => {});
      return true;
    } catch (err) {
      if (isCurrent()) showToast(tr('Ошибка при перемещении: {{p0}}', { p0: cardWriteError(err) }));
      return false;
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };

  const handleCopyCard = (targetCard, targetDeckId) => handleBatchTransferCards(
    [Number(targetCard.id)], targetDeckId, 'keep', true, [targetCard]);

  const handleShareCard = async (targetCard) => {
    if (!targetCard) return;
    try {
      let shareId = targetCard.share_id;
      if (!shareId) {
        try {
          const res = await api.post(`/share/generate/card/${targetCard.id}`);
          shareId = res.data?.share_id;
        } catch {
          shareId = `c_${targetCard.id}`;
        }
      }
      const link = getPublicShareUrl(shareId || `c_${targetCard.id}`);
      const isMobile = isTelegram() || isNative();
      if (isMobile) setLoading(true);

      const title = targetCard.front || tr("Карточка Lerne");
      const text = `${targetCard.front || ''} — ${targetCard.back || ''}`;
      
      const shareData = {
        title: tr("Учи слово в Lerne: {{p0}}", { p0: title }),
        text: tr("Изучай немецкий язык с карточкой: \"{{p0}}\"", { p0: text }),
        url: link
      };

      if (!isMobile && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(link);
        showToast(tr("Ссылка скопирована!"), "success");
        return { success: true, type: 'copy' };
      }

      if (navigator.share) {
        await navigator.share(shareData);
        return { success: true, type: 'share' };
      } else {
        const result = await executeShare({
          title: shareData.title,
          text: shareData.text,
          url: link,
          link
        });
        if (result.type === 'copy') {
          showToast(tr("Ссылка скопирована!"), "success");
        }
        if (isMobile) setLoading(false);
        return result;
      }
    } catch {
      showToast(tr("Ошибка при создании ссылки"), "error");
    } finally {
      setLoading(false);
    }
    return { success: false };
  };

  const handleSetCardFlag = async (targetCard, flag) => {
    if (!targetCard || !targetCard.id) return;
    try {
      const res = await api.post(`/cards/${targetCard.id}/flag`, { flag });
      const updatedCard = res.data;
      const session = useSessionStore.getState();
      if (session.card && session.card.id === targetCard.id) {
        session.setCard({ ...session.card, flag: updatedCard.flag });
      }
      session.setStudyHistory(session.studyHistory.map(c => c.id === targetCard.id ? { ...c, flag: updatedCard.flag } : c));
      useDeckStore.setState(state => ({
        deckCards: state.deckCards.map(c => c.id === targetCard.id ? { ...c, flag: updatedCard.flag } : c)
      }));
      showToast(flag ? tr("Метка установлена") : tr("Метка снята"), "success");
    } catch {
      showToast(tr("Ошибка при установке метки"));
    }
  };

  const handleBatchTransferCards = async (cardIds, targetDeckId, onDuplicate, copy, suppliedCards) => {
    if (!cardIds?.length || !targetDeckId) return false;
    const identity = getSessionIdentity();
    const account = getUserId();
    const isCurrent = () => identity === getSessionIdentity() && account === getUserId();
    const cards = suppliedCards || cardIds.map(visibleCard);
    setLoading(true);
    try {
      const db = await prepareLocalDb();
      for (const id of cardIds) {
        if (!isCurrent()) return false;
        if (id > 0 && navigator.onLine && !await db.cards.get(id)) await api.get('/cards/' + id, { freshCard: true });
      }
      if (!isCurrent()) return false;
      const { data } = await api.post(copy ? '/cards/batch-copy' : '/cards/batch-move', {
        request_id: crypto.randomUUID(), card_ids: cardIds.map(Number),
        revisions: Object.fromEntries(cardIds.map((id, index) => [id, cards[index]?.revision])),
        target_deck_id: Number(targetDeckId), on_duplicate: onDuplicate,
      });
      if (!isCurrent()) return false;
      const pending = data.cards.find(card => card.offline_move)?.offline_move;
      if (pending) showToast(offlineMoveLabel(pending), pending.status === 'rejected' ? 'error' : 'info');
      else if (copy) showToast(tr('Скопировано: {{p0}} (пропущено дубликатов: {{p1}})',
        { p0: data.count, p1: data.skipped }), 'success');
      else showToast(tr('Перемещено: {{p0}} (пропущено дубликатов: {{p1}})',
        { p0: data.count, p1: data.skipped }), 'success');

      const { currentDeck } = useDeckStore.getState();
      const affected = new Set([...cards.map(card => card?.deck_id), Number(targetDeckId)]);
      useDeckStore.setState(state => ({ cardsByDeck: Object.fromEntries(
        Object.entries(state.cardsByDeck).filter(([id]) => !affected.has(Number(id)))) }));
      if (!copy) {
        const session = useSessionStore.getState();
        for (const card of data.cards) {
          if (card.deck_id === Number(targetDeckId)) session.removeCardFromSession(card.id);
        }
      }
      if (currentDeck && currentDeck.id !== 'duplicates') await fetchDeckCards(currentDeck.id).catch(() => {});
      if (isCurrent()) fetchDecks(true).catch(() => {});
      return true;
    } catch (err) {
      if (isCurrent()) showToast(copy
        ? tr('Ошибка при копировании: {{p0}}', { p0: cardWriteError(err) })
        : tr('Ошибка при перемещении: {{p0}}', { p0: cardWriteError(err) }), 'error');
      return false;
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };

  const handleBatchMoveCards = (cardIds, targetDeckId, onDuplicate = 'skip') => cardIds?.length === 1
    ? handleMoveCard(visibleCard(cardIds[0]), targetDeckId, onDuplicate)
    : handleBatchTransferCards(cardIds, targetDeckId, onDuplicate, false);

  const handleBatchDeleteCards = async (cardIds, skipConfirm = false) => {
    if (!cardIds || cardIds.length === 0) return false;
    if (!skipConfirm && !window.confirm(tr("Удалить выбранные карточки ({{p0}} шт.)?", { p0: cardIds.length }))) return false;
    setLoading(true);
    try {
      const transport = cardIds.length === 1 ? api : networkApi;
      const { data } = await transport.post('/cards/batch-delete', {
        request_id: crypto.randomUUID(),
        card_ids: cardIds.map(Number),
        revisions: Object.fromEntries(cardIds.map(id => [id, visibleCard(id)?.revision]))
      });
      if (cardIds.length === 1 && !data.is_deleted) return false;
      showToast(data.offline_lifecycle ? tr('Ожидает синхронизации')
        : tr("Удалено карточек: {{p0}}", { p0: cardIds.length }), "success");

      const session = useSessionStore.getState();
      const { currentDeck, deckCards, cardsByDeck, decks } = useDeckStore.getState();
      const cardIdsSet = new Set(cardIds.map(String));

      const updatedDeckCards = (deckCards || []).filter(c => !cardIdsSet.has(String(c.id)));
      const sourceDeckId = currentDeck?.id;
      const updatedCardsByDeck = sourceDeckId
        ? { ...cardsByDeck, [sourceDeckId]: updatedDeckCards }
        : cardsByDeck;

      const count = cardIds.length;
      const updatedDecks = sourceDeckId
        ? (decks || []).map(d => {
            if (d.id === sourceDeckId) {
              const oldStats = d.stats || { total: count, new: 0, learning: 0, due: 0 };
              return {
                ...d,
                stats: { ...oldStats, total: Math.max(0, (oldStats.total || count) - count) }
              };
            }
            return d;
          })
        : decks;

      useDeckStore.setState({
        deckCards: updatedDeckCards,
        cardsByDeck: updatedCardsByDeck,
        decks: updatedDecks
      });

      cardIds.forEach(id => session.removeCardFromSession(id));
      fetchDecks(true);
      return true;
    } catch (err) {
      console.error('Batch Delete Error:', err);
      showToast(cardIds.length === 1 ? err.message || tr("Ошибка при удалении") : tr("Ошибка при удалении"), 'error');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleBatchCopyCards = (cardIds, targetDeckId, onDuplicate = 'skip') =>
    handleBatchTransferCards(cardIds, targetDeckId, onDuplicate, true);

  return {
    saveCard,
    handleDeleteCard,
    handleSetCardFlag,
    handleMoveCard,
    handleCopyCard,
    handleShareCard,
    handleBatchMoveCards,
    handleBatchCopyCards,
    handleBatchDeleteCards
  };
};
