import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, Trash2, Edit2, Share2, Copy, Inbox, Layers, BookOpen } from 'lucide-react';
import api from '../services/api';
import { useUiStore } from '../store/useUiStore';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useCardNavigation } from '../hooks/useCardNavigation';
import { useCardActions } from '../hooks/useCardActions';
import { stripMarkdown } from '../utils/text';

export const DuplicateManager = () => {
  const { setView, setActionCard, setIsCardActionModalOpen, showToast, setIsOpeningDeck } = useUiStore();
  const { duplicateCards, fetchDuplicates, setCurrentDeck, lastDuplicateCardId, setLastDuplicateCardId } = useDeckStore();
  const { openEditor } = useCardNavigation();
  const { handleDeleteCard, handleShareCard, fetchNextCard } = useCardActions();

  useEffect(() => {
    if (lastDuplicateCardId) {
      const timer = setTimeout(() => {
        const el = document.getElementById(`duplicate-card-${lastDuplicateCardId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [lastDuplicateCardId]);

  const handleBack = () => {
    setView('decks');
  };

  const onShow = async () => {
    setIsOpeningDeck(true);
    try {
      setCurrentDeck({ id: 'duplicates', name: 'Дубликаты' });
      setView('study');
      useSessionStore.getState().resetSession();
      await fetchNextCard('duplicates', true);
    } finally {
      setIsOpeningDeck(false);
    }
  };

  const onViewCard = async (card) => {
    // Open specific card for viewing (using startStudyCard logic from App.jsx but simplified)
    setIsOpeningDeck(true);
    try {
      setLastDuplicateCardId(card.id);
      setCurrentDeck({ id: 'duplicates', name: 'Дубликаты' });
      setView('study');
      useSessionStore.getState().resetSession();
      
      const res = await api.get(`/study/card/${card.id}`);
      useSessionStore.getState().setCard(res.data);
      useSessionStore.getState().addToHistory(res.data);
    } catch (err) {
      showToast("Ошибка при открытии карточки");
    } finally {
      setIsOpeningDeck(false);
    }
  };

  const onDelete = async (e, cardId) => {
    e.stopPropagation();
    if (window.confirm('Вы уверены, что хотите удалить этот дубликат?')) {
      await handleDeleteCard(cardId, true);
      fetchDuplicates();
    }
  };

  const onEdit = (e, card) => {
    e.stopPropagation();
    openEditor(card.deck_id, {
      ...card,
      front: card.front,
      back: card.back
    }, 'duplicates');
  };

  // Group duplicates by front text to show pairs/triplets together
  const groups = duplicateCards.reduce((acc, card) => {
    if (!acc[card.front]) acc[card.front] = [];
    acc[card.front].push(card);
    return acc;
  }, {});

  return (
    <div className="view-duplicates">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="view">
        <div className="header-compact">
          <button className="back-btn" onClick={handleBack}><ChevronLeft size={24} /></button>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <h2 style={{ marginBottom: 2 }}>Дубликаты</h2>
            <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>
              Найдено {duplicateCards.length} карточек ({Object.keys(groups).length} групп)
            </p>
          </div>
          <button 
            className="btn btn-primary btn-tiny" 
            onClick={onShow}
            disabled={duplicateCards.length === 0}
            style={{ padding: '6px 12px' }}
          >
            <BookOpen size={16} /> Показать
          </button>
        </div>

        <div className="duplicate-list-container" style={{ padding: '0 16px 80px' }}>
          {Object.entries(groups).map(([front, cards]) => (
            <div key={front} className="duplicate-group glass" style={{ 
              marginBottom: 20, 
              padding: 16, 
              borderRadius: 18, 
              background: 'rgba(15, 23, 42, 0.4)',
              border: '1px solid rgba(255, 255, 255, 0.1)'
            }}>
              <div className="group-header" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Copy size={16} color="#818cf8" />
                <strong style={{ color: '#818cf8', fontSize: '0.9rem' }}>Группа: {stripMarkdown(front)}</strong>
              </div>

              <div className="cards-stack" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {cards.map(card => (
                  <div key={card.id} id={`duplicate-card-${card.id}`} className="duplicate-item glass" 
                    onClick={() => onViewCard(card)}
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.05)',
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#94a3b8', fontSize: '0.75rem' }}>
                        <Layers size={12} />
                        <span>Из колоды: </span>
                        <strong style={{ color: '#e2e8f0' }}>{card.deck_name}</strong>
                      </div>
                      <div className="item-actions" style={{ display: 'flex', gap: 8 }}>
                        <button onClick={(e) => { e.stopPropagation(); handleShareCard(card); }} style={{ background: 'none', border: 'none', color: '#94a3b8', padding: 4 }}><Share2 size={16} /></button>
                        <button onClick={(e) => onEdit(e, card)} style={{ background: 'none', border: 'none', color: '#818cf8', padding: 4 }}><Edit2 size={16} /></button>
                        <button onClick={(e) => onDelete(e, card.id)} style={{ background: 'none', border: 'none', color: '#ef4444', padding: 4 }}><Trash2 size={16} /></button>
                      </div>
                    </div>
                    <div style={{ fontSize: '0.9rem', color: '#fff' }}>{stripMarkdown(card.back)}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}


          {duplicateCards.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#64748b' }}>
              <Inbox size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
              <p>Дубликаты не найдены. Всё чисто!</p>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
