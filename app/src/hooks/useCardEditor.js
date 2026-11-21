import { tr } from '../i18n/locale';
import api from '../services/api';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useUiStore } from '../store/useUiStore';

import { cardWriteError } from '../utils/cardDraft';
import { getSessionIdentity, getUserId } from '../utils/auth';
import { prepareLocalDb } from '../services/localDb';
import { offlineLifecycleLabel, offlineMoveLabel } from '../services/offlineUi';
import { getPublicShareUrl, executeShare } from '../utils/share';
import { isTelegram, isNative } from '../utils/platform';
import { studyContent, studySideText } from '../utils/structuredStudyCard';

function visibleCard(cardId) {
  const deck = useDeckStore.getState();
  const session = useSessionStore.getState();
  return [session.editingCard, session.card, ...deck.deckCards, ...deck.duplicateCards]
    .find(card => String(card?.id) === String(cardId) && card.revision);
}

export const useCardEditor = (fetchNextCard) => {
  const { fetchDecks, fetchDeckCards } = useDeckStore();
  const { setLoading, showToast } = useUiStore();

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

      const content = studyContent(targetCard);
      const front = studySideText(content);
      const title = front || tr("Карточка Lerne");
      const text = [front, studySideText(content, 'back')].filter(Boolean).join(' — ');
      
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
    const identity = getSessionIdentity();
    const account = getUserId();
    const isCurrent = () => identity === getSessionIdentity() && account === getUserId();
    setLoading(true);
    try {
      const { data } = await api.post('/cards/batch-delete', {
        request_id: crypto.randomUUID(), card_ids: cardIds.map(Number),
        revisions: Object.fromEntries(cardIds.map(id => [id, visibleCard(id)?.revision])),
      });
      if (!isCurrent()) return false;
      const cards = data.cards || [data];
      if (cards.some(card => !card.is_deleted)) return false;
      const pending = cards.find(card => card.offline_lifecycle);
      showToast(pending ? offlineLifecycleLabel(pending)
        : tr('Удалено карточек: {{p0}}', { p0: cardIds.length }), pending ? (pending.offline_list_error ? 'error' : 'info') : 'success');
      const session = useSessionStore.getState();
      cardIds.forEach(id => session.removeCardFromSession(id));
      const { currentDeck } = useDeckStore.getState();
      if (currentDeck && currentDeck.id !== 'duplicates') await fetchDeckCards(currentDeck.id).catch(() => {});
      if (isCurrent()) fetchDecks(true).catch(() => {});
      return true;
    } catch (err) {
      if (isCurrent()) showToast(cardWriteError(err), 'error');
      return false;
    } finally {
      if (isCurrent()) setLoading(false);
    }

  };

  const handleBatchCopyCards = (cardIds, targetDeckId, onDuplicate = 'skip') =>
    handleBatchTransferCards(cardIds, targetDeckId, onDuplicate, true);

  return {
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
