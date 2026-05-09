import React, { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Layers, RefreshCw } from 'lucide-react';
import { useUiStore } from '../store/useUiStore';
import { useDeckStore } from '../store/useDeckStore';

export const DeckModals = () => {
  const { isNewDeckModalOpen, setIsNewDeckModalOpen, loading, setLoading, showToast } = useUiStore();
  const { externalDecks, createDeck, fetchExternalDecks, importDeck, handleFileUpload } = useDeckStore();

  const [deckModalMode, setDeckModalMode] = useState('choice');
  const [newDeckName, setNewDeckName] = useState('');
  const [isImportLoading, setIsImportLoading] = useState(false);
  const fileInputRef = useRef(null);

  if (!isNewDeckModalOpen) return null;

  const handleCreate = async () => {
    if (!newDeckName.trim()) return;
    setLoading(true);
    try {
      await createDeck(newDeckName);
      setIsNewDeckModalOpen(false);
      setDeckModalMode('choice');
      setNewDeckName('');
      showToast('Колода создана', 'success');
    } catch (err) {
      showToast('Ошибка при создании колоды');
    } finally {
      setLoading(false);
    }
  };

  const handleFetchExternal = async () => {
    setIsImportLoading(true);
    try {
      await fetchExternalDecks();
      setDeckModalMode('import');
    } catch (err) {
      showToast('Ошибка при загрузке колод');
    } finally {
      setIsImportLoading(false);
    }
  };

  const handleImport = async (id) => {
    setLoading(true);
    try {
      await importDeck(id);
      setIsNewDeckModalOpen(false);
      setDeckModalMode('choice');
      showToast('Колода импортирована', 'success');
    } catch (err) {
      showToast('Ошибка импорта');
    } finally {
      setLoading(false);
    }
  };

  const onFileChange = async (e) => {
    setLoading(true);
    try {
      await handleFileUpload(e, () => {
        setIsNewDeckModalOpen(false);
        setDeckModalMode('choice');
        showToast('JSON импортирован', 'success');
      });
    } catch (err) {
      showToast('Ошибка загрузки JSON');
    } finally {
      setLoading(false);
    }
  };

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
                <button className="btn-secondary btn-full choice-btn" onClick={handleFetchExternal} disabled={isImportLoading}>
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
                  onChange={onFileChange} 
                />
              </div>
            )}

            {deckModalMode === 'create' && (
              <>
                <div className="form-group">
                  <label>Название колоды</label>
                  <input autoFocus placeholder="Введите название..." value={newDeckName} onChange={e => setNewDeckName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreate()} />
                </div>
                <div className="modal-footer-actions">
                  <button className="btn btn-primary btn-full" onClick={handleCreate} disabled={loading}>Создать</button>
                  <button className="btn-secondary btn-full" onClick={() => setDeckModalMode('choice')}>Назад</button>
                </div>
              </>
            )}

            {deckModalMode === 'import' && (
              <div className="import-list scrollable">
                {externalDecks.length === 0 ? <p>Колоды не найдены</p> : 
                  externalDecks.map(d => (
                    <div key={d.id} className="import-item glass" onClick={() => handleImport(d.id)}>
                       <div className="import-item-info">
                          <div className="import-item-header">
                            {d.level && <span className="import-level">{d.level}</span>}
                            <strong>{d.name}</strong>
                          </div>
                          <div className="import-item-footer">
                            <span>{d.topic}</span>
                            {d.cards_count !== undefined && <span className="import-card-count">{d.cards_count} карт</span>}
                          </div>
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
