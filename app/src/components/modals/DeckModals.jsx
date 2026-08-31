import React, { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Layers, RefreshCw, Folder, Star, CheckSquare, Square, Check, Copy, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import { useDeckStore } from '../../store/useDeckStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { SearchBar } from '../common/SearchBar';
import { matchesSearchQuery } from '../../utils/search';

export const DeckModals = () => {
  const { isNewDeckModalOpen, setIsNewDeckModalOpen, loading, setLoading, showToast, activeFolderId } = useUiStore();
  const {
    decks: userDecks,
    externalDecks,
    libraryCategories,
    createDeck,
    createFolder,
    fetchExternalDecks,
    fetchLibraryCategories,
    importDeck,
    importDecksBatch,
    toggleDefaultDeck
  } = useDeckStore();
  const { isAdmin } = useSettingsStore();

  const [deckModalMode, setDeckModalMode] = useState('choice');
  const [newDeckName, setNewDeckName] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [isImportLoading, setIsImportLoading] = useState(false);
  const [selectedDeckIds, setSelectedDeckIds] = useState([]);
  const [duplicateDeckTarget, setDuplicateDeckTarget] = useState(null); // { deck: externalDeck, mode: 'merge' }
  const [trashConflictTarget, setTrashConflictTarget] = useState(null); // { deckId, name, mode }
  const [librarySearchQuery, setLibrarySearchQuery] = useState('');

  const isDeckOwned = (extDeck) => {
    return (userDecks || []).some(ud => {
      if (ud.is_deleted) return false;
      let meta = {};
      try {
        meta = typeof ud.metadata === 'string' ? JSON.parse(ud.metadata || '{}') : (ud.metadata || {});
      } catch {
        meta = {};
      }
      if (meta.source_library_id && Number(meta.source_library_id) === Number(extDeck.id)) return true;
      return ud.name.trim().toLowerCase() === extDeck.name.trim().toLowerCase();
    });
  };

  const handleCreate = async () => {
    if (!newDeckName.trim()) return;
    setLoading(true);
    try {
      await createDeck(newDeckName.trim(), activeFolderId, null, 'standard');
      setIsNewDeckModalOpen(false);
      setDeckModalMode('choice');
      setNewDeckName('');
      showToast('Колода создана', 'success');
    } catch {
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
    } catch {
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
      setSelectedDeckIds([]);
      setLibrarySearchQuery('');
      setDeckModalMode('import');
    } catch {
      showToast('Ошибка при загрузке колод');
    } finally {
      setIsImportLoading(false);
    }
  };

  const handleImportSingle = async (deckId, mode = 'merge', forceTrash = false) => {
    setLoading(true);
    try {
      const res = await importDeck(deckId, mode, forceTrash);
      if (res?.status === 'in_trash') {
        setTrashConflictTarget({
          deckId,
          name: res.name || res.deck_name || 'Колода',
          mode
        });
        return;
      }
      setIsNewDeckModalOpen(false);
      setDeckModalMode('choice');
      setDuplicateDeckTarget(null);
      setTrashConflictTarget(null);
      showToast('Колода добавлена', 'success');
    } catch {
      showToast('Ошибка импорта');
    } finally {
      setLoading(false);
    }
  };

  const handleImportBatchAction = async () => {
    if (selectedDeckIds.length === 0) return;
    setLoading(true);
    try {
      await importDecksBatch(selectedDeckIds, 'merge');
      setIsNewDeckModalOpen(false);
      setDeckModalMode('choice');
      setSelectedDeckIds([]);
      showToast(`Импортировано колод: ${selectedDeckIds.length}`, 'success');
    } catch {
      showToast('Ошибка массового импорта');
    } finally {
      setLoading(false);
    }
  };

  const toggleDeckSelection = (deckId, e) => {
    e?.stopPropagation();
    setSelectedDeckIds(prev =>
      prev.includes(deckId) ? prev.filter(id => id !== deckId) : [...prev, deckId]
    );
  };

  const toggleCategorySelection = (categoryDecks, e) => {
    e?.stopPropagation();
    const categoryIds = categoryDecks.map(d => d.id);
    const allSelected = categoryIds.every(id => selectedDeckIds.includes(id));
    if (allSelected) {
      setSelectedDeckIds(prev => prev.filter(id => !categoryIds.includes(id)));
    } else {
      setSelectedDeckIds(prev => Array.from(new Set([...prev, ...categoryIds])));
    }
  };

  const getCategoryPath = useCallback((catId) => {
    const path = [];
    let curr = (libraryCategories || []).find(c => c.id === catId);
    while (curr) {
      path.unshift(curr.name);
      curr = (libraryCategories || []).find(c => c.id === curr.parent_id);
    }
    return path.join(' ➔ ');
  }, [libraryCategories]);

  // Filter external decks by search query
  const filteredExternalDecks = useMemo(() => {
    if (!librarySearchQuery.trim()) return externalDecks || [];
    return (externalDecks || []).filter(d => {
      const categoryPath = d.category_id ? getCategoryPath(d.category_id) : '';
      return (
        matchesSearchQuery(d.name, librarySearchQuery) ||
        matchesSearchQuery(d.topic, librarySearchQuery) ||
        matchesSearchQuery(d.level, librarySearchQuery) ||
        matchesSearchQuery(categoryPath, librarySearchQuery) ||
        matchesSearchQuery(d.description, librarySearchQuery)
      );
    });
  }, [externalDecks, librarySearchQuery, getCategoryPath]);

  // Group external decks by category path
  const groupedExternalDecks = useMemo(() => {
    const groups = {};
    filteredExternalDecks.forEach(d => {
      let path = 'Разное (Без категории)';
      if (d.category_id) {
        const p = getCategoryPath(d.category_id);
        if (p) path = p;
      }
      if (!groups[path]) groups[path] = [];
      groups[path].push(d);
    });
    return groups;
  }, [filteredExternalDecks, getCategoryPath]);

  const resetAndClose = () => {
    setIsNewDeckModalOpen(false);
    setDeckModalMode('choice');
    setNewDeckName('');
    setNewFolderName('');
    setSelectedDeckIds([]);
    setDuplicateDeckTarget(null);
    setTrashConflictTarget(null);
    setLibrarySearchQuery('');
  };

  if (!isNewDeckModalOpen) return null;

  return (
    <AnimatePresence>
      <div className="settings-overlay" onClick={resetAndClose}>
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }} 
          animate={{ opacity: 1, scale: 1 }} 
          exit={{ opacity: 0, scale: 0.9 }} 
          className="settings-modal" 
          style={{ 
            maxWidth: 460, 
            width: '100%', 
            maxHeight: 'calc(100dvh - 32px)', 
            display: 'flex', 
            flexDirection: 'column', 
            overflow: 'hidden', 
            padding: '20px', 
            margin: 'auto', 
            boxSizing: 'border-box' 
          }}
          onClick={e => e.stopPropagation()}
        >
          <div className="settings-header" style={{ marginBottom: 16, flexShrink: 0 }}>
            <h2>
              {deckModalMode === 'choice' ? 'Добавить элемент' : 
               deckModalMode === 'create' ? 'Новая колода' : 
               deckModalMode === 'create_folder' ? 'Новая папка' : 'Импорт из Lerne'}
            </h2>
            <button className="close-btn" onClick={resetAndClose}><X size={24} /></button>
          </div>
          
          <div className="settings-content scrollable" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {deckModalMode === 'choice' && (
              <div className="choice-grid">
                <button className="btn btn-primary btn-full choice-btn" onClick={() => {
                  if (useUiStore.getState().userProfile?.is_guest) {
                    setIsNewDeckModalOpen(false);
                    useUiStore.getState().setIsAuthModalOpen(true, "Для создания колод войдите через Telegram");
                    return;
                  }
                  setDeckModalMode('create');
                }}>
                  <Plus size={20} /> Создать колоду
                </button>
                <button className="btn btn-primary btn-full choice-btn" onClick={() => {
                  if (useUiStore.getState().userProfile?.is_guest) {
                    setIsNewDeckModalOpen(false);
                    useUiStore.getState().setIsAuthModalOpen(true, "Для создания папок войдите через Telegram");
                    return;
                  }
                  setDeckModalMode('create_folder');
                }} style={{ background: '#4f46e5' }}>
                  <Folder size={20} /> Создать папку
                </button>
                <button className="btn-secondary btn-full choice-btn" onClick={handleFetchExternal} disabled={isImportLoading}>
                  {isImportLoading ? <RefreshCw size={20} className="spin" /> : <Layers size={20} />} 
                  {isImportLoading ? ' Загрузка...' : ' Из Библиотеки'}
                </button>
              </div>
            )}

            {deckModalMode === 'create' && (
              <>
                <div className="form-group">
                  <label>Название колоды</label>
                  <input autoFocus placeholder="Введите название..." value={newDeckName} onChange={e => setNewDeckName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreate()} />
                </div>

                <div className="modal-footer-actions" style={{ marginTop: '16px' }}>
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
              <>
                <div style={{ marginBottom: '12px', flexShrink: 0 }}>
                  <SearchBar
                    value={librarySearchQuery}
                    onChange={setLibrarySearchQuery}
                    onClear={() => setLibrarySearchQuery('')}
                    placeholder="Поиск по библиотеке колод..."
                    color="purple"
                    count={filteredExternalDecks.length}
                    total={externalDecks?.length || 0}
                  />
                </div>

                <div className="import-list scrollable">
                  {(externalDecks || []).length === 0 ? (
                    <p style={{ textAlign: 'center', color: '#9ca3af', padding: '24px 0' }}>Колоды не найдены</p>
                  ) : filteredExternalDecks.length === 0 ? (
                    <div className="search-empty-state glass" style={{ margin: '16px 0', padding: '24px 16px' }}>
                      <Search size={28} opacity={0.4} color="#a855f7" />
                      <h3>Ничего не найдено</h3>
                      <p>По запросу «{librarySearchQuery}» колод в библиотеке не нашлось</p>
                      <button 
                        type="button" 
                        className="btn btn-secondary" 
                        style={{ padding: '6px 14px', fontSize: '0.82rem', marginTop: '4px' }}
                        onClick={() => setLibrarySearchQuery('')}
                      >
                        Сбросить поиск
                      </button>
                    </div>
                  ) : (
                    Object.entries(groupedExternalDecks).map(([categoryName, categoryDecks]) => {
                    const categoryIds = categoryDecks.map(d => d.id);
                    const isAllCatSelected = categoryIds.every(id => selectedDeckIds.includes(id));

                    return (
                      <div key={categoryName} style={{ marginBottom: '16px', width: '100%' }}>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          borderBottom: '1px solid rgba(139, 92, 246, 0.2)',
                          paddingBottom: '4px',
                          marginBottom: '8px'
                        }}>
                          <span style={{
                            fontSize: '0.75rem',
                            textTransform: 'uppercase',
                            color: '#a78bfa',
                            fontWeight: 700,
                            letterSpacing: '0.05em'
                          }}>
                            📁 {categoryName}
                          </span>

                          <button
                            type="button"
                            onClick={(e) => toggleCategorySelection(categoryDecks, e)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: isAllCatSelected ? '#38bdf8' : '#9ca3af',
                              fontSize: '0.75rem',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '2px 4px'
                            }}
                          >
                            {isAllCatSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                            <span>{isAllCatSelected ? 'Снять выбор' : 'Выбрать все'}</span>
                          </button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {categoryDecks.map(d => {
                            const owned = isDeckOwned(d);
                            const isSelected = selectedDeckIds.includes(d.id);

                            return (
                              <div
                                key={d.id}
                                className={`import-item glass ${isSelected ? 'selected' : ''}`}
                                style={{
                                  borderColor: isSelected ? '#a855f7' : undefined,
                                  background: isSelected ? 'rgba(168, 85, 247, 0.12)' : undefined,
                                  cursor: 'pointer'
                                }}
                                onClick={() => {
                                  if (owned) {
                                    setDuplicateDeckTarget({ deck: d, mode: 'merge' });
                                  } else {
                                    toggleDeckSelection(d.id);
                                  }
                                }}
                              >
                                <div
                                  style={{ padding: '4px', display: 'flex', alignItems: 'center', color: isSelected ? '#a855f7' : '#6b7280' }}
                                  onClick={(e) => toggleDeckSelection(d.id, e)}
                                  title="Выбрать для пакетного импорта"
                                >
                                  {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                                </div>

                                <div className="import-item-info" style={{ flex: 1 }}>
                                  <div className="import-item-header" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    {d.level && <span className="import-level">{d.level}</span>}
                                    <strong>{d.name}</strong>
                                    {owned && (
                                      <span style={{
                                        background: 'rgba(34, 197, 94, 0.2)',
                                        color: '#4ade80',
                                        fontSize: '0.65rem',
                                        padding: '1px 6px',
                                        borderRadius: '4px',
                                        border: '1px solid rgba(34, 197, 94, 0.4)',
                                        fontWeight: 600,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '2px'
                                      }}>
                                        <Check size={10} /> Уже у вас
                                      </span>
                                    )}
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
                                      if (owned) {
                                        setDuplicateDeckTarget({ deck: d, mode: 'merge' });
                                      } else {
                                        handleImportSingle(d.id, 'merge');
                                      }
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
                                    title={owned ? "Параметры импорта" : "Импортировать колоду"}
                                  >
                                    <Plus size={16} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                )}

                <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {selectedDeckIds.length > 0 && (
                    <button
                      className="btn btn-primary btn-full"
                      onClick={handleImportBatchAction}
                      disabled={loading}
                      style={{ background: 'linear-gradient(135deg, #a855f7, #6366f1)' }}
                    >
                      {loading ? <RefreshCw size={18} className="spin" /> : <Plus size={18} />}
                      Импортировать выбранные ({selectedDeckIds.length})
                    </button>
                  )}
                  <button className="btn-secondary btn-full" onClick={() => {
                    setLibrarySearchQuery('');
                    setDeckModalMode('choice');
                  }}>
                    Назад
                  </button>
                </div>
              </div>
              </>
            )}
          </div>
        </motion.div>

        {/* Modal Prompt for Duplicate Decks */}
        {duplicateDeckTarget && (
          <div
            className="settings-overlay"
            style={{ zIndex: 1100, background: 'rgba(0, 0, 0, 0.6)' }}
            onClick={() => setDuplicateDeckTarget(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="settings-modal glass"
              style={{ maxWidth: 400, width: '90%', padding: '20px', margin: 'auto' }}
              onClick={e => e.stopPropagation()}
            >
              <h3 style={{ marginTop: 0, marginBottom: '8px', fontSize: '1.1rem' }}>
                Колода уже есть у вас
              </h3>
              <p style={{ fontSize: '0.85rem', color: '#9ca3af', marginBottom: '16px' }}>
                Колода <strong>«{duplicateDeckTarget.deck?.name}»</strong> уже содержится в вашей коллекции. Выберите действие:
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
                <button
                  type="button"
                  className={`btn-secondary ${duplicateDeckTarget.mode === 'merge' ? 'active' : ''}`}
                  onClick={() => setDuplicateDeckTarget(prev => ({ ...prev, mode: 'merge' }))}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    textAlign: 'left',
                    padding: '10px',
                    borderColor: duplicateDeckTarget.mode === 'merge' ? '#a855f7' : undefined,
                    background: duplicateDeckTarget.mode === 'merge' ? 'rgba(168, 85, 247, 0.15)' : undefined
                  }}
                >
                  <RefreshCw size={18} style={{ color: '#a855f7', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Обновить (Merge)</div>
                    <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Добавить новые карточки, сохранив прогресс</div>
                  </div>
                </button>

                <button
                  type="button"
                  className={`btn-secondary ${duplicateDeckTarget.mode === 'copy' ? 'active' : ''}`}
                  onClick={() => setDuplicateDeckTarget(prev => ({ ...prev, mode: 'copy' }))}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    textAlign: 'left',
                    padding: '10px',
                    borderColor: duplicateDeckTarget.mode === 'copy' ? '#38bdf8' : undefined,
                    background: duplicateDeckTarget.mode === 'copy' ? 'rgba(56, 189, 248, 0.15)' : undefined
                  }}
                >
                  <Copy size={18} style={{ color: '#38bdf8', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Создать копию (Copy)</div>
                    <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Импортировать как «{duplicateDeckTarget.deck?.name} (v2)»</div>
                  </div>
                </button>

                <button
                  type="button"
                  className={`btn-secondary ${duplicateDeckTarget.mode === 'replace' ? 'active' : ''}`}
                  onClick={() => setDuplicateDeckTarget(prev => ({ ...prev, mode: 'replace' }))}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    textAlign: 'left',
                    padding: '10px',
                    borderColor: duplicateDeckTarget.mode === 'replace' ? '#ef4444' : undefined,
                    background: duplicateDeckTarget.mode === 'replace' ? 'rgba(239, 68, 68, 0.15)' : undefined
                  }}
                >
                  <RotateCcw size={18} style={{ color: '#ef4444', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Перезаписать (Replace)</div>
                    <div style={{ fontSize: '0.75rem', color: '#ef4444' }}>Сбросить и заменить все карточки на библиотечные</div>
                  </div>
                </button>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="btn btn-primary btn-full"
                  onClick={() => handleImportSingle(duplicateDeckTarget.deck.id, duplicateDeckTarget.mode)}
                  disabled={loading}
                >
                  Выполнить
                </button>
                <button
                  className="btn-secondary btn-full"
                  onClick={() => setDuplicateDeckTarget(null)}
                >
                  Отмена
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Modal Prompt for Trash Conflict */}
        {trashConflictTarget && (
          <div
            className="settings-overlay"
            style={{ zIndex: 1200, background: 'rgba(0, 0, 0, 0.65)' }}
            onClick={() => setTrashConflictTarget(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="settings-modal glass"
              style={{ maxWidth: 400, width: '90%', padding: '24px', margin: 'auto' }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', color: '#f59e0b' }}>
                <Trash2 size={24} style={{ flexShrink: 0 }} />
                <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#f8fafc' }}>
                  Колода в корзине
                </h3>
              </div>

              <p style={{ fontSize: '0.9rem', color: '#cbd5e1', lineHeight: 1.5, marginBottom: '20px' }}>
                У вас такая колода (<strong>«{trashConflictTarget.name}»</strong>) уже есть в корзине. Колода из корзины будет удалена.
              </p>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  className="btn btn-primary btn-full"
                  onClick={() => handleImportSingle(trashConflictTarget.deckId, trashConflictTarget.mode, true)}
                  disabled={loading}
                  style={{ background: 'linear-gradient(135deg, #a855f7, #6366f1)' }}
                >
                  ОК
                </button>
                <button
                  className="btn-secondary btn-full"
                  onClick={() => setTrashConflictTarget(null)}
                >
                  Отмена
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    </AnimatePresence>
  );
};
