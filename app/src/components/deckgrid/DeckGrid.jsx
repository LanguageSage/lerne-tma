import React, { useState } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { Layers, RefreshCw, Copy, Trash2, FolderOpen, ChevronRight, Flame, Wrench, ChevronDown, Search } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import { useDeckStore } from '../../store/useDeckStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { ImportModal } from '../modals/ImportModal';
import { DeckGridHeader } from './DeckGridHeader';
import { DeckCardItem } from './DeckCardItem';
import { FolderCardItem } from './FolderTreeNav';
import { useCollaborativePresence } from '../../hooks/useCollaborativePresence';
import { CollaboratorPresenceBar } from '../collaborative/CollaboratorPresenceBar';
import { SearchBar } from '../common/SearchBar';
import { matchFolder, matchDeck } from '../../utils/search';

export const DeckGrid = ({ 
  startTutorial, 
  userId, 
  openSyncModal
}) => {
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [deckSearchQuery, setDeckSearchQuery] = useState('');

  const { 
    view, loading, hasInitialized, setIsNewDeckModalOpen, setIsSettingsOpen, 
    showToast, userProfile, setIsRenameModalOpen, setDeckToRename, 
    activeFolderId, setActiveFolderId 
  } = useUiStore();

  const { 
    decks, folders, setCurrentDeck, fetchDeckCards, 
    handleSyncDeck, handleResetProgress, handleDeleteDeck, 
    setDeckCards, togglePinDeck, reorderDecks,
    duplicateCards
  } = useDeckStore();

  const activeLanguage = useLanguageStore(state => state.activeLanguage);
  const langInfo = useLanguageStore(state => state.getLanguageInfo());

  const { collaborators, onlineCount, isShared } = useCollaborativePresence('folder', activeFolderId, view === 'decks' && activeFolderId !== null);

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

  const filteredFolders = React.useMemo(() => {
    if (!deckSearchQuery.trim()) return currentFolders;
    return currentFolders.filter(f => matchFolder(f, deckSearchQuery));
  }, [currentFolders, deckSearchQuery]);

  const filteredDecks = React.useMemo(() => {
    if (!deckSearchQuery.trim()) return currentDecks;
    return currentDecks.filter(d => matchDeck(d, deckSearchQuery));
  }, [currentDecks, deckSearchQuery]);

  const getOriginalFolderIndex = React.useCallback((folderId) => {
    if (!currentFolders) return 0;
    const idx = currentFolders.findIndex(f => f.id === folderId);
    return idx >= 0 ? idx : 0;
  }, [currentFolders]);

  const getOriginalDeckIndex = React.useCallback((deckId) => {
    if (!currentDecks) return 0;
    const idx = currentDecks.findIndex(d => d.id === deckId);
    return idx >= 0 ? idx : 0;
  }, [currentDecks]);

  if (view !== 'decks') return null;

  const accountParam = userProfile?.username 
    ? `&account=${userProfile.username}` 
    : (userProfile?.first_name ? `&account=${encodeURIComponent(userProfile.first_name)}` : '');
  const personalLink = `${window.location.origin}/?user_id=${userId}${accountParam}`;

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
  const isFolderEmpty = currentFolders.length === 0 && currentDecks.length === 0;

  return (
    <div className="view-decks">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="view"
      >
        <DeckGridHeader
          personalLink={personalLink}
          startTutorial={startTutorial}
          setIsNewDeckModalOpen={setIsNewDeckModalOpen}
          setIsSettingsOpen={setIsSettingsOpen}
          showToast={showToast}
          onLanguageChange={() => {
            showToast(`Язык изменен на ${useLanguageStore.getState().getLanguageInfo().name}`, 'info');
          }}
          activeFolderId={activeFolderId}
          onFolderBack={() => {
            const activeFolder = folders?.find(f => f.id === activeFolderId);
            const parentId = activeFolder ? (activeFolder.parent_id || null) : null;
            setActiveFolderId(parentId);
          }}
        />

        {/* Breadcrumbs for folder navigation */}
        {activeFolderId !== null && (
          <div className="folder-breadcrumbs glass" style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '12px 18px',
            borderRadius: '14px',
            marginBottom: '20px',
            fontSize: '1.15rem',
            background: 'rgba(255, 255, 255, 0.02)',
            border: `1px solid ${activeFolderColor}40`,
            boxShadow: `0 4px 20px ${activeFolderColor}15`,
            flexWrap: 'wrap'
          }}>
            <FolderOpen size={22} style={{ color: activeFolderColor, marginRight: '4px', flexShrink: 0 }} />
            <span 
              onClick={() => setActiveFolderId(null)}
              style={{ cursor: 'pointer', color: activeFolderColor, fontWeight: 600 }}
            >
              Главная
            </span>
            {getBreadcrumbs().map((b, i, arr) => (
              <React.Fragment key={b.id}>
                <ChevronRight size={14} style={{ color: `${activeFolderColor}99`, flexShrink: 0 }} />
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
          <div style={{ marginBottom: '16px' }}>
            <CollaboratorPresenceBar collaborators={collaborators} onlineCount={onlineCount} isShared={isShared} />
          </div>
        )}

        {(currentFolders.length > 0 || currentDecks.length > 0 || deckSearchQuery.trim()) && (
          <SearchBar
            value={deckSearchQuery}
            onChange={setDeckSearchQuery}
            placeholder="Поиск по колодам и папкам..."
            color="indigo"
            wrapperClassName="deck-search-wrapper"
          />
        )}

        <div id="tut-deck-list" className="deck-grid">
          {(!hasInitialized || loading) && decks.length === 0 ? (
            <div className="empty-decks-state glass">
              <RefreshCw size={48} className="spin" color="#a855f7" />
              <h3>Идет загрузка колод...</h3>
              <p>Пожалуйста, подождите немного.</p>
            </div>
          ) : (decks.length === 0 && folders.length === 0) ? (
            <div className="empty-decks-state glass">
              <Layers size={48} opacity={0.3} />
              <h3>У вас пока нет колод</h3>
              <p>Нажмите "+", чтобы создать свою или импортировать из библиотеки.</p>
              <button className="btn btn-primary" onClick={() => setIsNewDeckModalOpen(true)}>Добавить первую колоду</button>
            </div>
          ) : isFolderEmpty ? (
            <div className="empty-decks-state glass" style={{ gridColumn: '1 / -1', padding: '40px 20px', textAlign: 'center' }}>
              {activeFolderId !== null ? (
                <>
                  <FolderOpen size={48} opacity={0.3} style={{ color: '#818cf8', marginBottom: 12, display: 'inline-block' }} />
                  <h3>Эта папка пуста</h3>
                  <p style={{ maxWidth: 300, margin: '8px auto 16px', fontSize: '0.85rem', color: '#94a3b8' }}>
                    Создайте здесь новую колоду или подпапку!
                  </p>
                  <button className="btn btn-primary" onClick={() => setIsNewDeckModalOpen(true)}>Добавить элемент</button>
                </>
              ) : (
                <>
                  <Layers size={48} opacity={0.3} style={{ marginBottom: 12, display: 'inline-block' }} />
                  <h3>У вас пока нет колод на языке: {langInfo.name} {langInfo.flag}</h3>
                  <p style={{ maxWidth: 360, margin: '8px auto 16px', fontSize: '0.9rem', color: '#94a3b8' }}>
                    Нажмите "+", чтобы создать свою первую колоду для изучения {langInfo.label.toLowerCase()} языка.
                  </p>
                  <button className="btn btn-primary" onClick={() => setIsNewDeckModalOpen(true)}>Добавить первую колоду ({langInfo.code.toUpperCase()})</button>
                </>
              )}
            </div>
          ) : deckSearchQuery.trim() && filteredFolders.length === 0 && filteredDecks.length === 0 ? (
            <div className="search-empty-state glass" style={{ gridColumn: '1 / -1' }}>
              <Search size={32} opacity={0.4} color="#818cf8" />
              <h3>Колоды не найдены</h3>
              <p>По запросу «{deckSearchQuery}» ничего не найдено</p>
              <button 
                type="button" 
                className="btn btn-secondary" 
                style={{ padding: '8px 16px', fontSize: '0.85rem', marginTop: '4px' }}
                onClick={() => setDeckSearchQuery('')}
              >
                Сбросить поиск
              </button>
            </div>
          ) : (
            <>
              {/* 1. Folders */}
              {filteredFolders.length > 0 && (
                <Reorder.Group
                  as="div"
                  axis="y"
                  values={filteredFolders}
                  onReorder={(newOrder) => {
                    if (!deckSearchQuery.trim()) {
                      const orderedIds = newOrder.map(f => f.id);
                      useDeckStore.getState().reorderFolders(orderedIds);
                    }
                  }}
                  className="reorder-group-list"
                >
                  {filteredFolders.map((folder, idx) => (
                    <FolderCardItem
                      key={`folder-${folder.id}`}
                      folder={folder}
                      index={deckSearchQuery.trim() ? getOriginalFolderIndex(folder.id) : idx}
                      setActiveFolderId={setActiveFolderId}
                      decks={decks}
                      folders={folders}
                      showToast={showToast}
                    />
                  ))}
                </Reorder.Group>
              )}

              {/* 2. Decks */}
              {filteredDecks.length > 0 && (
                <Reorder.Group
                  as="div"
                  axis="y"
                  values={filteredDecks}
                  onReorder={(newOrder) => {
                    if (!deckSearchQuery.trim()) {
                      const orderedIds = newOrder.map(d => d.id);
                      reorderDecks(orderedIds);
                    }
                  }}
                  className="reorder-group-list"
                >
                  {filteredDecks.map((deck, idx) => (
                    <DeckCardItem
                      key={deck.id}
                      deck={deck}
                      index={deckSearchQuery.trim() ? getOriginalDeckIndex(deck.id) : idx}
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
                </Reorder.Group>
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
                <span>Инструменты и служебные разделы</span>
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
                        <span className="tools-item-title duplicate-text">Управление дубликатами</span>
                        <span className="tools-item-desc">Повторяющиеся карточки в разных колодах</span>
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
                      <span className="tools-item-title trash-text">Корзина</span>
                      <span className="tools-item-desc">Удаленные колоды и карточки (восстановление)</span>
                    </div>
                  </div>
                  <span className="tools-item-badge trash">Хранилище</span>
                </button>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
};
