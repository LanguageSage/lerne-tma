import React, { useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Layers, RefreshCw } from 'lucide-react';

export const DeckModals = ({
  isNewDeckModalOpen,
  setIsNewDeckModalOpen,
  deckModalMode,
  setDeckModalMode,
  newDeckName,
  setNewDeckName,
  createDeck,
  loading,
  fetchExternalDecks,
  isImportLoading,
  handleFileUpload,
  externalDecks,
  importDeck
}) => {
  const fileInputRef = useRef(null);

  if (!isNewDeckModalOpen) return null;

  return (
    <AnimatePresence>
      <div className="settings-overlay" onClick={() => { setIsNewDeckModalOpen(false); setDeckModalMode('choice'); }}>
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="settings-modal" onClick={e => e.stopPropagation()}>
          <div className="settings-header">
            <h2>
              {deckModalMode === 'choice' ? 'Добавить колоду' : 
               deckModalMode === 'create' ? 'Новая колода' : 'Импорт из Lerne'}
            </h2>
            <button className="close-btn" onClick={() => { setIsNewDeckModalOpen(false); setDeckModalMode('choice'); setNewDeckName(''); }}><X size={24} /></button>
          </div>
          
          <div className="settings-content">
            {deckModalMode === 'choice' && (
              <div className="choice-grid">
                <button className="btn btn-primary btn-full choice-btn" onClick={() => setDeckModalMode('create')}>
                  <Plus size={20} /> Создать пустую
                </button>
                <button className="btn-secondary btn-full choice-btn" onClick={fetchExternalDecks} disabled={isImportLoading}>
                  {isImportLoading ? <RefreshCw size={20} className="spin" /> : <Layers size={20} />} 
                  {isImportLoading ? ' Загрузка...' : ' Из Библиотеки'}
                </button>
                <button className="btn-secondary btn-full choice-btn" onClick={() => fileInputRef.current?.click()}>
                  <Plus size={20} style={{ transform: 'rotate(45deg)' }} /> Загрузить JSON
                </button>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  style={{ display: 'none' }} 
                  accept=".json" 
                  onChange={handleFileUpload} 
                />
              </div>
            )}

            {deckModalMode === 'create' && (
              <>
                <div className="form-group">
                  <label>Название колоды</label>
                  <input autoFocus placeholder="Введите название..." value={newDeckName} onChange={e => setNewDeckName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createDeck()} />
                </div>
                <div className="modal-footer-actions">
                  <button className="btn btn-primary btn-full" onClick={createDeck} disabled={loading}>Создать</button>
                  <button className="btn-secondary btn-full" onClick={() => setDeckModalMode('choice')}>Назад</button>
                </div>
              </>
            )}

            {deckModalMode === 'import' && (
              <div className="import-list scrollable">
                {externalDecks.length === 0 ? <p>Колоды не найдены</p> : 
                  externalDecks.map(d => (
                    <div key={d.id} className="import-item glass" onClick={() => importDeck(d.id)}>
                       <div className="import-item-info">
                          <strong>{d.name}</strong>
                          <span>{d.topic}</span>
                       </div>
                       <Plus size={16} />
                    </div>
                  ))
                }
                <button className="btn-secondary btn-full mt-2" onClick={() => setDeckModalMode('choice')}>Назад</button>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
