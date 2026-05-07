import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, Sparkles, RefreshCw, Volume2 } from 'lucide-react';

export const CardCreator = ({
  view,
  setView,
  currentDeck,
  runAiGenerator,
  generateAudioInternal,
  playAudio,
  saveCard,
  loading,
  cardFont,
  cardTextColor,
  cardFontWeight,
  cardFontStyle,
  cardBgFront,
  cardBgBack,
  contextFont,
  contextTextColor,
  contextFontSize,
  contextFontWeight,
  contextFontStyle,
}) => {
  const [newCardData, setNewCardData] = useState({
    front: '',
    back: '',
    context: '',
    deck_id: currentDeck?.id
  });

  React.useEffect(() => {
    if (view === 'creator') {
      setNewCardData({
        front: '',
        back: '',
        context: '',
        deck_id: currentDeck?.id
      });
    }
  }, [view, currentDeck?.id]);

  if (view !== 'creator') return null;

  const handleAiGenerate = async () => {
    if (!newCardData.front) return;
    const result = await runAiGenerator(newCardData.front, true);
    if (result) {
      const updated = {
        ...newCardData,
        front: result.front || newCardData.front,
        back: result.back || newCardData.back,
        context: result.context || newCardData.context
      };
      setNewCardData(updated);
      
      // Auto-generate audio after AI generation
      setTimeout(() => {
        generateAudioInternal(updated, setNewCardData);
      }, 500);
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
                  color: cardTextColor,
                  background: cardBgFront || 'rgba(255,255,255,0.03)',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center'
                }}
                placeholder="Напр.: Die Herausforderung"
              />
            </div>
            
            <div className="editor-audio-actions" style={{ marginTop: '10px' }}>
              <button 
                className="btn-secondary btn-small" 
                onClick={() => generateAudioInternal(newCardData, setNewCardData)}
                disabled={loading || !newCardData.front}
              >
                <Volume2 size={16} /> Озвучить
              </button>
              {(newCardData.audio_path || newCardData.audio_url) && (
                <button 
                  className="btn-secondary btn-small play-preview-btn" 
                  onClick={() => playAudio(newCardData.audio_url || `/api/media/${newCardData.audio_path}`)}
                >
                  <RefreshCw size={14} /> Прослушать
                </button>
              )}
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
                color: cardTextColor,
                background: cardBgBack || 'rgba(255,255,255,0.03)',
                backgroundSize: 'cover',
                backgroundPosition: 'center'
              }}
              placeholder="Перевод..."
            />
          </div>

          <div className="form-group">
            <label>Контекст / Анализ</label>
            <textarea 
              className="context-textarea"
              value={newCardData.context} 
              onChange={e => setNewCardData({...newCardData, context: e.target.value})}
              style={{ 
                fontFamily: contextFont, 
                fontSize: `${contextFontSize}rem`,
                color: contextTextColor,
                fontWeight: contextFontWeight,
                fontStyle: contextFontStyle,
                background: cardBgBack || 'rgba(255,255,255,0.03)',
                backgroundSize: 'cover',
                backgroundPosition: 'center'
              }}
              placeholder="Примеры, грамматика..."
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
