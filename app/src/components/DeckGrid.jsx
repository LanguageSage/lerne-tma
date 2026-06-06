import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, Reorder, useDragControls } from 'framer-motion';
import { Layers, Plus, Settings, RefreshCw, Info, Copy, Trash2, Share2, Inbox, Download, X, BookOpen, ChevronRight, Edit2, Folder, FolderOpen, Flame, Pin, MoreHorizontal, ChevronsUpDown } from 'lucide-react';
import { HelpButton } from './TutorialOverlay';
import { UserProfileBadge } from './common/UserBadge';
import { useUiStore } from '../store/useUiStore';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import api from '../services/api';

// Compact share banner shown above the deck list when a share link is opened
const ShareBanner = ({ shareId, onSuccess, onClose }) => {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const { showToast, userProfile } = useUiStore();
  const { fetchDecks } = useDeckStore();

  useEffect(() => {
    if (!shareId) return;
    api.get(`/share/info/${shareId}`)
      .then(r => setInfo(r.data))
      .catch(() => setInfo(null))
      .finally(() => setLoading(false));
  }, [shareId]);

  const handleImport = async () => {
    setImporting(true);
    try {
      const res = await api.post('/share/import', { share_id: shareId });
      if (res.data.status === 'ok') {
        const msg = res.data.type === 'deck'
          ? `✅ Колода «${res.data.deck_name}» добавлена!`
          : '✅ Карточка добавлена во Входящие!';
        showToast(msg, 'success');
        await fetchDecks(userProfile?.user_id);
        onSuccess();
      }
    } catch {
      showToast('Ошибка при добавлении', 'error');
    } finally {
      setImporting(false);
    }
  };

  if (!shareId) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="share-banner glass"
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -16 }}
        transition={{ duration: 0.3 }}
      >
        {loading ? (
          <div className="share-banner-inner">
            <RefreshCw size={16} className="spin" color="#818cf8" />
            <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Загрузка...</span>
          </div>
        ) : !info ? (
          <div className="share-banner-inner">
            <span style={{ color: '#fca5a5', fontSize: '0.85rem' }}>⚠️ Ссылка недействительна</span>
            <button className="share-banner-close" onClick={onClose}><X size={16} /></button>
          </div>
        ) : (
          <div className="share-banner-inner">
            {/* Left: icon + text */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
              <div className="share-banner-icon">
                <BookOpen size={16} color="#a5b4fc" />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: 1 }}>
                  {info.creator_name ? `от ${info.creator_name}` : 'Вам поделились'}
                </div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {info.type === 'deck' ? `📚 ${info.name}` : `🃏 ${info.front_text}`}
                </div>
              </div>
            </div>

            {/* Right: action buttons */}
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button
                className="share-banner-btn share-banner-btn-primary"
                onClick={handleImport}
                disabled={importing}
              >
                {importing
                  ? <RefreshCw size={13} className="spin" />
                  : <><Download size={13} /> <span>Добавить</span></>
                }
              </button>
              <button className="share-banner-close" onClick={onClose}><X size={15} /></button>
            </div>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
};

