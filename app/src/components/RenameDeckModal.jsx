import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useUiStore } from '../store/useUiStore';
import { useDeckStore } from '../store/useDeckStore';

export const RenameDeckModal = () => {
  const { isRenameModalOpen, setIsRenameModalOpen, deckToRename, showToast, loading, setLoading } = useUiStore();
  const { renameDeck } = useDeckStore();
  
  const [deckName, setDeckName] = useState('');

  useEffect(() => {
    if (deckToRename) {
      setDeckName(deckToRename.name);
    }
  }, [deckToRename]);

  if (!isRenameModalOpen || !deckToRename) return null;

  const handleSave = async () => {
    const trimmedName = deckName.trim();
    if (!trimmedName) {
      showToast('Название не может быть пустым');
      return;
    }
    if (trimmedName === deckToRename.name) {
      setIsRenameModalOpen(false);
      return;
    }

    setLoading(true);
    try {
      await renameDeck(deckToRename.id, trimmedName);
      setIsRenameModalOpen(false);
      showToast('Колода переименована', 'success');
    } catch (err) {
      showToast('Ошибка при переименовании колоды');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <div 
        className="settings-overlay" 
        onClick={() => setIsRenameModalOpen(false)}
      >
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }} 
          animate={{ opacity: 1, scale: 1 }} 
          exit={{ opacity: 0, scale: 0.9 }} 
          className="settings-modal" 
          onClick={e => e.stopPropagation()}
        >
          <div className="settings-header">
            <h2>Переименовать колоду</h2>
            <button 
              className="close-btn" 
              onClick={() => setIsRenameModalOpen(false)}
              disabled={loading}
            >
              <X size={24} />
            </button>
          </div>
          
          <div className="settings-content">
            <div className="form-group" style={{ marginBottom: '20px' }}>
              <label>Новое название</label>
              <input 
                autoFocus 
                placeholder="Введите название..." 
                value={deckName} 
                onChange={e => setDeckName(e.target.value)} 
                onKeyDown={e => e.key === 'Enter' && handleSave()}
                disabled={loading}
              />
            </div>
            <div className="modal-footer-actions">
              <button 
                className="btn btn-primary btn-full" 
                onClick={handleSave} 
                disabled={loading}
              >
                Сохранить
              </button>
              <button 
                className="btn-secondary btn-full" 
                onClick={() => setIsRenameModalOpen(false)}
                disabled={loading}
              >
                Отмена
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
