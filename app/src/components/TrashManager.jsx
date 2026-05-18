import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, RotateCcw, ArrowLeft, Layers, FileText, CheckCircle, RefreshCw } from 'lucide-react';
import { useUiStore } from '../store/useUiStore';
import { useDeckStore } from '../store/useDeckStore';
import './TrashManager.css';

export const TrashManager = () => {
  const [activeTab, setActiveTab] = useState('decks'); // 'decks' | 'cards'
  const [restoringId, setRestoringId] = useState(null);
  const [clearing, setClearing] = useState(false);
  
  const { setView, showToast } = useUiStore();
  const { trashItems, fetchTrash, restoreTrashDeck, restoreTrashCard, clearTrash } = useDeckStore();

  useEffect(() => {
    fetchTrash();
  }, [fetchTrash]);

  const handleRestoreDeck = async (deckId) => {
    setRestoringId(`deck-${deckId}`);
    try {
      await restoreTrashDeck(deckId);
      showToast('Колода успешно восстановлена!', 'success');
    } catch (err) {
      showToast('Ошибка при восстановлении колоды');
    } finally {
      setRestoringId(null);
    }
  };

  const handleRestoreCard = async (cardId) => {
    setRestoringId(`card-${cardId}`);
    try {
      await restoreTrashCard(cardId);
      showToast('Карточка успешно восстановлена!', 'success');
    } catch (err) {
      showToast('Ошибка при восстановлении карточки');
    } finally {
      setRestoringId(null);
    }
  };

  const handleClearTrash = async () => {
    if (!window.confirm('Вы уверены, что хотите окончательно удалить все элементы из корзины? Это действие необратимо!')) {
      return;
    }
    setClearing(true);
    try {
      await clearTrash();
      showToast('Корзина успешно очищена', 'success');
    } catch (err) {
      showToast('Ошибка при очистке корзины');
    } finally {
      setClearing(false);
    }
  };

  const { decks = [], cards = [] } = trashItems || {};
  const isEmpty = decks.length === 0 && cards.length === 0;

  return (
    <motion.div 
      className="trash-container"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <div className="trash-header">
        <button className="trash-back-btn" onClick={() => setView('decks')}>
          <ArrowLeft size={18} /> Назад к колодам
        </button>
        <div className="trash-title">
          <Trash2 size={24} color="#f87171" />
          <h1>Корзина</h1>
        </div>
        <button 
          className="trash-clear-btn" 
          onClick={handleClearTrash}
          disabled={isEmpty || clearing}
        >
          {clearing ? <RefreshCw size={16} className="spin" /> : <Trash2 size={16} />}
          <span>Очистить корзину</span>
        </button>
      </div>

      <div className="trash-tabs">
        <button 
          className={`trash-tab ${activeTab === 'decks' ? 'active' : ''}`}
          onClick={() => setActiveTab('decks')}
        >
          <Layers size={18} />
          <span>Колоды ({decks.length})</span>
        </button>
        <button 
          className={`trash-tab ${activeTab === 'cards' ? 'active' : ''}`}
          onClick={() => setActiveTab('cards')}
        >
          <FileText size={18} />
          <span>Карточки ({cards.length})</span>
        </button>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'decks' ? (
          <motion.div 
            key="decks"
            className="trash-grid"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {decks.length === 0 ? (
              <div className="trash-empty" style={{ gridColumn: '1 / -1' }}>
                <Layers size={48} opacity={0.3} />
                <h3>Удаленных колод нет</h3>
                <p>Колоды, которые вы удалите, появятся здесь для возможности восстановления.</p>
              </div>
            ) : (
              decks.map((deck) => (
                <motion.div key={deck.id} className="trash-card" layout>
                  <div className="trash-card-content">
                    <h3>{deck.name}</h3>
                    {deck.topic && <div className="trash-card-meta">📁 {deck.topic}</div>}
                    <div className="trash-card-meta" style={{ marginTop: 8 }}>
                      🃏 {deck.cards_count} карточек
                    </div>
                  </div>
                  <div className="trash-card-actions">
                    <button 
                      className="trash-restore-btn"
                      onClick={() => handleRestoreDeck(deck.id)}
                      disabled={restoringId === `deck-${deck.id}`}
                    >
                      {restoringId === `deck-${deck.id}` ? (
                        <RefreshCw size={16} className="spin" />
                      ) : (
                        <><RotateCcw size={16} /> Восстановить</>
                      )}
                    </button>
                  </div>
                </motion.div>
              ))
            )}
          </motion.div>
        ) : (
          <motion.div 
            key="cards"
            className="trash-grid"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {cards.length === 0 ? (
              <div className="trash-empty" style={{ gridColumn: '1 / -1' }}>
                <FileText size={48} opacity={0.3} />
                <h3>Удаленных карточек нет</h3>
                <p>Отдельные карточки, которые вы удалите, появятся здесь.</p>
              </div>
            ) : (
              cards.map((card) => (
                <motion.div key={card.id} className="trash-card" layout>
                  <div className="trash-card-content">
                    <h3 style={{ fontSize: '1rem', marginBottom: 4 }}>{card.front}</h3>
                    {card.back && (
                      <p style={{ fontSize: '0.85rem', color: '#cbd5e1', margin: '0 0 8px 0', lineHeight: 1.4 }}>
                        {card.back}
                      </p>
                    )}
                    <div className="trash-card-meta">
                      📚 {card.deck_name}
                    </div>
                  </div>
                  <div className="trash-card-actions">
                    <button 
                      className="trash-restore-btn"
                      onClick={() => handleRestoreCard(card.id)}
                      disabled={restoringId === `card-${card.id}`}
                    >
                      {restoringId === `card-${card.id}` ? (
                        <RefreshCw size={16} className="spin" />
                      ) : (
                        <><RotateCcw size={16} /> Восстановить</>
                      )}
                    </button>
                  </div>
                </motion.div>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