const DeckCardItem = ({
  deck,
  setCurrentDeck,
  setDeckCards,
  fetchDeckCards,
  showToast,
  openSyncModal,
  handleSyncDeck,
  handleResetProgress,
  handleDeleteDeck,
  setDeckToRename,
  setIsRenameModalOpen,
  togglePinDeck,
  folders
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isMoveMenuOpen, setIsMoveMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const dragControls = useDragControls();

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isMenuOpen]);

  useEffect(() => {
    if (!isMenuOpen) {
      setIsMoveMenuOpen(false);
    }
  }, [isMenuOpen]);

  const onMainAction = () => {
    setCurrentDeck(deck);
    setDeckCards([]);
    fetchDeckCards(deck.id);
    useUiStore.getState().setView('cards');
  };

  const handleShare = async (e) => {
    e.stopPropagation();
    setIsMenuOpen(false);
    try {
      const result = await useDeckStore.getState().handleShareDeck(deck.id);
      if (result.success) {
        if (result.type === 'copy') showToast('Ссылка скопирована!', 'success');
        else if (result.type === 'telegram') showToast('Открываем Telegram Share...', 'success');
      }
    } catch (err) {
      showToast('Ошибка при создании ссылки', 'error');
    }
  };

  const handleSync = (e) => {
    e.stopPropagation();
    setIsMenuOpen(false);
    if (openSyncModal) {
      openSyncModal(deck);
    } else {
      handleSyncDeck(deck.id);
    }
  };

  const handleRename = (e) => {
    e.stopPropagation();
    setIsMenuOpen(false);
    setDeckToRename(deck);
    setIsRenameModalOpen(true);
  };

  const handleReset = async (e) => {
    e.stopPropagation();
    setIsMenuOpen(false);
    if (window.confirm("Это сбросит весь прогресс обучения по этой колоде. Вы уверены?")) {
      try {
        await handleResetProgress(deck.id);
        showToast("Прогресс успешно сброшен", "success");
      } catch (err) {
        showToast("Ошибка при сбросе прогресса");
      }
    }
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    setIsMenuOpen(false);
    if (window.confirm("Вы уверены, что хотите полностью удалить эту колоду и весь прогресс?")) {
      handleDeleteDeck(deck.id);
    }
  };

  const handlePin = async (e) => {
    e.stopPropagation();
    try {
      await togglePinDeck(deck.id);
      showToast(deck.is_pinned ? 'Колода откреплена' : 'Колода закреплена', 'success');
    } catch (err) {
      showToast('Ошибка при закреплении колоды', 'error');
    }
  };

  const handleMoveToFolder = async (e, folderId) => {
    e.stopPropagation();
    setIsMenuOpen(false);
    setIsMoveMenuOpen(false);
    try {
      await useDeckStore.getState().moveDeckToFolder(deck.id, folderId);
      showToast("Колода перемещена", "success");
    } catch (err) {
      showToast("Ошибка при перемещении колоды", "error");
    }
  };

  return (
    <Reorder.Item
      value={deck}
      dragListener={false}
      dragControls={dragControls}
      className={`deck-card glass ${deck.is_pinned ? 'deck-pinned' : ''} ${deck.is_inbox ? 'deck-card-inbox' : ''} ${!deck.is_inbox ? 'deck-card-draggable' : ''}`}
      style={{ position: 'relative' }}
    >
      {/* Drag handle: only show for non-inbox decks */}
      {!deck.is_inbox && (
        <div
          className="deck-drag-handle"
          onPointerDown={(e) => dragControls.start(e)}
          style={{ touchAction: 'none' }}
          title="Перетащить колоду"
        >
          <ChevronsUpDown size={24} />
        </div>
      )}

      <div className="deck-main-action" onClick={onMainAction}>
        <div className="deck-icon">
          {deck.is_inbox ? <Inbox size={24} /> : <Layers size={24} />}
        </div>
        
        <h3>
          <span className="deck-title-text">{deck.name}</span>
          
          {deck.is_inbox && deck.stats.total > 0 && (
            <span style={{ marginLeft: 8, fontSize: '0.7rem', background: 'rgba(99,102,241,0.3)', color: '#818cf8', padding: '2px 7px', borderRadius: 6, fontWeight: 700 }}>
              новые
            </span>
          )}

          {!deck.is_inbox && (
            <button
              className={`pin-deck-btn ${deck.is_pinned ? 'pinned' : ''}`}
              onClick={handlePin}
              title={deck.is_pinned ? "Открепить колоду" : "Закрепить колоду"}
            >
              <Pin size={16} />
            </button>
          )}
        </h3>

        <div className="deck-stats">
          <span className="stat total" title="Всего карточек">{deck.stats.total}</span>
          <span className="stat new" title="Новые">{deck.stats.new}</span>
          <span className="stat learning" title="В изучении">{deck.stats.learning}</span>
          <span className="stat due" title="К повторению">{deck.stats.due}</span>
        </div>
      </div>

      <div className="deck-footer-actions" style={{ justifyContent: 'flex-start', padding: '8px 12px', position: 'relative' }}>
        {deck.is_inbox && (
          <div style={{ marginRight: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
              📥 Входящие карточки
            </span>
          </div>
        )}

        <button 
          className={`menu-toggle-btn ${isMenuOpen ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setIsMenuOpen(!isMenuOpen);
          }}
          title="Опции колоды"
        >
          <MoreHorizontal size={16} />
          <span>Опции</span>
          {deck.has_updates && !deck.is_inbox && (
            <span className="menu-update-indicator" />
          )}
        </button>

        {isMenuOpen && (
          <div className="deck-dropdown-menu glass" ref={menuRef} onClick={(e) => e.stopPropagation()}>
            <button className="dropdown-item" onClick={onMainAction}>
              <span>📖 Список карточек</span>
            </button>
            
            {!deck.is_inbox && (
              <button className="dropdown-item" onClick={handleShare}>
                <span>🔗 Поделиться</span>
              </button>
            )}

            {!deck.is_inbox && (
              <button className="dropdown-item" onClick={handleSync}>
                <span>🔄 {deck.has_updates ? '❗️ Обновить' : 'Обновить'}</span>
              </button>
            )}

            {!deck.is_inbox && (
              <button className="dropdown-item" onClick={handleRename}>
                <span>✍️ Переименовать</span>
              </button>
            )}

            {!deck.is_inbox && (
              <>
                <button 
                  className={`dropdown-item ${isMoveMenuOpen ? 'active' : ''}`} 
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsMoveMenuOpen(!isMoveMenuOpen);
                  }}
                >
                  <span>📁 Переместить в папку</span>
                  <ChevronRight 
                    size={14} 
                    style={{ 
                      marginLeft: 'auto', 
                      transform: isMoveMenuOpen ? 'rotate(90deg)' : 'none',
                      transition: 'transform 0.2s' 
                    }} 
                  />
                </button>
                {isMoveMenuOpen && (
                  <div className="dropdown-sub-menu">
                    <button 
                      className={`dropdown-sub-item ${deck.folder_id === null ? 'current' : ''}`}
                      onClick={(e) => handleMoveToFolder(e, null)}
                    >
                      <span>Без папки (Главная)</span>
                    </button>
                    {(folders || []).map(f => (
                      <button 
                        key={f.id}
                        className={`dropdown-sub-item ${deck.folder_id === f.id ? 'current' : ''}`}
                        onClick={(e) => handleMoveToFolder(e, f.id)}
                      >
                        <span>{f.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            <button className="dropdown-item text-red" onClick={handleReset}>
              <span>🧹 Сбросить прогресс</span>
            </button>

            {!deck.is_inbox && (
              <button className="dropdown-item text-red" onClick={handleDelete}>
                <span>❌ Удалить</span>
              </button>
            )}
          </div>
        )}
      </div>
    </Reorder.Item>
  );
};

export const DeckGrid = ({ startTutorial, userId, openSyncModal, startStudy, importShareId, onImportSuccess, onImportClose }) => {
  const { view, loading, setIsNewDeckModalOpen, setIsSettingsOpen, showToast, userProfile, setIsRenameModalOpen, setDeckToRename, activeFolderId, setActiveFolderId } = useUiStore();
  const { decks, folders, setCurrentDeck, fetchDeckCards, handleSyncDeck, handleResetProgress, handleDeleteDeck, setDeckCards, togglePinDeck, reorderDecks } = useDeckStore();
  
  if (view !== 'decks') return null;

  const accountParam = userProfile?.username ? `&account=${userProfile.username}` : (userProfile?.first_name ? `&account=${encodeURIComponent(userProfile.first_name)}` : '');
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

  const currentFolders = folders ? folders.filter(f => f.parent_id === activeFolderId) : [];
  const currentDecks = decks ? decks.filter(d => {
    if (d.is_inbox) {
      return activeFolderId === null;
    }
    return d.folder_id === activeFolderId;
  }) : [];

  const isFolderEmpty = currentFolders.length === 0 && currentDecks.length === 0;

  return (
    <div className="view-decks">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="view"
      >
        <div className="header">
          <div className="header-title-row">
            <div className="header-left">
              <UserProfileBadge />
              <h1>Lerne TMA</h1>
            </div>
            <div className="header-actions">
              <HelpButton onClick={() => startTutorial('decks')} />
              <button id="tut-add-deck" className="add-deck-btn" onClick={() => setIsNewDeckModalOpen(true)}>
                <Plus size={20} />
              </button>
              <button id="tut-main-settings" className="settings-btn" onClick={(e) => { e.stopPropagation(); setIsSettingsOpen(true); }}>
                <Settings size={20} />
              </button>
            </div>
          </div>
          <p>Выбирайте колоду и начните обучение</p>
          <div className="commercial-info glass">
            <Info size={16} />
            <div className="web-link-container">
              <span>Персональная ссылка: </span>
              <code className="web-link">{personalLink}</code>
              <button 
                className="copy-link-btn" 
                onClick={() => {
                  navigator.clipboard.writeText(personalLink);
                  showToast("Ссылка скопирована!", "success");
                }}
                title="Копировать ссылку"
              >
                <Copy size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Share banner — shown when opened via share link */}
        {importShareId && (
          <ShareBanner
            shareId={importShareId}
            onSuccess={onImportSuccess}
            onClose={onImportClose}
          />
        )}

        {/* Breadcrumbs for folder navigation */}
        {activeFolderId !== null && (
          <div className="folder-breadcrumbs glass" style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 14px',
            borderRadius: '12px',
            marginBottom: '16px',
            fontSize: '0.85rem',
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            flexWrap: 'wrap'
          }}>
            <span 
              onClick={() => setActiveFolderId(null)}
              style={{ cursor: 'pointer', color: '#818cf8', fontWeight: 600 }}
            >
              Главная
            </span>
            {getBreadcrumbs().map((b, i, arr) => (
              <React.Fragment key={b.id}>
                <ChevronRight size={12} color="#64748b" style={{ flexShrink: 0 }} />
                <span 
                  onClick={() => i < arr.length - 1 && setActiveFolderId(b.id)}
                  style={{ 
                    cursor: i < arr.length - 1 ? 'pointer' : 'default', 
                    color: i < arr.length - 1 ? '#818cf8' : '#cbd5e1',
                    fontWeight: i === arr.length - 1 ? 700 : 600,
                    textOverflow: 'ellipsis',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    maxWidth: '120px'
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
              <FolderOpen size={48} opacity={0.3} style={{ color: '#818cf8', marginBottom: 12, display: 'inline-block' }} />
              <h3>Эта папка пуста</h3>
              <p style={{ maxWidth: 300, margin: '8px auto 16px', fontSize: '0.85rem', color: '#94a3b8' }}>
                Создайте здесь новую колоду или подпапку!
              </p>
              <button className="btn btn-primary" onClick={() => setIsNewDeckModalOpen(true)}>Добавить элемент</button>
            </div>
          ) : (
            <>
              {/* 1. Render Folders */}
              {currentFolders.map(folder => {
                const childDecks = decks.filter(d => d.folder_id === folder.id);
                const totalDecksCount = childDecks.length;
                const folderColor = folder.color || '#818cf8';
                return (
                  <div 
                    key={`folder-${folder.id}`} 
                    className="deck-card glass folder-card"
                    style={{ 
                      borderLeft: `4px solid ${folderColor}`
                    }}
                  >
                    <div className="deck-main-action" onClick={() => setActiveFolderId(folder.id)}>
                      <div className="deck-icon" style={{ background: 'rgba(129, 140, 248, 0.1)', color: folderColor }}>
                        <Folder size={24} />
                      </div>
                      <h3>
                        <span className="deck-title-text">{folder.name}</span>
                      </h3>
                      <div className="deck-stats">
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8', background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: 12 }}>
                          {totalDecksCount} {totalDecksCount === 1 ? 'колода' : (totalDecksCount >= 2 && totalDecksCount <= 4 ? 'колоды' : 'колод')}
                        </span>
                      </div>
                    </div>
                    <div className="deck-footer-actions" style={{ justifyContent: 'space-between' }}>
                      <button 
                        className="deck-action-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          const newName = window.prompt("Введите новое название папки:", folder.name);
                          if (newName && newName.trim()) {
                            useDeckStore.getState().renameFolder(folder.id, newName.trim());
                            showToast("Папка переименована", "success");
                          }
                        }}
                      >
                        <Edit2 size={13} /> Имя
                      </button>
                      <button 
                        className="deck-action-btn delete-btn-minimal" 
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          if (window.confirm("Удалить эту папку? Все колоды и папки внутри неё переместятся на уровень выше.")) {
                            useDeckStore.getState().deleteFolder(folder.id);
                            showToast("Папка удалена", "success");
                          } 
                        }}
                        title="Удалить папку"
                      >
                        <Trash2 size={13} /> Удалить
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* 2. Render Decks */}
              <Reorder.Group
                as="div"
                axis="y"
                values={currentDecks}
                onReorder={(newOrder) => {
                  const orderedIds = newOrder.map(d => d.id);
                  reorderDecks(orderedIds);
                }}
                style={{ display: 'contents' }}
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
                  />
                ))}
              </Reorder.Group>
            </>
          )}

          {/* Special item for Turbo Practice (Favorites) */}
          {useDeckStore.getState().favoriteCards.length > 0 && (
            <div 
              className="deck-card glass favorite-turbo-card" 
              style={{ 
                border: '1px solid rgba(239, 68, 68, 0.4)',
                background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.12), rgba(168, 85, 247, 0.08))',
                cursor: 'pointer'
              }}
              onClick={() => {
                const favoritesDeck = { id: 'favorites', name: 'Ударный режим 🔥' };
                setCurrentDeck(favoritesDeck);
                setDeckCards([]);
                useSessionStore.getState().resetSession();
                fetchDeckCards('favorites');
                useUiStore.getState().setView('study');
              }}
            >
              <div className="deck-main-action">
                <div className="deck-icon" style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444' }}>
                  <Flame size={24} className="pulse-icon" />
                </div>
                <h3 style={{ color: '#ef4444' }}>Ударный режим 🔥</h3>
                <div className="deck-stats">
                  <span className="stat total" style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
                    {useDeckStore.getState().favoriteCards.length}
                  </span>
                </div>
              </div>
              <div className="deck-footer-actions" style={{ justifyContent: 'center', padding: '8px 12px' }}>
                <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                  Тренировка избранных карточек по кругу до автоматизма
                </span>
              </div>
            </div>
          )}

          {/* Special item for duplicates, at the very bottom */}
          {useDeckStore.getState().duplicateCards.length > 0 && (
            <div 
              className="deck-card glass" 
              style={{ 
                border: '1px dashed rgba(168,85,247,0.4)',
                background: 'rgba(168,85,247,0.05)'
              }}
              onClick={() => useUiStore.getState().setView('duplicates')}
            >
              <div className="deck-main-action">
                <div className="deck-icon" style={{ background: 'rgba(168,85,247,0.2)', color: '#c084fc' }}>
                  <Copy size={24} />
                </div>
                <h3 style={{ color: '#c084fc' }}>Управление дубликатами</h3>
                <div className="deck-stats">
                  <span className="stat total" style={{ color: '#c084fc' }}>
                    {useDeckStore.getState().duplicateCards.length} карточек
                  </span>
                </div>
              </div>
              <div className="deck-footer-actions" style={{ justifyContent: 'center', padding: '8px 12px' }}>
                <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                  Найдены повторяющиеся карточки в разных колодах
                </span>
              </div>
            </div>
          )}

          {/* Special item for Trash, below duplicates */}
          <div 
            className="deck-card glass" 
            style={{ 
              border: '1px dashed rgba(239,68,68,0.4)',
              background: 'rgba(239,68,68,0.05)'
            }}
            onClick={() => {
              useDeckStore.getState().fetchTrash();
              useUiStore.getState().setView('trash');
            }}
          >
            <div className="deck-main-action">
              <div className="deck-icon" style={{ background: 'rgba(239,68,68,0.2)', color: '#f87171' }}>
                <Trash2 size={24} />
              </div>
              <h3 style={{ color: '#f87171' }}>Корзина</h3>
              <div className="deck-stats">
                <span className="stat total" style={{ color: '#fca5a5', fontSize: '0.8rem', fontWeight: 500 }}>
                  Хранилище
                </span>
              </div>
            </div>
            <div className="deck-footer-actions" style={{ justifyContent: 'center', padding: '8px 12px' }}>
              <span style={{ fontSize: '0.7rem', color: '#94a3b8', textAlign: 'center' }}>
                Удаленные колоды и карточки (возможность восстановления)
              </span>
            </div>
          </div>
        </div>

      </motion.div>
    </div>
  );
};
