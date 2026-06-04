import React, { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Layers, RefreshCw, Folder, Star } from 'lucide-react';
import { useUiStore } from '../store/useUiStore';
import { useDeckStore } from '../store/useDeckStore';
import { useSettingsStore } from '../store/useSettingsStore';

export const DeckModals = () => {
  const { isNewDeckModalOpen, setIsNewDeckModalOpen, loading, setLoading, showToast, activeFolderId } = useUiStore();
  const { externalDecks, libraryCategories, createDeck, createFolder, fetchExternalDecks, fetchLibraryCategories, importDeck, toggleDefaultDeck, handleFileUpload } = useDeckStore();
  const { isAdmin } = useSettingsStore();

  const [deckModalMode, setDeckModalMode] = useState('choice');
  const [newDeckName, setNewDeckName] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [isImportLoading, setIsImportLoading] = useState(false);
  const fileInputRef = useRef(null);

  if (!isNewDeckModalOpen) return null;

  const handleCreate = async () => {
    if (!newDeckName.trim()) return;
    setLoading(true);
    try {
      await createDeck(newDeckName.trim(), activeFolderId);
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

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    setLoading(true);
    try {
      await createFolder(newFolderName.trim(), activeFolderId);
      setIsNewDeckModalOpen(false);
      setDeckModalMode('choice');
      setNewFolderName('');
      showToast('Папка создана', 'success');
    } catch (err) {
      showToast('Ошибка при создании папки');
    } finally {
      setLoading(false);
    }
  };

  const handleFetchExternal = async () => {
    setIsImportLoading(true);
    try {
      await fetchExternalDecks();
      await fetchLibraryCategories();
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

  const getCategoryPath = (catId) => {
    const path = [];
    let curr = libraryCategories.find(c => c.id === catId);
    while (curr) {
      path.unshift(curr.name);
      curr = libraryCategories.find(c => c.id === curr.parent_id);
    }
    return path.join(' ➔ ');
  };

  // Group external decks by category path
  const groupedExternalDecks = (() => {
    const groups = {};
    externalDecks.forEach(d => {
      let path = 'Разное (Без категории)';
      if (d.category_id) {
        const p = getCategoryPath(d.category_id);
        if (p) path = p;
      }
      if (!groups[path]) groups[path] = [];
      groups[path].push(d);
    });
    return groups;
  })();

  const resetAndClose = () => {
    setIsNewDeckModalOpen(false);
    setDeckModalMode('choice');
    setNewDeckName('');
    setNewFolderName('');
  };

  return (
    <AnimatePresence>
      <div className="settings-overlay" onClick={resetAndClose}>
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="settings-modal" onClick={e => e.stopPropagation()}>
          <div className="settings-header">
            <h2>
              {deckModalMode === 'choice' ? 'Добавить элемент' : 
               deckModalMode === 'create' ? 'Новая колода' : 
               deckModalMode === 'create_folder' ? 'Новая папка' : 'Импорт из Lerne'}
            </h2>
            <button className="close-btn" onClick={resetAndClose}><X size={24} /></button>
          </div>
          
          <div className="settings-content">
            {deckModalMode === 'choice' && (
              <div className="choice-grid">
                <button className="btn btn-primary btn-full choice-btn" onClick={() => setDeckModalMode('create')}>
                  <Plus size={20} /> Создать колоду
                </button>
                <button className="btn btn-primary btn-full choice-btn" onClick={() => setDeckModalMode('create_folder')} style={{ background: '#4f46e5' }}>
                  <Folder size={20} /> Создать папку
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

            {deckModalMode === 'create_folder' && (
              <>
                <div className="form-group">
                  <label>Название папки</label>
                  <input autoFocus placeholder="Введите название..." value={newFolderName} onChange={e => setNewFolderName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreateFolder()} />
                </div>
                <div className="modal-footer-actions">
                  <button className="btn btn-primary btn-full" onClick={handleCreateFolder} disabled={loading}>Создать</button>
                  <button className="btn-secondary btn-full" onClick={() => setDeckModalMode('choice')}>Назад</button>
                </div>
              </>
            )}

            {deckModalMode === 'import' && (
              <div className="import-list scrollable">
                {externalDecks.length === 0 ? <p>Колоды не найдены</p> : 
                  Object.entries(groupedExternalDecks).map(([categoryName, decks]) => (
                    <div key={categoryName} style={{ marginBottom: '16px', width: '100%' }}>
                      <div style={{
                        fontSize: '0.75rem',
                        textTransform: 'uppercase',
                        color: '#a78bfa',
                        fontWeight: 700,
                        borderBottom: '1px solid rgba(139, 92, 246, 0.2)',
                        paddingBottom: '4px',
                        marginBottom: '8px',
                        letterSpacing: '0.05em',
                        textAlign: 'left'
                      }}>
                        📁 {categoryName}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {decks.map(d => (
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
                             <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }} onClick={(e) => e.stopPropagation()}>
                               {isAdmin ? (
                                 <button
                                   onClick={(e) => {
                                     e.stopPropagation();
                                     toggleDefaultDeck(d.id);
                                   }}
                                   style={{
                                     background: 'none',
                                     border: 'none',
                                     cursor: 'pointer',
                                     padding: '4px',
                                     display: 'flex',
                                     alignItems: 'center',
                                     justifyContent: 'center',
                                     color: d.is_default ? '#f59e0b' : '#6b7280',
                                     transition: 'transform 0.2s, color 0.2s',
                                   }}
                                   onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.2)'}
                                   onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                                   title={d.is_default ? "Сделать обычной" : "Сделать по умолчанию"}
                                 >
                                   <Star size={20} fill={d.is_default ? "#f59e0b" : "none"} />
                                 </button>
                               ) : (
                                 d.is_default && (
                                   <div 
                                     style={{ 
                                       color: '#f59e0b', 
                                       display: 'flex', 
                                       alignItems: 'center', 
                                       padding: '4px' 
                                     }}
                                     title="Колода по умолчанию"
                                   >
                                     <Star size={20} fill="#f59e0b" />
                                   </div>
                                 )
                               )}
                               <button
                                 onClick={(e) => {
                                   e.stopPropagation();
                                   handleImport(d.id);
                                 }}
                                 style={{
                                   background: 'none',
                                   border: 'none',
                                   cursor: 'pointer',
                                   padding: '4px',
                                   display: 'flex',
                                   alignItems: 'center',
                                   justifyContent: 'center',
                                   color: 'inherit'
                                 }}
                               >
                                 <Plus size={16} />
                               </button>
                             </div>
                          </div>
                        ))}
                      </div>
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
