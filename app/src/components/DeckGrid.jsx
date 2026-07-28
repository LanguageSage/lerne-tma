import React, { useState } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { Layers, RefreshCw, Copy, Trash2, FolderOpen, ChevronRight, Flame, Wrench, ChevronDown } from 'lucide-react';
import { useUiStore } from '../store/useUiStore';
import { useDeckStore } from '../store/useDeckStore';
import { useLanguageStore } from '../store/useLanguageStore';
import { ImportModal } from './ImportModal';
import { DeckGridHeader } from './deckgrid/DeckGridHeader';
import { DeckCardItem } from './deckgrid/DeckCardItem';
import { FolderCardItem } from './deckgrid/FolderTreeNav';

export const DeckGrid = ({ 
  startTutorial, 
  userId, 
  openSyncModal, 
  startStudy, 
  importShareId, 
  onImportSuccess, 
  onImportClose 
}) => {
  const [isToolsOpen, setIsToolsOpen] = useState(false);

  const { 
    view, loading, setIsNewDeckModalOpen, setIsSettingsOpen, 
    showToast, userProfile, setIsRenameModalOpen, setDeckToRename, 
    activeFolderId, setActiveFolderId 
  } = useUiStore();

  const { 
    decks, folders, setCurrentDeck, fetchDeckCards, 
    handleSyncDeck, handleResetProgress, handleDeleteDeck, 
    setDeckCards, togglePinDeck, reorderDecks,
    favoriteCards, duplicateCards
  } = useDeckStore();

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

  const activeLanguage = useLanguageStore(state => state.activeLanguage);
  const langInfo = useLanguageStore(state => state.getLanguageInfo());

  const currentFolders = folders ? folders.filter(f => f.parent_id === activeFolderId && (f.target_language || 'de') === activeLanguage) : [];
  const activeFolder = folders?.find(f => f.id === activeFolderId);
  const activeFolderColor = activeFolder ? (activeFolder.color || '#ffd043') : null;
  
  // Filter decks by active folder and target language
  const currentDecks = decks ? decks.filter(d => d.folder_id === activeFolderId && (d.target_language || 'de') === activeLanguage) : [];

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

        {/* Import shared item modal */}
        {importShareId && (
          <ImportModal
            shareId={importShareId}
            onImportSuccess={onImportSuccess}
            onClose={onImportClose}
          />
        )}

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

        <div id="tut-deck-list" className="deck-grid">
          {loading && decks.length === 0 ? (
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
          ) : (
            <>
              {/* 1. Folders */}
              {currentFolders.length > 0 && (
                <Reorder.Group
                  as="div"
                  axis="y"
                  values={currentFolders}
                  onReorder={(newOrder) => {
                    const orderedIds = newOrder.map(f => f.id);
                    useDeckStore.getState().reorderFolders(orderedIds);
                  }}
                  className="reorder-group-list"
                >
                  {currentFolders.map(folder => (
                    <FolderCardItem
                      key={`folder-${folder.id}`}
                      folder={folder}
                      setActiveFolderId={setActiveFolderId}
                      decks={decks}
                      folders={folders}
                      showToast={showToast}
                    />
                  ))}
                </Reorder.Group>
              )}

              {/* 2. Decks */}
              {currentDecks.length > 0 && (
                <Reorder.Group
                  as="div"
                  axis="y"
                  values={currentDecks}
                  onReorder={(newOrder) => {
                    const orderedIds = newOrder.map(d => d.id);
                    reorderDecks(orderedIds);
                  }}
                  className="reorder-group-list"
                >
                  {currentDecks.map((deck) => (
                    <DeckCardItem
                      key={deck.id}
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
                {((favoriteCards?.length || 0) > 0 || (duplicateCards?.length || 0) > 0) && (
                  <span className="tools-badge-total">
                    {(favoriteCards?.length || 0) + (duplicateCards?.length || 0)}
                  </span>
                )}
              </div>
              <ChevronDown size={18} className={`tools-chevron ${isToolsOpen ? 'open' : ''}`} />
            </button>

            {isToolsOpen && (
              <div className="bottom-tools-menu glass">
                {/* Item 1: Ударный режим */}
                {(favoriteCards?.length || 0) > 0 && (
                  <button 
                    className="bottom-tools-item favorite-item"
                    onClick={() => {
                      const favoritesDeck = { id: 'favorites', name: 'Ударный режим 🔥' };
                      startStudy(favoritesDeck);
                    }}
                  >
                    <div className="tools-item-left">
                      <div className="tools-item-icon-box flame">
                        <Flame size={18} className="pulse-icon" />
                      </div>
                      <div className="tools-item-text">
                        <span className="tools-item-title flame-text">Ударный режим 🔥</span>
                        <span className="tools-item-desc">Тренировка избранных карточек по кругу</span>
                      </div>
                    </div>
                    <span className="tools-item-badge flame">{favoriteCards.length}</span>
                  </button>
                )}

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
