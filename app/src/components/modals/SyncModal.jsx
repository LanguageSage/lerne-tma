import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, RefreshCw, Copy, Trash2, AlertTriangle } from 'lucide-react';

export const SyncModal = ({
  isOpen,
  onClose,
  deck,
  onSync,
  loading
}) => {
  if (!isOpen || !deck) return null;

  return (
    <AnimatePresence>
      <div className="settings-overlay" onClick={onClose}>
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }} 
          animate={{ opacity: 1, scale: 1 }} 
          exit={{ opacity: 0, scale: 0.9 }} 
          className="settings-modal" 
          onClick={e => e.stopPropagation()}
        >
          <div className="settings-header">
            <h2>Обновление колоды</h2>
            <button className="close-btn" onClick={onClose} disabled={loading}>
              <X size={24} />
            </button>
          </div>
          
          <div className="settings-content">
            <p style={{ marginBottom: '20px' }}>
              Колода <strong>{deck.name}</strong> может быть обновлена из библиотеки. Выберите, как вы хотите поступить:
            </p>

            <div className="choice-grid">
              <button 
                className="btn btn-primary btn-full choice-btn" 
                onClick={() => onSync('merge')}
                disabled={loading}
                style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', height: 'auto', padding: '15px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                  <RefreshCw size={20} style={{ marginRight: '10px' }} /> 
                  <strong style={{ fontSize: '16px' }}>Умное обновление (Merge)</strong>
                </div>
                <span style={{ fontSize: '12px', opacity: 0.9, fontWeight: 'normal' }}>
                  Добавит новые карточки и обновит текст/картинки в существующих. Ваш прогресс обучения будет сохранен.
                </span>
              </button>

              <button 
                className="btn-secondary btn-full choice-btn" 
                onClick={() => onSync('copy')}
                disabled={loading}
                style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', height: 'auto', padding: '15px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                  <Copy size={20} style={{ marginRight: '10px' }} /> 
                  <strong style={{ fontSize: '16px' }}>Скачать как копию</strong>
                </div>
                <span style={{ fontSize: '12px', opacity: 0.7, fontWeight: 'normal' }}>
                  Создаст новую колоду (копию из библиотеки), чтобы вы могли сравнить. Текущая колода останется без изменений.
                </span>
              </button>

              <button 
                className="btn-secondary btn-full choice-btn" 
                onClick={() => {
                  if (window.confirm("ВНИМАНИЕ! Это действие удалит все карточки в этой колоде и весь ваш прогресс обучения по ним. Вы абсолютно уверены?")) {
                    onSync('replace');
                  }
                }}
                disabled={loading}
                style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', height: 'auto', padding: '15px', border: '1px solid #ef444455' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', color: '#ef4444' }}>
                  <AlertTriangle size={20} style={{ marginRight: '10px' }} /> 
                  <strong style={{ fontSize: '16px' }}>Полная замена (Replace)</strong>
                </div>
                <span style={{ fontSize: '12px', opacity: 0.7, fontWeight: 'normal' }}>
                  Удалит локальную колоду и заново скачает её из базы. Прогресс обучения будет сброшен.
                </span>
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
