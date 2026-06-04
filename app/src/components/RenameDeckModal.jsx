import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useUiStore } from '../store/useUiStore';
import { useDeckStore } from '../store/useDeckStore';

export const RenameDeckModal = () => {
  const { isRenameModalOpen, setIsRenameModalOpen, deckToRename, showToast, loading, setLoading } = useUiStore();
  const { renameDeck, moveDeckToFolder, folders } = useDeckStore();
  
  const [deckName, setDeckName] = useState('');
  const [folderId, setFolderId] = useState(null);

  useEffect(() => {
    if (deckToRename) {
      setDeckName(deckToRename.name);
      setFolderId(deckToRename.folder_id || null);
    }
  }, [deckToRename]);

  if (!isRenameModalOpen || !deckToRename) return null;

  const handleSave = async () => {
    const trimmedName = deckName.trim();
    if (!trimmedName) {
      showToast('Название не может быть пустым');
      return;
    }

    setLoading(true);
    try {
      if (trimmedName !== deckToRename.name) {
        await renameDeck(deckToRename.id, trimmedName);
      }
      
      const oldFolderId = deckToRename.folder_id || null;
      if (folderId !== oldFolderId) {
        await moveDeckToFolder(deckToRename.id, folderId);
      }

      setIsRenameModalOpen(false);
      showToast('Настройки сохранены', 'success');
    } catch (err) {
      showToast('Ошибка при сохранении настроек');
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
            <h2>Настройки колоды</h2>
            <button 
              className="close-btn" 
              onClick={() => setIsRenameModalOpen(false)}
              disabled={loading}
            >
              <X size={24} />
            </button>
          </div>
          
          <div className="settings-content">
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label>Название колоды</label>
              <input 
                autoFocus 
                placeholder="Введите название..." 
                value={deckName} 
                onChange={e => setDeckName(e.target.value)} 
                onKeyDown={e => e.key === 'Enter' && handleSave()}
                disabled={loading}
              />
            </div>

            <div className="form-group" style={{ marginBottom: '20px' }}>
              <label>Папка</label>
              <select 
                value={folderId || ''} 
                onChange={e => setFolderId(e.target.value ? Number(e.target.value) : null)}
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  background: 'rgba(0, 0, 0, 0.2)',
                  color: 'white',
                  outline: 'none',
                  fontSize: '0.9rem'
                }}
              >
                <option value="">Без папки (Главный экран)</option>
                {folders.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
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
