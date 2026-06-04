import { db } from './localDb';
import api from './api';
import { getUserId } from '../utils/auth';

export const syncService = {
  isSyncing: false,

  async sync() {
    if (this.isSyncing) return { success: false, reason: "Already syncing" };
    this.isSyncing = true;
    console.log("[Sync Service] Starting synchronization...");

    const userId = getUserId();
    const nowStr = new Date().toISOString();

    try {
      // 1. Gather dirty items from local database
      const dirtyDecks = await db.decks.where('is_dirty').equals(1).toArray();
      const dirtyCards = await db.cards.where('is_dirty').equals(1).toArray();
      const dirtyProgress = await db.progress.where('is_dirty').equals(1).toArray();

      logger_log(`Found dirty items: Decks=${dirtyDecks.length}, Cards=${dirtyCards.length}, Progress=${dirtyProgress.length}`);

      // Format payload for backend
      const payload = {
        decks: dirtyDecks.map(d => ({
          id: d.id,
          name: d.name,
          level: d.level || null,
          topic: d.topic || null,
          is_deleted: !!d.is_deleted,
          created_at: d.created_at,
          updated_at: d.updated_at
        })),
        cards: dirtyCards.map(c => ({
          id: c.id,
          deck_id: c.deck_id,
          front_text: c.front_text,
          back_text: c.back_text,
          context: c.context || null,
          image_path: c.image_path || null,
          audio_path: c.audio_path || null,
          audio_back_path: c.audio_back_path || null,
          video_front_path: c.video_front_path || null,
          video_back_path: c.video_back_path || null,
          want_to_learn: !!c.want_to_learn,
          is_deleted: !!c.is_deleted,
          created_at: c.created_at,
          updated_at: c.updated_at
        })),
        progress: dirtyProgress.map(p => ({
          card_id: p.card_id,
          queue: p.queue,
          interval: p.interval,
          ease_factor: p.ease_factor,
          repetitions: p.repetitions,
          lapses: p.lapses,
          step_index: p.step_index,
          next_review: p.next_review,
          last_reviewed: p.last_reviewed,
          created_at: p.created_at,
          updated_at: p.updated_at
        }))
      };

      // 2. Push local changes to the server
      let mappings = { decks: {}, cards: {} };
      if (dirtyDecks.length > 0 || dirtyCards.length > 0 || dirtyProgress.length > 0) {
        // Use direct Axios bypass config or bypass checking
        const pushRes = await api.post('/sync/push', payload);
        if (pushRes.data && pushRes.data.status === 'success') {
          mappings = pushRes.data.mappings || { decks: {}, cards: {} };
        }
      }

      // Apply deck ID mappings (replace negative temp IDs with real server IDs)
      for (const [tempIdStr, realId] of Object.entries(mappings.decks || {})) {
        const tempId = parseInt(tempIdStr, 10);
        const deck = await db.decks.get(tempId);
        if (deck) {
          await db.decks.delete(tempId);
          deck.id = realId;
          deck.is_dirty = 0;
          await db.decks.put(deck);
        }
        // Update any local card foreign keys pointing to this temp deck ID
        const cardsToUpdate = await db.cards.where('deck_id').equals(tempId).toArray();
        for (const c of cardsToUpdate) {
          await db.cards.update(c.id, { deck_id: realId });
        }
      }

      // Apply card ID mappings (replace negative temp IDs with real server IDs)
      for (const [tempIdStr, realId] of Object.entries(mappings.cards || {})) {
        const tempId = parseInt(tempIdStr, 10);
        const card = await db.cards.get(tempId);
        if (card) {
          await db.cards.delete(tempId);
          card.id = realId;
          card.is_dirty = 0;
          await db.cards.put(card);
        }
        // Update any progress records pointing to this temp card ID
        const progress = await db.progress.get([tempId, userId]);
        if (progress) {
          await db.progress.delete([tempId, userId]);
          progress.card_id = realId;
          progress.is_dirty = 0;
          await db.progress.put(progress);
        }
      }

      // Reset is_dirty for already positive ID items that were successfully pushed
      const deckIdsPushed = dirtyDecks.filter(d => d.id >= 0).map(d => d.id);
      if (deckIdsPushed.length > 0) {
        await db.decks.where('id').anyOf(deckIdsPushed).modify({ is_dirty: 0 });
      }
      const cardIdsPushed = dirtyCards.filter(c => c.id >= 0).map(c => c.id);
      if (cardIdsPushed.length > 0) {
        await db.cards.where('id').anyOf(cardIdsPushed).modify({ is_dirty: 0 });
      }
      for (const p of dirtyProgress) {
        if (p.card_id >= 0) {
          await db.progress.update([p.card_id, userId], { is_dirty: 0 });
        }
      }

      // Remove local items marked as hard_deleted_locally since they are now pushed to the server
      await db.decks.filter(d => !!d.hard_deleted_locally && !d.is_dirty).delete();
      await db.cards.filter(c => !!c.hard_deleted_locally && !c.is_dirty).delete();

      // 3. Pull updates from server since last sync time
      const lastSyncTime = localStorage.getItem('lerne_last_sync_time') || '';
      const pullRes = await api.get(`/sync/pull?since=${encodeURIComponent(lastSyncTime)}`);

      if (pullRes.data && pullRes.data.status === 'success') {
        const { decks, cards, progress, server_time } = pullRes.data;

        // Upsert pulled decks (only if local deck is not dirty)
        for (const d of decks) {
          const localDeck = await db.decks.get(d.id);
          if (!localDeck || !localDeck.is_dirty) {
            await db.decks.put({
              id: d.id,
              user_id: userId,
              name: d.name,
              level: d.level,
              topic: d.topic,
              is_deleted: d.is_deleted ? 1 : 0,
              is_inbox: d.is_inbox ? 1 : 0,
              created_at: d.created_at,
              updated_at: d.updated_at,
              is_dirty: 0
            });
          }
        }

        // Upsert pulled cards (only if local card is not dirty)
        for (const c of cards) {
          const localCard = await db.cards.get(c.id);
          if (!localCard || !localCard.is_dirty) {
            await db.cards.put({
              id: c.id,
              deck_id: c.deck_id,
              front_text: c.front_text,
              back_text: c.back_text,
              context: c.context,
              image_path: c.image_path,
              audio_path: c.audio_path,
              audio_back_path: c.audio_back_path,
              video_front_path: c.video_front_path,
              video_back_path: c.video_back_path,
              want_to_learn: c.want_to_learn ? 1 : 0,
              is_deleted: c.is_deleted ? 1 : 0,
              created_at: c.created_at,
              updated_at: c.updated_at,
              is_dirty: 0
            });
          }
        }

        // Upsert pulled progress (only if local progress is not dirty)
        for (const p of progress) {
          const localProgress = await db.progress.get([p.card_id, userId]);
          if (!localProgress || !localProgress.is_dirty) {
            await db.progress.put({
              card_id: p.card_id,
              user_id: userId,
              queue: p.queue,
              interval: p.interval,
              ease_factor: p.ease_factor,
              repetitions: p.repetitions,
              lapses: p.lapses,
              step_index: p.step_index,
              next_review: p.next_review,
              last_reviewed: p.last_reviewed,
              created_at: p.created_at,
              updated_at: p.updated_at,
              is_dirty: 0
            });
          }
        }

        // Save server time as last sync time
        localStorage.setItem('lerne_last_sync_time', server_time);
        console.log(`[Sync Service] Sync complete. Server time: ${server_time}`);
        return { success: true, server_time };
      }

      return { success: false, reason: "Invalid server response" };
    } catch (err) {
      console.error("[Sync Service] Error during synchronization:", err);
      return { success: false, reason: err.message };
    } finally {
      this.isSyncing = false;
    }
  }
};

function logger_log(msg) {
  console.log(`[Sync Service] ${msg}`);
}
