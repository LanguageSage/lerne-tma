import React from 'react';
import { motion } from 'framer-motion';

export const CommunityTab = ({ communityDecks, promoteDeck }) => {
  return (
    <motion.div key="community" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="settings-section">
      <h3>Колоды пользователей</h3>
      <p className="field-hint">Одобряйте колоды, чтобы добавить их в общую библиотеку Lerne</p>
      
      <div className="community-list scrollable">
        {communityDecks.length === 0 ? <p className="hint">Новых колод пока нет</p> : 
          communityDecks.map((d) => (
            <div key={d.id} className="community-item glass">
              <div className="community-info">
                <strong>{d.name}</strong>
                <span>Пользователь: {d.user_id} | Карточек: {d.card_count}</span>
                {d.topic && <span className="tag">{d.topic}</span>}
              </div>
              <button className="btn btn-primary btn-small" onClick={() => promoteDeck(d.id)}>
                В Библиотеку
              </button>
            </div>
          ))
        }
      </div>
    </motion.div>
  );
};
