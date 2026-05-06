import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, Sparkles, RefreshCw } from 'lucide-react';

export const CardCreator = ({
  view,
  setView,
  currentDeck,
  runAiGenerator,
  saveCard,
  loading,
  cardFont,
  cardTextColor,
  cardFontWeight,
  cardFontStyle,
}) => {
  const [newCardData, setNewCardData] = useState({
    front: '',
    back: '',
    context: '',
    deck_id: currentDeck?.id
  });

  if (view !== 'creator') return null;

  const handleAiGenerate = async () => {
    if (!newCardData.front) return;
    const result = await runAiGenerator(newCardData.front, true); // true means returning the data instead of setting it globally
    if (result) {
      setNewCardData(prev => ({
        ...prev,
        back: result.back || prev.back,
        context: result.context || prev.context
      }));
    }
  };

  const handleSave = () => {
    saveCard(newCardData);
  };

  return (
    <div className="view-creator">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="view">
        <div className="header-compact">
          <button className="back-btn" onClick={() => setView('cards')}><ChevronLeft size={24} /></button>
          <h2>Новая карточка</h2>
        </div>

        <div className="creator-form glass">
          <div className="form-group">
            <label>Слово или фраза (Front)</label>
            <div className="textarea-with-action">
              <textarea 
                autoFocus
                value={newCardData.front} 
                onChange={e => setNewCardData({...newCardData, front: e.target.value})}
                style={{ 
                  fontFamily: cardFont, 
                  fontWeight: cardFontWeight, 
                  fontStyle: cardFontStyle,
                  color: cardTextColor
                }}
                placeholder="Напр.: Die Herausforderung"
              />
            </div>
          </div>

          <div className="ai-quick-actions">
            <button 
              className="btn-ai-generate" 
              onClick={handleAiGenerate}
              disabled={loading || !newCardData.front}
            >
              {loading ? <RefreshCw className="spin" size={18} /> : <Sparkles size={18} />}
              <span>Сгенерировать ответ</span>
            </button>
          </div>

          <div className="form-group">
            <label>Перевод (Back)</label>
            <textarea 
              value={newCardData.back} 
              onChange={e => setNewCardData({...newCardData, back: e.target.value})}
              style={{ 
                fontFamily: cardFont, 
                fontWeight: cardFontWeight, 
                fontStyle: cardFontStyle,
                color: cardTextColor
              }}
              placeholder="Перевод появится здесь..."
            />
          </div>

          <div className="form-group">
            <label>Контекст (Пример)</label>
            <textarea 
              value={newCardData.context} 
              onChange={e => setNewCardData({...newCardData, context: e.target.value})}
              placeholder="Пример использования..."
            />
          </div>

          <div className="creator-actions">
            <button className="btn btn-primary btn-full" onClick={handleSave} disabled={loading || !newCardData.front}>
              {loading ? <RefreshCw className="spin" /> : 'Создать карточку'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
