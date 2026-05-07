import React from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, Trash2, Plus } from 'lucide-react';

export const CardList = ({
  view,
  currentDeck,
  deckCards,
  setView,
  openEditor,
  openCreator,
  handleDeleteCard
}) => {
  if (view !== 'cards') return null;

  return (
    <div className="view-cards">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="view">
        <div className="header-compact">
          <button className="back-btn" onClick={() => setView('decks')}><ChevronLeft size={24} /></button>
          <h2 className="header-title">{currentDeck?.name}</h2>
          <div style={{ width: 40 }}></div> {/* Spacer to keep title centered */}
        </div>
        <div id="tut-card-list-content" className="card-list">
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
        
        {/* Floating Action Button for adding cards */}
        <button id="tut-fab-add" className="fab-add-card" onClick={() => openCreator(currentDeck?.id)}>
          <Plus size={28} />
        </button>
      </motion.div>
    </div>
  );
};
