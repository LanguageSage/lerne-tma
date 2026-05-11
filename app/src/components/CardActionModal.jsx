import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Move, Copy, Trash2, Heart } from 'lucide-react';

export const CardActionModal = ({
  isOpen,
  onClose,
  card,
  decks,
  onMove,
  onCopy,
  onDelete,
  onToggleLearn,
  onShare,
  loading
}) => {
  const [mode, setMode] = React.useState('main'); // 'main' | 'move' | 'copy'

  // Reset mode when modal opens
  React.useEffect(() => {
    if (isOpen) setMode('main');
  }, [isOpen]);

  if (!isOpen || !card) return null;

  const handleMoveClick = (deckId) => {
    onMove(card, deckId);
    onClose();
  };

  const handleCopyClick = (deckId) => {
    onCopy(card, deckId);
    onClose();
  };

  return (
    <AnimatePresence>
      <div 
        className="settings-overlay" 
        onClick={onClose}
        style={{ 
          display: 'flex', 
          alignItems: 'flex-end', 
          justifyContent: 'center',
          padding: 0
        }}
      >
        <motion.div 
          initial={{ opacity: 0, y: 100 }} 
          animate={{ opacity: 1, y: 0 }} 
          exit={{ opacity: 0, y: 100 }} 
          className="card-action-modal glass" 
          onClick={e => e.stopPropagation()}
          style={{ 
            width: '100%',
            maxWidth: '450px',
            borderRadius: '28px 28px 0 0',
            padding: '24px',
            paddingBottom: 'max(30px, env(safe-area-inset-bottom, 20px))',
            background: 'rgba(15, 23, 42, 0.95)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderBottom: 'none',
            boxShadow: '0 -10px 40px rgba(0,0,0,0.4)'
          }}
        >
          <div className="action-modal-drag-handle" style={{
            width: '40px',
            height: '4px',
            background: 'rgba(255, 255, 255, 0.2)',
            borderRadius: '2px',
            margin: '0 auto 20px'
          }} />

          <div className="settings-header" style={{ marginBottom: '20px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>
              {mode === 'main' ? 'Управление карточкой' : 
               mode === 'move' ? 'Переместить' : 'Копировать'}
            </h2>
            <button className="close-btn" onClick={onClose} style={{ background: 'rgba(255, 255, 255, 0.05)' }}>
              <X size={20} />
            </button>
          </div>
          
          <div className="settings-content">
            {mode === 'main' && (
              <div className="action-grid" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button 
                  className="action-menu-item" 
                  onClick={() => onToggleLearn(card)}
                >
                  <div className="action-menu-icon" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>
                    <Heart size={20} fill={card.want_to_learn ? "#ef4444" : "none"} />
                  </div>
                  <div className="action-menu-text">
                    <strong>{card.want_to_learn ? 'Убрать из изучения' : 'Хочу выучить'}</strong>
                    <span>Добавить в список приоритетных карточек</span>
                  </div>
                </button>
                
                <button 
                  className="action-menu-item" 
                  onClick={() => setMode('move')}
                >
                  <div className="action-menu-icon" style={{ background: 'rgba(99, 102, 241, 0.1)', color: '#818cf8' }}>
                    <Move size={20} />
                  </div>
                  <div className="action-menu-text">
                    <strong>Переместить</strong>
                    <span>Перенести в другую колоду</span>
                  </div>
                </button>
                
                <button 
                  className="action-menu-item" 
                  onClick={() => setMode('copy')}
                >
                  <div className="action-menu-icon" style={{ background: 'rgba(168, 85, 247, 0.1)', color: '#a855f7' }}>
                    <Copy size={20} />
                  </div>
                  <div className="action-menu-text">
                    <strong>Копировать</strong>
                    <span>Создать дубликат в другой колоде</span>
                  </div>
                </button>
                
                <button 
                  className="action-menu-item" 
                  onClick={() => { onShare(card); onClose(); }}
                >
                  <div className="action-menu-icon" style={{ background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
                  </div>
                  <div className="action-menu-text">
                    <strong>Поделиться</strong>
                    <span>Отправить ссылку в Telegram</span>
                  </div>
                </button>
                
                <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.05)', margin: '10px 0' }} />

                <button 
                  className="action-menu-item delete" 
                  onClick={() => { onDelete(card); onClose(); }}
                >
                  <div className="action-menu-icon" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>
                    <Trash2 size={20} />
                  </div>
                  <div className="action-menu-text">
                    <strong style={{ color: '#ef4444' }}>Удалить карточку</strong>
                    <span>Это действие нельзя отменить</span>
                  </div>
                </button>
              </div>
            )}

            {(mode === 'move' || mode === 'copy') && (
              <div className="deck-selector-list scrollable" style={{ maxHeight: '350px', overflowY: 'auto' }}>
                <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '15px' }}>
                  {mode === 'move' ? 'Выберите колоду для переноса:' : 'Выберите колоду для копирования:'}
                </p>
                {decks.map(d => (
                  <button 
                    key={d.id} 
                    className="deck-select-item"
                    onClick={() => mode === 'move' ? handleMoveClick(d.id) : handleCopyClick(d.id)}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
                      <strong style={{ fontSize: '1rem', color: 'white' }}>{d.name}</strong>
                      <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>{d.stats?.total || 0} карт</span>
                    </div>
                    {mode === 'move' ? <Move size={16} style={{ opacity: 0.3 }} /> : <Copy size={16} style={{ opacity: 0.3 }} />}
                  </button>
                ))}
                <button className="btn-secondary btn-full mt-2" onClick={() => setMode('main')} style={{ height: '50px', marginTop: '15px' }}>Назад</button>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
