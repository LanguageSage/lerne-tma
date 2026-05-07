import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, Sparkles, RefreshCw, Volume2 } from 'lucide-react';
import { CardBackground } from './common/CardBackground';
import { getTextShadow, getContextShadow } from '../utils/style';

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
  cardFontSize,
  cardTextShadow,
  contextTextShadow,
}) => {
  const [newCardData, setNewCardData] = useState({
    front: '',
    back: '',
    context: '',
    audio_path: '',
    audio_url: '',
    image_path: '',
    image_url: '',
    deck_id: currentDeck?.id
  });

  const frontRef = useRef(null);
  const backRef = useRef(null);
  const contextRef = useRef(null);

  const autoResize = (ref) => {
    if (ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = `${ref.current.scrollHeight}px`;
    }
  };

  useEffect(() => { autoResize(frontRef); }, [newCardData.front]);
  useEffect(() => { autoResize(backRef); }, [newCardData.back]);
  useEffect(() => { autoResize(contextRef); }, [newCardData.context]);

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

  const availableStyles = ['mesh', 'aurora', 'holographic', 'liquid', 'liquid_sunset', 'liquid_ocean', 'liquid_cosmic', 'liquid_emerald', 'video_aquarium', 'video_space', 'video_nature'];
  const getResolvedStyle = (settingStyle, cardId) => {
    if (settingStyle !== 'auto') return settingStyle;
    if (!cardId) return 'standard';
    const sum = cardId.toString().split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    return availableStyles[sum % availableStyles.length];
  };

  const resolvedBgFront = getResolvedStyle(cardBgFront, 0); // Using 0 for new card
  const resolvedBgBack = getResolvedStyle(cardBgBack, 0);

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
            <div className="card-preview-container glass" style={{ position: 'relative', overflow: 'hidden', borderRadius: '12px' }}>
              <CardBackground styleType={resolvedBgFront} />
              <textarea 
                ref={frontRef}
                autoFocus
                value={newCardData.front} 
                onChange={e => setNewCardData({...newCardData, front: e.target.value})}
                style={{ 
                  fontFamily: cardFont, 
                  fontWeight: cardFontWeight, 
                  fontStyle: cardFontStyle,
                  color: cardTextColor,
                  fontSize: `${cardFontSize}rem`,
                  textShadow: getTextShadow(cardTextShadow, cardTextColor),
                  background: 'transparent',
                  position: 'relative',
                  zIndex: 2,
                  minHeight: '100px',
                  border: 'none',
                  resize: 'none',
                  overflow: 'hidden',
                  width: '100%',
                  display: 'block'
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
            <div className="card-preview-container glass" style={{ position: 'relative', overflow: 'hidden', borderRadius: '12px' }}>
              <CardBackground styleType={resolvedBgBack} />
              <textarea 
                ref={backRef}
                value={newCardData.back} 
                onChange={e => setNewCardData({...newCardData, back: e.target.value})}
                style={{ 
                  fontFamily: cardFont, 
                  fontWeight: cardFontWeight, 
                  fontStyle: cardFontStyle,
                  color: cardTextColor,
                  fontSize: `${cardFontSize}rem`,
                  textShadow: getTextShadow(cardTextShadow, cardTextColor),
                  background: 'transparent',
                  position: 'relative',
                  zIndex: 2,
                  minHeight: '80px',
                  border: 'none',
                  resize: 'none',
                  overflow: 'hidden',
                  width: '100%',
                  display: 'block'
                }}
                placeholder="Перевод..."
              />
            </div>
          </div>

          <div className="form-group">
            <div className="card-preview-container glass" style={{ position: 'relative', overflow: 'hidden', borderRadius: '12px' }}>
              <CardBackground styleType={resolvedBgBack} />
              <textarea 
                ref={contextRef}
                className="context-textarea"
                value={newCardData.context} 
                onChange={e => setNewCardData({...newCardData, context: e.target.value})}
                style={{ 
                  fontFamily: contextFont, 
                  fontSize: `${contextFontSize}rem`,
                  color: contextTextColor,
                  fontWeight: contextFontWeight,
                  fontStyle: contextFontStyle,
                  textShadow: getContextShadow(contextTextShadow, contextTextColor),
                  background: 'transparent',
                  position: 'relative',
                  zIndex: 2,
                  minHeight: '120px',
                  border: 'none',
                  resize: 'none',
                  overflow: 'hidden',
                  width: '100%',
                  display: 'block'
                }}
                placeholder="Примеры, грамматика..."
              />
            </div>
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
