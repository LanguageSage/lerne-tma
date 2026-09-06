import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  DndContext,
  closestCenter,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragOverlay
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { Layers, RefreshCw, Copy, Trash2, FolderOpen, ChevronRight, Wrench, ChevronDown, Search } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import { useDeckStore } from '../../store/useDeckStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { useTranslation } from '../../i18n/i18nContext';
import { ImportModal } from '../modals/ImportModal';
import { DeckGridHeader } from './DeckGridHeader';
import { DeckCardItem } from './DeckCardItem';
import { FolderCardItem } from './FolderTreeNav';
import { useCollaborativePresence } from '../../hooks/useCollaborativePresence';
import { CollaboratorPresenceBar } from '../collaborative/CollaboratorPresenceBar';
import { SearchBar } from '../common/SearchBar';
import { LearningShortcutsBar } from './LearningShortcutsBar';
import { matchFolder, matchDeck } from '../../utils/search';
import { isLidUser, isLidRootFolder, ensureLidStructureForUser } from '../../services/lidFolderManager';
import { LidExamCardItem } from '../lid/LidExamCardItem';
import { navigateUp } from '../../utils/navigation';

export const DeckGrid = ({ 
  startTutorial, 
  openSyncModal
}) => {
  useInterfaceLocale();
  const { t } = useTranslation();
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [deckSearchQuery, setDeckSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const { 
    view, loading, hasInitialized, setIsNewDeckModalOpen, setIsSettingsOpen, 
    showToast, setIsRenameModalOpen, setDeckToRename, 
    activeFolderId, setActiveFolderId 
  } = useUiStore();

  const { 
    decks, folders, setCurrentDeck, fetchDeckCards, 
    handleSyncDeck, handleResetProgress, handleDeleteDeck, 
    setDeckCards, togglePinDeck,
    duplicateCards, isFetchingDecks
  } = useDeckStore();

  const activeLanguage = useLanguageStore(state => state.activeLanguage);
  const langInfo = useLanguageStore(state => state.getLanguageInfo());

  const [deckFilter, setDeckFilter] = useState('all'); // 'all' | 'learning'

  const { collaborators, onlineCount, isShared } = useCollaborativePresence('folder', activeFolderId, view === 'decks' && activeFolderId !== null);

  // Auto-provision Leben in Deutschland folder and 16 empty decks for aruna27
  React.useEffect(() => {
    if (hasInitialized && isLidUser()) {
      ensureLidStructureForUser();
    }
  }, [hasInitialized]);

  const currentFolders = React.useMemo(() => {
    return folders ? folders.filter(f => {
      if (f.parent_id !== activeFolderId) return false;
      if (activeFolderId !== null) return true;
      return (f.target_language || 'de') === activeLanguage;
    }) : [];
  }, [folders, activeFolderId, activeLanguage]);

  const currentDecks = React.useMemo(() => {
    return decks ? decks.filter(d => {
      if (d.folder_id !== activeFolderId) return false;
      if (activeFolderId !== null) return true;
      return (d.target_language || 'de') === activeLanguage;
    }) : [];
  }, [decks, activeFolderId, activeLanguage]);

  const allActiveLearningDecks = React.useMemo(() => {
    if (!decks) return [];
    return decks.filter(d => (d.target_language || 'de') === activeLanguage && Boolean(d.is_learning) && !d.is_inbox && !d.is_deleted);
  }, [decks, activeLanguage]);

  const learningCount = React.useMemo(() => {
    return currentDecks.filter(d => Boolean(d.is_learning)).length;
  }, [currentDecks]);

  const filteredFolders = React.useMemo(() => {
    if (!deckSearchQuery.trim()) return currentFolders;
    return currentFolders.filter(f => matchFolder(f, deckSearchQuery));
  }, [currentFolders, deckSearchQuery]);

  const filteredDecks = React.useMemo(() => {
    let list = currentDecks;
    if (deckFilter === 'learning') {
      list = list.filter(d => Boolean(d.is_learning));
    }
    if (!deckSearchQuery.trim()) return list;
    return list.filter(d => matchDeck(d, deckSearchQuery));
  }, [currentDecks, deckFilter, deckSearchQuery]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 120,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const [activeFolderDragId, setActiveFolderDragId] = useState(null);
  const [activeDeckDragId, setActiveDeckDragId] = useState(null);

  const handleFolderDragEnd = (event) => {
    const { active, over } = event;
    setActiveFolderDragId(null);
    if (over && active.id !== over.id) {
      const oldIndex = filteredFolders.findIndex(f => f.id === active.id);
      const newIndex = filteredFolders.findIndex(f => f.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(filteredFolders, oldIndex, newIndex);
        const orderedIds = newOrder.map(f => f.id);
        useDeckStore.getState().reorderFolders(orderedIds);
      }
    }
  };

  const handleDeckDragEnd = (event) => {
    const { active, over } = event;
    setActiveDeckDragId(null);
    if (over && active.id !== over.id) {
      const oldIndex = filteredDecks.findIndex(d => d.id === active.id);
      const newIndex = filteredDecks.findIndex(d => d.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(filteredDecks, oldIndex, newIndex);
        const orderedIds = newOrder.map(d => d.id);
        useDeckStore.getState().reorderDecks(orderedIds);
      }
    }
  };

  const customCollisionDetection = React.useCallback((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }
    return closestCenter(args);
  }, []);

  const activeDeck = React.useMemo(() => {
    if (!activeDeckDragId) return null;
    return filteredDecks.find(d => d.id === activeDeckDragId);
  }, [activeDeckDragId, filteredDecks]);

  const activeFolderItem = React.useMemo(() => {
    if (!activeFolderDragId) return null;
    return filteredFolders.find(f => f.id === activeFolderDragId);
  }, [activeFolderDragId, filteredFolders]);

  if (view !== 'decks') return null;

  const getBreadcrumbs = () => {
    const trail = [];
    let currentId = activeFolderId;
    while (currentId !== null && folders) {
      const folder = folders.find(f => f.id === currentId);
      if (!folder) break;
      trail.unshift(folder);
      currentId = folder.parent_id;
    }
    return trail;
  };

  const activeFolder = folders?.find(f => f.id === activeFolderId);
  const activeFolderColor = activeFolder ? (activeFolder.color || '#ffd043') : null;
  const isInitialLoading = !hasInitialized || loading || (isFetchingDecks && currentFolders.length === 0 && currentDecks.length === 0);
  const isFolderEmpty = !isInitialLoading && !isFetchingDecks && currentFolders.length === 0 && currentDecks.length === 0;

  return (
    <div className="view-decks">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="view"
      >
        <DeckGridHeader
          startTutorial={startTutorial}
          setIsNewDeckModalOpen={setIsNewDeckModalOpen}
          setIsSettingsOpen={setIsSettingsOpen}
          onLanguageChange={() => {
            showToast(tr("Язык изменен на {{p0}}", { p0: useLanguageStore.getState().getLanguageInfo().name }), 'info');
          }}
          activeFolderId={activeFolderId}
          onFolderBack={navigateUp}
          isSearchOpen={isSearchOpen}
          onToggleSearch={() => {
            setIsSearchOpen(prev => {
              if (prev) setDeckSearchQuery('');
              return !prev;
            });
          }}
          hasSearchQuery={Boolean(deckSearchQuery.trim())}
        />

        {/* Expandable Search Input */}
        {isSearchOpen && (
          <div style={{ marginBottom: '12px' }}>
            <SearchBar
              value={deckSearchQuery}
              onChange={setDeckSearchQuery}
              placeholder={t('decks.search_placeholder', 'Поиск по колодам и папкам...')}
              color="indigo"
              wrapperClassName="deck-search-wrapper"
              autoFocus={true}
              onClear={() => setDeckSearchQuery('')}
            />
          </div>
        )}

        {/* Breadcrumbs for folder navigation */}
        {activeFolderId !== null && (
          <div className="folder-breadcrumbs glass" style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            borderRadius: '10px',
            marginBottom: '6px',
            fontSize: '0.95rem',
            background: 'rgba(255, 255, 255, 0.02)',
            border: `1px solid ${activeFolderColor}40`,
            boxShadow: `0 2px 10px ${activeFolderColor}15`,
            flexWrap: 'wrap'
          }}>
            <FolderOpen size={18} style={{ color: activeFolderColor, marginRight: '2px', flexShrink: 0 }} />
            <span 
              onClick={() => setActiveFolderId(null)}
              style={{ cursor: 'pointer', color: activeFolderColor, fontWeight: 600 }}
            >
              {t('decks.breadcrumb_home', 'Главная')}
            </span>
            {getBreadcrumbs().map((b, i, arr) => (
              <React.Fragment key={b.id}>
                <ChevronRight size={13} style={{ color: `${activeFolderColor}99`, flexShrink: 0 }} />
                <span 
                  onClick={() => i < arr.length - 1 && setActiveFolderId(b.id)}
                  style={{ 
                    cursor: i < arr.length - 1 ? 'pointer' : 'default', 
                    color: i < arr.length - 1 ? activeFolderColor : '#ffffff',
                    fontWeight: i === arr.length - 1 ? 700 : 600,
                    textOverflow: 'ellipsis',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    maxWidth: '180px'
                  }}
                >
                  {b.name}
                </span>
              </React.Fragment>
            ))}
          </div>
        )}

        {activeFolderId !== null && isShared && (
          <div style={{ marginBottom: '6px' }}>
            <CollaboratorPresenceBar collaborators={collaborators} onlineCount={onlineCount} isShared={isShared} />
          </div>
        )}

        {/* Pulsing shortcuts bar for actively studied decks */}
        {activeFolderId === null && !deckSearchQuery.trim() && (
          <LearningShortcutsBar
            learningDecks={allActiveLearningDecks}
            folders={folders}
            setCurrentDeck={setCurrentDeck}
            fetchDeckCards={fetchDeckCards}
          />
        )}

        {/* Quick Filter Tabs: All vs Learning */}
        {activeFolderId === null && currentDecks.length > 0 && !deckSearchQuery.trim() && (
          <div className="deck-filter-tabs glass">
            <button 
              type="button"
              className={`deck-filter-tab ${deckFilter === 'all' ? 'active' : ''}`}
              onClick={() => setDeckFilter('all')}
            >
              <span>{t('decks.filter_all', { count: currentDecks.length }, `Все (${currentDecks.length})`)}</span>
            </button>
            <button 
              type="button"
              className={`deck-filter-tab ${deckFilter === 'learning' ? 'active' : ''}`}
              onClick={() => setDeckFilter('learning')}
            >
              <span>{t('decks.filter_learning', { count: learningCount }, `🎯 Учу (${learningCount})`)}</span>
            </button>
          </div>
        )}

        <div id="tut-deck-list" className="deck-grid">
          {isInitialLoading ? (
            <div className="empty-decks-state glass">
              <RefreshCw size={48} className="spin" color="#a855f7" />
              <h3>{t('decks.loading', 'Идет загрузка колод...')}</h3>
              <p>{tr("Пожалуйста, подождите немного.")}</p>
            </div>
          ) : (!isFetchingDecks && decks.length === 0 && folders.length === 0) ? (
            <div className="empty-decks-state glass">
              <Layers size={48} opacity={0.3} />
              <h3>{tr("У вас пока нет колод")}</h3>
              <p>{tr("Нажмите \"+\", чтобы создать свою или импортировать из библиотеки.")}</p>
              <button className="btn btn-primary" onClick={() => setIsNewDeckModalOpen(true)}>{tr("Добавить первую колоду")}</button>
            </div>
          ) : isFolderEmpty ? (
            isLidRootFolder(activeFolder) ? (
              <div className="reorder-group-list" style={{ gridColumn: '1 / -1', width: '100%' }}>
                <LidExamCardItem />
              </div>
            ) : (
              <div className="empty-decks-state glass" style={{ gridColumn: '1 / -1', padding: '40px 20px', textAlign: 'center' }}>
                {activeFolderId !== null ? (
                  <>
                    <FolderOpen size={48} opacity={0.3} style={{ color: '#818cf8', marginBottom: 12, display: 'inline-block' }} />
                    <h3>{tr("Эта папка пуста")}</h3>
                    <p style={{ maxWidth: 300, margin: '8px auto 16px', fontSize: '0.85rem', color: '#94a3b8' }}>{tr("Создайте здесь новую колоду или подпапку!")}{' '}</p>
                    <button className="btn btn-primary" onClick={() => setIsNewDeckModalOpen(true)}>{tr("Добавить элемент")}</button>
                  </>
                ) : (
                  <>
                    <Layers size={48} opacity={0.3} style={{ marginBottom: 12, display: 'inline-block' }} />
                    <h3>{tr("У вас пока нет колод на языке:")}{' '}{langInfo.name} {langInfo.flag}</h3>
                    <p style={{ maxWidth: 360, margin: '8px auto 16px', fontSize: '0.9rem', color: '#94a3b8' }}>{tr("Нажмите \"+\", чтобы создать свою первую колоду для изучения")}{' '}{langInfo.label.toLowerCase()}{' '}{tr("языка.")}{' '}</p>
                    <button className="btn btn-primary" onClick={() => setIsNewDeckModalOpen(true)}>{tr("Добавить первую колоду (")}{langInfo.code.toUpperCase()})</button>
                  </>
                )}
              </div>
            )
          ) : deckSearchQuery.trim() && filteredFolders.length === 0 && filteredDecks.length === 0 ? (
            <div className="search-empty-state glass" style={{ gridColumn: '1 / -1' }}>
              <Search size={32} opacity={0.4} color="#818cf8" />
              <h3>{tr("Колоды не найдены")}</h3>
              <p>{tr("По запросу «")}{deckSearchQuery}{tr("» ничего не найдено")}</p>
              <button 
                type="button" 
                className="btn btn-secondary" 
                style={{ padding: '8px 16px', fontSize: '0.85rem', marginTop: '4px' }}
                onClick={() => setDeckSearchQuery('')}
              >{tr("Сбросить поиск")}{' '}</button>
            </div>
          ) : (
            <>
              {/* 1. Folders */}
              {filteredFolders.length > 0 && (
                <DndContext
                  sensors={sensors}
                  collisionDetection={customCollisionDetection}
                  onDragStart={(e) => setActiveFolderDragId(e.active.id)}
                  onDragEnd={handleFolderDragEnd}
                >
                  <SortableContext
                    items={filteredFolders.map(f => f.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="reorder-group-list">
                      {filteredFolders.map((folder) => (
                        <FolderCardItem
                          key={`folder-${folder.id}`}
                          folder={folder}
                          setActiveFolderId={setActiveFolderId}
                          decks={decks}
                          folders={folders}
                          showToast={showToast}
                        />
                      ))}
                    </div>
                  </SortableContext>
                  <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
                    {activeFolderItem ? (
                      <div 
                        className="deck-card glass is-drag-overlay"
                        style={{ 
                          opacity: 0.95, 
                          cursor: 'grabbing', 
                          boxShadow: '0 20px 40px rgba(0,0,0,0.6), 0 0 25px rgba(254,208,67,0.5)',
                          transform: 'scale(1.02)',
                          padding: '16px',
                          pointerEvents: 'none'
                        }}
                      >
                        <div className="deck-info-row">
                          <h3><span className="deck-title-text">{activeFolderItem.name}</span></h3>
                        </div>
                      </div>
                    ) : null}
                  </DragOverlay>
                </DndContext>
              )}

              {/* 2. Decks */}
              {(filteredDecks.length > 0 || isLidRootFolder(activeFolder)) && (
                <DndContext
                  sensors={sensors}
                  collisionDetection={customCollisionDetection}
                  onDragStart={(e) => setActiveDeckDragId(e.active.id)}
                  onDragEnd={handleDeckDragEnd}
                >
                  <SortableContext
                    items={filteredDecks.map(d => d.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="reorder-group-list">
                      {isLidRootFolder(activeFolder) && !deckSearchQuery.trim() && (
                        <LidExamCardItem />
                      )}
                      {filteredDecks.map((deck) => (
                        <DeckCardItem
                          key={`deck-${deck.id}`}
                          deck={deck}
                          setCurrentDeck={setCurrentDeck}
                          setDeckCards={setDeckCards}
                          fetchDeckCards={fetchDeckCards}
                          showToast={showToast}
                          openSyncModal={openSyncModal}
                          handleSyncDeck={handleSyncDeck}
                          handleResetProgress={handleResetProgress}
                          handleDeleteDeck={handleDeleteDeck}
                          setDeckToRename={setDeckToRename}
                          setIsRenameModalOpen={setIsRenameModalOpen}
                          togglePinDeck={togglePinDeck}
                          folders={folders}
                          activeFolderColor={activeFolderColor}
                        />
                      ))}
                    </div>
                  </SortableContext>
                  <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
                    {activeDeck ? (
                      <div 
                        className="deck-card glass is-drag-overlay"
                        style={{ 
                          opacity: 0.95, 
                          cursor: 'grabbing', 
                          boxShadow: '0 20px 40px rgba(0,0,0,0.6), 0 0 25px rgba(168,85,247,0.5)',
                          transform: 'scale(1.02)',
                          padding: '16px',
                          pointerEvents: 'none'
                        }}
                      >
                        <div className="deck-info-row">
                          <h3><span className="deck-title-text">{activeDeck.name}</span></h3>
                        </div>
                      </div>
                    ) : null}
                  </DragOverlay>
                </DndContext>
              )}
            </>
          )}
        </div>

        {/* Collapsible dropdown menu at the very bottom for advanced tools */}
        {activeFolderId === null && (
          <div className="bottom-tools-container">
            <button 
              className={`bottom-tools-toggle ${isToolsOpen ? 'active' : ''}`}
              onClick={() => setIsToolsOpen(!isToolsOpen)}
            >
              <div className="bottom-tools-toggle-left">
                <Wrench size={18} className="tools-icon" />
                <span>{tr("Инструменты и служебные разделы")}</span>
                {(duplicateCards?.length || 0) > 0 && (
                  <span className="tools-badge-total">
                    {duplicateCards.length}
                  </span>
                )}
              </div>
              <ChevronDown size={18} className={`tools-chevron ${isToolsOpen ? 'open' : ''}`} />
            </button>

            {isToolsOpen && (
              <div className="bottom-tools-menu glass">
                {/* Item 2: Управление дубликатами */}
                {(duplicateCards?.length || 0) > 0 && (
                  <button 
                    className="bottom-tools-item duplicate-item"
                    onClick={() => useUiStore.getState().setView('duplicates')}
                  >
                    <div className="tools-item-left">
                      <div className="tools-item-icon-box duplicate">
                        <Copy size={18} />
                      </div>
                      <div className="tools-item-text">
                        <span className="tools-item-title duplicate-text">{tr("Управление дубликатами")}</span>
                        <span className="tools-item-desc">{tr("Повторяющиеся карточки в разных колодах")}</span>
                      </div>
                    </div>
                    <span className="tools-item-badge duplicate">{duplicateCards.length}</span>
                  </button>
                )}

                {/* Item 3: Корзина */}
                <button 
                  className="bottom-tools-item trash-item"
                  onClick={() => {
                    useDeckStore.getState().fetchTrash();
                    useUiStore.getState().setView('trash');
                  }}
                >
                  <div className="tools-item-left">
                    <div className="tools-item-icon-box trash">
                      <Trash2 size={18} />
                    </div>
                    <div className="tools-item-text">
                      <span className="tools-item-title trash-text">{tr("Корзина")}</span>
                      <span className="tools-item-desc">{tr("Удаленные колоды и карточки (восстановление)")}</span>
                    </div>
                  </div>
                  <span className="tools-item-badge trash">{tr("Хранилище")}</span>
                </button>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
};
