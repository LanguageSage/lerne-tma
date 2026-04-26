import React from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, Trash2 } from 'lucide-react';

export const CardList = ({
  view,
  currentDeck,
  deckCards,
  setView,
  openEditor,
  handleDeleteCard
}) => {
  if (view !== 'cards') return null;

  return (
    <div className="view-cards">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="view">
        <div className="header-compact">
          <button className="back-btn" onClick={() => setView('decks')}><ChevronLeft size={24} /></button>
          <h2>{currentDeck?.name}</h2>
          <button className="add-card-btn" onClick={() => openEditor(currentDeck?.id, null, 'cards')}>+</button>
        </div>
        <div className="card-list">
          {deckCards.map(c => (
            <div key={c.id} className="card-item glass" onClick={() => openEditor(currentDeck.id, c, 'cards')}>
              <div className="card-item-text">
                <div className="front-min">{c.front}</div>
                <div className="back-min">{c.back}</div>
              </div>
              <div className="card-item-actions">
                <div className="card-item-edit" onClick={(e) => { e.stopPropagation(); openEditor(currentDeck.id, c, 'cards'); }}>✎</div>
                <div className="card-item-delete" onClick={(e) => handleDeleteCard(e, c.id)}><Trash2 size={16} /></div>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
};
