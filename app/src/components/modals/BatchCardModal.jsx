import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, Layers, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import { useDeckStore } from '../../store/useDeckStore';
import { useCardActions } from '../../hooks/useCardActions';
import { CardLevelBadge } from '../common/CardLevelBadge';
import { syncService } from '../../services/syncService';

export const BatchCardModal = () => {
  const { isBatchModalOpen, setIsBatchModalOpen, showToast } = useUiStore();
  const { currentDeck } = useDeckStore();
  const { runBatchAiGenerator } = useCardActions();

  const [rawText, setRawText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedCards, setGeneratedCards] = useState(null);

  const handleClose = () => {
    if (isGenerating) return;
    setRawText('');
    setIsGenerating(false);
    setGeneratedCards(null);
    setIsBatchModalOpen(false);
  };

  if (!isBatchModalOpen) return null;

  const lines = rawText
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const lineCount = lines.length;
  const isOverLimit = lineCount > 30;
  const effectiveCount = isOverLimit ? 30 : lineCount;

  const handleGenerate = async () => {
    if (lineCount === 0) {
      showToast('Введите хотя бы одну фразу для генерации', 'error');
      return;
    }

    setIsGenerating(true);
    setGeneratedCards(null);

    const targetText = lines.slice(0, 30).join('\n');
    const result = await runBatchAiGenerator(targetText, currentDeck?.id);

    setIsGenerating(false);

    if (result && result.cards && result.cards.length > 0) {
      const cardsList = result.saved_cards || result.cards;
      setGeneratedCards(cardsList);

      // Auto-sync into Dexie & Zustand store if cards were saved to DB or created
      if (currentDeck?.id) {
        const { deckCards, fetchDeckCards, fetchDecks } = useDeckStore.getState();
        const newCardObjects = cardsList.map(cardData => ({
          id: cardData.id || Date.now() + Math.random(),
          deck_id: currentDeck.id,
          front: cardData.front || cardData.front_text || '',
          front_text: cardData.front_text || cardData.front || '',
          back: cardData.back || cardData.back_text || '',
          back_text: cardData.back_text || cardData.back || '',
          context: cardData.context || '',
          tags: cardData.tags || cardData.level || 'A1',
          level: cardData.level || 'A1',
          position: cardData.position || (deckCards ? deckCards.length : 0),
          source: 'ai_batch',
          created_at: new Date().toISOString()
        }));

        useDeckStore.setState({ deckCards: [...(deckCards || []), ...newCardObjects] });

        await Promise.all(newCardObjects.map(card => syncService.saveCardLocal(card)));
        fetchDeckCards(currentDeck.id).catch(err => console.warn('Background deck cards refresh:', err));
        fetchDecks(true).catch(err => console.warn('Background decks refresh:', err));
      }
    }
  };

  const handleDone = () => {
    handleClose();
  };

  return (
    <AnimatePresence>
      <div className="settings-overlay" onClick={handleClose} style={{ zIndex: 1100 }}>
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 20 }} 
          animate={{ opacity: 1, scale: 1, y: 0 }} 
          exit={{ opacity: 0, scale: 0.95, y: 20 }} 
          className="settings-modal" 
          onClick={e => e.stopPropagation()}
          style={{ maxWidth: 500, width: '90%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: '20px' }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12,
                background: 'linear-gradient(135deg, rgba(99,102,241,0.25), rgba(168,85,247,0.25))',
                border: '1px solid rgba(168,85,247,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <Layers size={22} color="#c084fc" />
              </div>
              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'white', margin: 0 }}>
                  Пакетная генерация ИИ
                </h3>
                <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                  {currentDeck ? `Колода: ${currentDeck.name}` : 'Каждая строка — 1 карточка'}
                </span>
              </div>
            </div>
            <button className="close-btn" disabled={isGenerating} onClick={handleClose}>
              <X size={20} />
            </button>
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {!generatedCards ? (
              <>
                <p style={{ fontSize: '0.88rem', color: '#cbd5e1', margin: 0, lineHeight: 1.4 }}>
                  Вставьте список слов или фраз (по одному выражению на строку). ИИ автоматически сгенерирует переводы, контекст и определит уровень языка CEFR для каждой фразы.
                </p>

                <div style={{ position: 'relative' }}>
                  <textarea
                    rows={8}
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    disabled={isGenerating}
                    placeholder={`Der Hund\nDie Katze\nMein erster Eindruck ist, dass das Gebäude sehr modern wirkt.\nDas Haus mit dem großen Garten.`}
                    style={{
                      width: '100%',
                      padding: '12px 14px',
                      borderRadius: 12,
                      background: 'rgba(15, 23, 42, 0.6)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      color: 'white',
                      fontSize: '0.92rem',
                      fontFamily: 'inherit',
                      resize: 'vertical',
                      boxSizing: 'border-box'
                    }}
                  />
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginTop: 6, fontSize: '0.8rem', color: isOverLimit ? '#f87171' : '#94a3b8'
                  }}>
                    <span>
                      {lineCount === 0 ? 'Введите список фраз' : `Обнаружено строк: ${lineCount}`}
                    </span>
                    <span>Лимит: до 30 строк</span>
                  </div>
                </div>

                {isOverLimit && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 12px', borderRadius: 8,
                    background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#fca5a5', fontSize: '0.82rem'
                  }}>
                    <AlertCircle size={16} />
                    <span>Будет обработано первые 30 строк за один запрос.</span>
                  </div>
                )}
              </>
            ) : (
              /* Results List */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#4ade80', fontWeight: 600, fontSize: '0.95rem' }}>
                  <CheckCircle2 size={20} />
                  <span>Успешно создано карточек: {generatedCards.length}</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '350px', overflowY: 'auto', paddingRight: 4 }}>
                  {generatedCards.map((card, idx) => (
                    <div key={idx} style={{
                      padding: '10px 14px',
                      borderRadius: 10,
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, color: '#f8fafc', fontSize: '0.92rem' }}>
                          {card.front_text || card.front}
                        </span>
                        <CardLevelBadge card={card} size="sm" />
                      </div>
                      <span style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
                        {card.back_text || card.back}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            {!generatedCards ? (
              <>
                <button
                  className="btn btn-secondary"
                  onClick={handleClose}
                  disabled={isGenerating}
                  style={{ padding: '10px 18px', borderRadius: 12 }}
                >
                  Отмена
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleGenerate}
                  disabled={isGenerating || lineCount === 0}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '10px 20px', borderRadius: 12, fontWeight: 600
                  }}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 size={18} className="spin" />
                      Генерация ({effectiveCount})...
                    </>
                  ) : (
                    <>
                      <Sparkles size={18} />
                      Сгенерировать ({effectiveCount})
                    </>
                  )}
                </button>
              </>
            ) : (
              <button
                className="btn btn-primary btn-full"
                onClick={handleDone}
                style={{ padding: '12px', borderRadius: 12, fontWeight: 600 }}
              >
                Готово
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
