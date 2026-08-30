import React from 'react';
import { motion, Reorder, useDragControls } from 'framer-motion';
import { ChevronLeft, Plus, ListPlus, Settings, Play, RefreshCw, GripHorizontal, ExternalLink, Crop, Loader2, Search, ChevronDown, ChevronUp, MoreHorizontal, ChevronRight } from 'lucide-react';
import { HelpButton } from '../TutorialOverlay';
import { CardActionButton } from '../modals/CardActionModal';
import { useUiStore } from '../../store/useUiStore';
import { useDeckStore } from '../../store/useDeckStore';
import { useCardNavigation } from '../../hooks/useCardNavigation';
import { UserProfileBadge } from '../common/UserBadge';
import { DeckMediaModal } from '../modals/DeckMediaModal';
import { ImageEditorModal } from '../common/ImageEditorModal';
import { useMediaUpload } from '../../hooks/useMediaUpload';

import DeckAudioPlayer from '../common/DeckAudioPlayer';
import { getFlagStyle } from '../../constants/cardFlags';
import { CardLevelBadge } from '../common/CardLevelBadge';
import { useCollaborativePresence } from '../../hooks/useCollaborativePresence';
import { CollaboratorPresenceBar } from '../collaborative/CollaboratorPresenceBar';
import { parseQuizData } from '../../utils/quizParser';
import { getTextShadow } from '../../utils/style';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTranslation } from '../../i18n/i18nContext';
import { SearchBar } from '../common/SearchBar';
import { matchCard } from '../../utils/search';
import { getSortedFolderTree, parseDeckMetadata, getResourceSrc } from '../../utils/deckUtils';

const DraggableCardItem = React.memo(({ c, index, currentDeck, startStudyCard, frontTypographyStyle }) => {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const dragControls = useDragControls();
  const flagStyle = React.useMemo(() => getFlagStyle(c.flag), [c.flag]);

  const isQuizCard = React.useMemo(() => c.card_type === 'quiz' || parseQuizData(c) !== null, [c]);
  const isTrainerCard = React.useMemo(() => c.card_type === 'trainer' || (!isQuizCard && /\{([^}]+)\}/.test(c.front || '')), [c, isQuizCard]);

  const isLikelyLong = (c.front || '').length > 160 || (c.front || '').split('\n').length > 4;
  const showExpandBtn = isLikelyLong || isExpanded;

  const handleItemClick = () => {
    const container = document.getElementById('app-container');
    if (container) useUiStore.getState().setCardsScrollTop(container.scrollTop);
    useUiStore.getState().setLastSelectedCardId(c.id);
    startStudyCard(currentDeck, c.id);
  };

  return (
    <Reorder.Item
      key={c.id}
      value={c}
      as="div"
      id={`card-item-${c.id}`}
      className="card-item glass card-item-draggable"
      style={flagStyle}
      dragListener={false}
      dragControls={dragControls}
      whileDrag={{
        scale: 1.02,
        boxShadow: "0 8px 30px rgba(0, 0, 0, 0.3)",
        backgroundColor: "rgba(255, 255, 255, 0.08)",
        cursor: "grabbing"
      }}
    >
      <div 
        className="card-item-text"
        onClick={handleItemClick}
        style={{ cursor: 'pointer', position: 'relative' }}
      >
        <div 
          className={`front-min ${isExpanded ? 'expanded' : ''}`} 
          style={frontTypographyStyle}
        >
          {c.front}
        </div>
        {showExpandBtn && (
          <button
            type="button"
            className="card-expand-btn"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(prev => !prev);
            }}
            title={isExpanded ? "Свернуть текст" : "Развернуть текст"}
          >
            <span>{isExpanded ? 'Свернуть' : 'ещё...'}</span>
            {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        )}
      </div>

      <div className="card-item-footer">
        <div className="card-item-footer-left">
          <div 
            className="deck-drag-handle-bottom" 
            onPointerDown={(e) => { e.stopPropagation(); dragControls.start(e); }}
            onClick={(e) => e.stopPropagation()}
            title="Зажмите и потяните для перетаскивания карточки"
          >
            <GripHorizontal size={20} />
          </div>

          <CardLevelBadge card={c} size="sm" />

          {isQuizCard && (
            <span style={{ 
              fontSize: '0.68rem', 
              fontWeight: 700, 
              color: '#4ade80', 
              background: 'rgba(34, 197, 94, 0.15)', 
              border: '1px solid rgba(34, 197, 94, 0.3)', 
              borderRadius: '6px', 
              padding: '1px 5px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '2px'
            }}>
              ☑️ Тест
            </span>
          )}

          {isTrainerCard && (
            <span style={{ 
              fontSize: '0.68rem', 
              fontWeight: 700, 
              color: '#c084fc', 
              background: 'rgba(168, 85, 247, 0.15)', 
              border: '1px solid rgba(168, 85, 247, 0.3)', 
              borderRadius: '6px', 
              padding: '1px 5px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '2px'
            }}>
              🏋️ Тренажер
            </span>
          )}
        </div>

        <div className="card-item-footer-right">
          {typeof index === 'number' && (
            <span className="card-item-corner-number">
              {index + 1}
            </span>
          )}

          <CardActionButton 
            card={c} 
            size={16} 
            className="card-item-actions-trigger" 
            stopDrag={true} 
          />
        </div>
      </div>
    </Reorder.Item>
  );
});

export const CardList = ({ startTutorial, startStudy, startStudyCard }) => {
  const { t } = useTranslation();
  const { view, setView, setIsSettingsOpen, setIsRenameModalOpen, setDeckToRename, lastSelectedCardId, cardsScrollTop, setCardsScrollTop, setIsBatchModalOpen, showToast } = useUiStore();
  const { currentDeck, deckCards, cardsLoading, folders, handleDeleteDeck, handleResetProgress, handleSyncDeck } = useDeckStore();

  const cardFont = useSettingsStore(s => s.cardFont);
  const cardTextColor = useSettingsStore(s => s.cardTextColor);
  const cardTextShadow = useSettingsStore(s => s.cardTextShadow);
  const cardFontWeight = useSettingsStore(s => s.cardFontWeight);
  const cardFontStyle = useSettingsStore(s => s.cardFontStyle);
  const cardTextAlign = useSettingsStore(s => s.cardTextAlign);

  const frontTypographyStyle = React.useMemo(() => ({
    fontFamily: cardFont || undefined,
    color: cardTextColor || undefined,
    textShadow: getTextShadow(cardTextShadow, cardTextColor),
    fontWeight: cardFontWeight || 600,
    fontStyle: cardFontStyle || undefined,
    textAlign: cardTextAlign || 'left',
  }), [cardFont, cardTextColor, cardTextShadow, cardFontWeight, cardFontStyle, cardTextAlign]);

  const [searchQuery, setSearchQuery] = React.useState('');
  const [isSearchOpen, setIsSearchOpen] = React.useState(false);
  const [isMediaModalOpen, setIsMediaModalOpen] = React.useState(false);
  const [isDeckMenuOpen, setIsDeckMenuOpen] = React.useState(false);
  const [isMoveMenuOpen, setIsMoveMenuOpen] = React.useState(false);
  const [isCopyMenuOpen, setIsCopyMenuOpen] = React.useState(false);
  const deckMenuRef = React.useRef(null);
  const [editingDeckImgSrc, setEditingDeckImgSrc] = React.useState(null);
  const [editingDeckImgIndex, setEditingDeckImgIndex] = React.useState(-1);

  React.useEffect(() => {
    if (!isDeckMenuOpen) return;
    const handleClickOutside = (event) => {
      if (deckMenuRef.current && !deckMenuRef.current.contains(event.target)) {
        setIsDeckMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isDeckMenuOpen]);

  React.useEffect(() => {
    if (!isDeckMenuOpen) {
      setIsMoveMenuOpen(false);
      setIsCopyMenuOpen(false);
    }
  }, [isDeckMenuOpen]);

  const handleShare = async (e) => {
    e?.stopPropagation();
    setIsDeckMenuOpen(false);
    try {
      const result = await useDeckStore.getState().handleShareDeck(currentDeck.id);
      if (result.success) {
        if (result.type === 'copy') showToast('Ссылка скопирована!', 'success');
        else if (result.type === 'telegram') showToast('Открываем Telegram Share...', 'success');
      }
    } catch {
      showToast('Ошибка при создании ссылки', 'error');
    }
  };

  const handleSync = (e) => {
    e?.stopPropagation();
    setIsDeckMenuOpen(false);
    handleSyncDeck(currentDeck.id);
  };

  const handleRename = (e) => {
    e?.stopPropagation();
    setIsDeckMenuOpen(false);
    setDeckToRename(currentDeck);
    setIsRenameModalOpen(true);
  };

  const handleReset = async (e) => {
    e?.stopPropagation();
    setIsDeckMenuOpen(false);
    if (window.confirm("Это сбросит весь прогресс обучения по этой колоде. Вы уверены?")) {
      try {
        await handleResetProgress(currentDeck.id);
        showToast("Прогресс успешно сброшен", "success");
      } catch {
        showToast("Ошибка при сбросе прогресса");
      }
    }
  };

  const handleDelete = (e) => {
    e?.stopPropagation();
    setIsDeckMenuOpen(false);
    if (window.confirm("Вы уверены, что хотите полностью удалить эту колоду и весь прогресс?")) {
      handleDeleteDeck(currentDeck.id);
      setView('decks');
    }
  };

  const handleReclassifyDeck = async (e) => {
    e?.stopPropagation();
    setIsDeckMenuOpen(false);
    showToast('Обновление уровней колоды...', 'info');
    try {
      const response = await fetch('/api/cards/classify-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deck_id: currentDeck.id, target_language: currentDeck.target_language || 'de' })
      });
      if (response.ok) {
        const data = await response.json();
        useDeckStore.getState().fetchDeckCards(currentDeck.id);
        showToast(`✨ Уровни карточек обновлены! (${data.updated_count || 0} шт.)`, 'success');
      } else {
        showToast('Ошибка при переклассификации');
      }
    } catch {
      showToast('Ошибка сети при переклассификации');
    }
  };

  const handleMoveToFolder = async (e, folderId) => {
    e?.stopPropagation();
    setIsDeckMenuOpen(false);
    setIsMoveMenuOpen(false);
    try {
      await useDeckStore.getState().moveDeckToFolder(currentDeck.id, folderId);
      showToast("Колода перемещена", "success");
    } catch {
      showToast("Ошибка при перемещении колоды", "error");
    }
  };

  const handleCopyToFolder = async (e, folderId) => {
    e?.stopPropagation();
    setIsDeckMenuOpen(false);
    setIsCopyMenuOpen(false);
    try {
      await useDeckStore.getState().copyDeckToFolder(currentDeck.id, folderId);
      showToast("Колода скопирована", "success");
    } catch {
      showToast("Ошибка при копировании колоды", "error");
    }
  };

  const filteredCards = React.useMemo(() => {
    if (!deckCards) return [];
    if (!searchQuery.trim()) return deckCards;
    return deckCards.filter(c => matchCard(c, searchQuery));
  }, [deckCards, searchQuery]);

  const getOriginalIndex = React.useCallback((cardId) => {
    if (!deckCards) return 0;
    const idx = deckCards.findIndex(c => c.id === cardId);
    return idx >= 0 ? idx : 0;
  }, [deckCards]);

  const { uploadDeckResource } = useMediaUpload();
  const { openCreator } = useCardNavigation();
  const isDeckViewActive = ['cards', 'study', 'trainer', 'editor'].includes(view);
  const { collaborators, onlineCount, isShared } = useCollaborativePresence('deck', currentDeck?.id, isDeckViewActive);

  // Memoized Deck Metadata & Resources
  const deckMetadata = React.useMemo(() => parseDeckMetadata(currentDeck), [currentDeck]);
  const deckResources = React.useMemo(() => deckMetadata.resources || [], [deckMetadata]);
  const deckImages = React.useMemo(() => deckResources.filter(r => r.type === 'image'), [deckResources]);
  const deckAudios = React.useMemo(() => deckResources.filter(r => r.type === 'audio'), [deckResources]);
  const deckVideos = React.useMemo(() => deckResources.filter(r => r.type === 'video'), [deckResources]);
  const deckLinks = React.useMemo(() => deckResources.filter(r => r.type === 'link'), [deckResources]);

  // Resizable image height — read from metadata, default 220px
  const getMetaImageHeight = React.useCallback(() => {
    return deckMetadata.imageHeight || 220;
  }, [deckMetadata]);

  const [imageHeight, setImageHeight] = React.useState(getMetaImageHeight);

  // Sync imageHeight when deck changes
  React.useEffect(() => {
    setImageHeight(getMetaImageHeight());
  }, [getMetaImageHeight]);

  const saveImageHeight = React.useCallback(async (h) => {
    if (!currentDeck) return;
    await useDeckStore.getState().updateDeckMetadata(currentDeck.id, { ...deckMetadata, imageHeight: h });
  }, [currentDeck, deckMetadata]);

  const startResizeDrag = React.useCallback((e) => {
    e.preventDefault();
    const startY = e.touches ? e.touches[0].clientY : e.clientY;
    const startH = imageHeight;
    const onMove = (ev) => {
      const clientY = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const delta = clientY - startY;
      const newH = Math.max(80, Math.min(800, startH + delta));
      setImageHeight(newH);
    };
    const onUp = (ev) => {
      const clientY = ev.changedTouches ? ev.changedTouches[0].clientY : ev.clientY;
      const delta = clientY - startY;
      const finalH = Math.max(80, Math.min(800, startH + delta));
      saveImageHeight(Math.round(finalH));
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
  }, [imageHeight, saveImageHeight]);

  const handleToggleShowInCards = async (targetImg, isChecked) => {
    if (!currentDeck) return;
    let metadata = { resources: [] };
    if (currentDeck.metadata) {
      metadata = typeof currentDeck.metadata === 'string'
        ? JSON.parse(currentDeck.metadata)
        : currentDeck.metadata;
    }
    const updatedResources = (metadata.resources || []).map(r => {
      if (r === targetImg || (r.type === 'image' && (r.url === targetImg.url || r.path === targetImg.path))) {
        return { ...r, show_in_cards: isChecked };
      }
      return r;
    });
    await useDeckStore.getState().updateDeckMetadata(currentDeck.id, { ...metadata, resources: updatedResources });
  };

  React.useEffect(() => {
    if (view === 'cards' && currentDeck?.id) {
      useDeckStore.getState().fetchDeckCards(currentDeck.id);
    }
  }, [view, currentDeck?.id]);

  React.useEffect(() => {
    if (view !== 'cards') return;
    const container = document.getElementById('app-container');
    if (!container) return;

    if (cardsScrollTop > 0) {
      container.scrollTop = cardsScrollTop;
    }

    const handleScroll = () => {
      setCardsScrollTop(container.scrollTop);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [view, cardsScrollTop, setCardsScrollTop]);

  React.useEffect(() => {
    if (lastSelectedCardId && view === 'cards') {
      const timer = setTimeout(() => {
        const el = document.getElementById(`card-item-${lastSelectedCardId}`);
        if (el) {
          const rect = el.getBoundingClientRect();
          const inView = rect.top >= 0 && rect.bottom <= window.innerHeight;
          if (!inView) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [lastSelectedCardId, view]);

  if (view !== 'cards') return null;
  if (!currentDeck) {
    return (
      <div className="view-cards" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '350px' }}>
        <Loader2 className="animate-spin" size={32} color="#a855f7" />
      </div>
    );
  }

  return (
    <div className="view-cards">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="view">
        <div className="header-compact header-compact-sticky">
          <button className="back-btn" onClick={() => setView('decks')}><ChevronLeft size={24} /></button>

          <div className="header-actions">
            <UserProfileBadge />
            <button 
              className="header-action-btn" 
              onClick={() => setIsBatchModalOpen(true)} 
              title="Пакетная генерация карточек"
            >
              <ListPlus size={22} />
            </button>

            <HelpButton onClick={() => startTutorial('cards')} />

            {/* Search Toggle Button */}
            <button
              className={`header-action-btn ${isSearchOpen ? 'active' : ''}`}
              onClick={() => {
                setIsSearchOpen(prev => {
                  if (prev) setSearchQuery('');
                  return !prev;
                });
              }}
              title="Поиск карточек"
              style={{
                color: (isSearchOpen || searchQuery) ? '#c084fc' : 'currentColor',
                background: (isSearchOpen || searchQuery) ? 'rgba(168, 85, 247, 0.2)' : undefined,
                borderColor: (isSearchOpen || searchQuery) ? 'rgba(168, 85, 247, 0.5)' : undefined
              }}
            >
              <Search size={20} />
            </button>

            <button 
              className="header-action-btn settings-btn" 
              onClick={() => setIsSettingsOpen(true)}
              title="Настройки"
            >
              <Settings size={22} />
            </button>

            {/* Deck Options Dropdown Menu Button */}
            <div style={{ position: 'relative' }} ref={deckMenuRef}>
              <button 
                className={`header-action-btn ${isDeckMenuOpen ? 'active' : ''}`} 
                onClick={(e) => {
                  e.stopPropagation();
                  setIsDeckMenuOpen(prev => !prev);
                }}
                title="Опции колоды"
                style={{
                  color: isDeckMenuOpen ? '#c084fc' : 'currentColor',
                  background: isDeckMenuOpen ? 'rgba(168, 85, 247, 0.2)' : undefined,
                  borderColor: isDeckMenuOpen ? 'rgba(168, 85, 247, 0.5)' : undefined
                }}
              >
                <MoreHorizontal size={22} />
              </button>

              {isDeckMenuOpen && (
                <div 
                  className="deck-dropdown-menu glass" 
                  style={{
                    top: 'calc(100% + 6px)',
                    bottom: 'auto',
                    right: 0,
                    transformOrigin: 'top right'
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button className="dropdown-item" onClick={() => {
                    setIsDeckMenuOpen(false);
                    setIsMediaModalOpen(true);
                  }}>
                    <span>📎 Ресурсы колоды</span>
                  </button>

                  {!currentDeck?.is_inbox && (
                    <button className="dropdown-item" onClick={handleRename}>
                      <span>✍️ Переименовать</span>
                    </button>
                  )}

                  {!currentDeck?.is_inbox && (
                    <button className="dropdown-item" onClick={() => {
                      setIsDeckMenuOpen(false);
                      useUiStore.getState().setCollaboratorsTarget({ type: 'deck', id: currentDeck.id, name: currentDeck.name });
                      useUiStore.getState().setIsCollaboratorsModalOpen(true);
                    }}>
                      <span>👥 Совместный доступ</span>
                    </button>
                  )}

                  {!currentDeck?.is_inbox && (
                    <button className="dropdown-item" onClick={handleShare}>
                      <span>🔗 Поделиться</span>
                    </button>
                  )}

                  {!currentDeck?.is_inbox && (
                    <button className="dropdown-item" onClick={handleSync}>
                      <span>🔄 {currentDeck?.has_updates ? '❗️ Обновить' : 'Обновить'}</span>
                    </button>
                  )}

                  {!currentDeck?.is_inbox && (
                    <>
                      <button 
                        className={`dropdown-item ${isMoveMenuOpen ? 'active' : ''}`} 
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsMoveMenuOpen(prev => !prev);
                        }}
                      >
                        <span>📁 Переместить в</span>
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
                            className={`dropdown-sub-item ${currentDeck?.folder_id === null ? 'current' : ''}`}
                            onClick={(e) => handleMoveToFolder(e, null)}
                          >
                            <span>Без папки (Главная)</span>
                          </button>
                          {getSortedFolderTree(folders || []).map(f => (
                            <button 
                              key={f.id}
                              className={`dropdown-sub-item ${currentDeck?.folder_id === f.id ? 'current' : ''}`}
                              onClick={(e) => handleMoveToFolder(e, f.id)}
                              style={{ paddingLeft: `${12 + f.depth * 14}px` }}
                            >
                              <span>{f.name}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      <button 
                        className={`dropdown-item ${isCopyMenuOpen ? 'active' : ''}`} 
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsCopyMenuOpen(prev => !prev);
                        }}
                      >
                        <span>📋 Скопировать в</span>
                        <ChevronRight 
                          size={14} 
                          style={{ 
                            marginLeft: 'auto', 
                            transform: isCopyMenuOpen ? 'rotate(90deg)' : 'none',
                            transition: 'transform 0.2s' 
                          }} 
                        />
                      </button>
                      {isCopyMenuOpen && (
                        <div className="dropdown-sub-menu">
                          <button 
                            className={`dropdown-sub-item ${currentDeck?.folder_id === null ? 'current' : ''}`}
                            onClick={(e) => handleCopyToFolder(e, null)}
                          >
                            <span>Без папки (Главная)</span>
                          </button>
                          {getSortedFolderTree(folders || []).map(f => (
                            <button 
                              key={f.id}
                              className={`dropdown-sub-item ${currentDeck?.folder_id === f.id ? 'current' : ''}`}
                              onClick={(e) => handleCopyToFolder(e, f.id)}
                              style={{ paddingLeft: `${12 + f.depth * 14}px` }}
                            >
                              <span>{f.name}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      <button className="dropdown-item" onClick={handleReclassifyDeck}>
                        <span>✨ Обновить CEFR-уровни</span>
                      </button>
                      <button className="dropdown-item warning" onClick={handleReset}>
                        <span>🧹 Сбросить прогресс</span>
                      </button>
                      <button className="dropdown-item danger" onClick={handleDelete}>
                        <span>🗑️ Удалить колоду</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Expandable Search Input in CardList */}
        {isSearchOpen && (
          <div style={{ padding: '0 15px', marginTop: '10px', marginBottom: '4px' }}>
            <SearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder={t('cards.search_placeholder', 'Поиск по слову, переводу...')}
              count={filteredCards.length}
              total={deckCards?.length || 0}
              countLabel={t('cards.search_found', { count: filteredCards.length, total: deckCards?.length || 0 })}
              autoFocus={true}
            />
          </div>
        )}

        {isShared && (
          <div style={{ padding: '0 15px', marginTop: '4px', marginBottom: '2px' }}>
            <CollaboratorPresenceBar collaborators={collaborators} onlineCount={onlineCount} isShared={isShared} />
          </div>
        )}

        {/* 2-line Hero Study Deck Button */}
        <div style={{ padding: '0 15px', marginTop: '6px', marginBottom: '8px' }}>
          <button 
            className="btn btn-primary btn-full study-deck-hero-btn"
            style={{ 
              display: 'flex', 
              flexDirection: 'column',
              alignItems: 'center', 
              justifyContent: 'center', 
              gap: '6px',
              padding: '14px 18px',
              borderRadius: '18px',
              background: 'linear-gradient(135deg, #a855f7 0%, #6366f1 100%)',
              boxShadow: '0 8px 24px rgba(168, 85, 247, 0.38)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              cursor: (!deckCards || deckCards.length === 0) ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
              width: '100%',
              boxSizing: 'border-box'
            }}
            onClick={() => startStudy(currentDeck)}
            disabled={!deckCards || deckCards.length === 0}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '1.05rem', fontWeight: 700, color: '#ffffff' }}>
              <Play size={20} fill="currentColor" />
              <span>Учить колоду ({deckCards?.length || 0})</span>
            </div>
            <div style={{ 
              fontSize: '1.05rem', 
              fontWeight: 700, 
              color: '#ffffff',
              textAlign: 'center',
              wordBreak: 'break-word',
              lineHeight: 1.35,
              width: '100%'
            }}>
              {currentDeck?.name}
            </div>
          </button>
        </div>

        {deckImages.length > 0 && (
          <div className="deck-images-gallery" style={{
            margin: '4px 15px 8px 15px',
            display: 'flex',
            gap: '10px',
            overflowX: 'auto',
            paddingBottom: '4px',
            scrollSnapType: 'x mandatory',
            WebkitOverflowScrolling: 'touch'
          }}>
            {deckImages.map((img, idx) => {
              const imgSrc = getResourceSrc(img, 'images');
              const resourceIndex = deckResources.findIndex(r => r === img || (r.type === 'image' && (r.url === img.url || r.path === img.path)));
              return (
                <div key={idx} style={{ flex: '0 0 100%', maxWidth: '100%', scrollSnapAlign: 'start' }}>
                  <div className="glass" style={{
                    position: 'relative',
                    borderRadius: '16px',
                    overflow: 'hidden',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(0, 0, 0, 0.25)'
                  }}>
                    <img 
                      src={imgSrc} 
                      alt="" 
                      style={{ 
                        display: 'block',
                        width: '100%', 
                        height: 'auto',
                        maxHeight: `${imageHeight}px`, 
                        objectFit: 'contain',
                        cursor: 'zoom-in' 
                      }} 
                      onClick={() => window.open(imgSrc, '_blank')}
                    />

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingDeckImgSrc(imgSrc);
                              setEditingDeckImgIndex(resourceIndex >= 0 ? resourceIndex : idx);
                            }}
                            style={{
                              position: 'absolute',
                              top: '8px',
                              right: '8px',
                              background: 'rgba(0, 0, 0, 0.7)',
                              backdropFilter: 'blur(6px)',
                              border: '1px solid rgba(255, 255, 255, 0.25)',
                              color: '#e9d5ff',
                              padding: '4px 10px',
                              borderRadius: '8px',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '5px',
                              zIndex: 2,
                              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                              transition: 'all 0.2s'
                            }}
                            onMouseOver={e => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.85)'}
                            onMouseOut={e => e.currentTarget.style.background = 'rgba(0, 0, 0, 0.7)'}
                            title="Редактировать изображение списка"
                          >
                            <Crop size={13} />
                            <span>Изменить</span>
                          </button>

                          {deckImages.length > 1 && (
                            <div style={{
                              position: 'absolute',
                              top: '8px',
                              left: '8px',
                              background: 'rgba(0, 0, 0, 0.65)',
                              color: 'white',
                              fontSize: '0.72rem',
                              padding: '2px 8px',
                              borderRadius: '8px',
                              fontWeight: 600
                            }}>
                              {idx + 1} / {deckImages.length}
                            </div>
                          )}
                        </div>

                        {/* Resize handle */}
                        <div
                          onMouseDown={startResizeDrag}
                          onTouchStart={startResizeDrag}
                          title="Потяни чтобы изменить высоту"
                          style={{
                            height: '14px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'ns-resize',
                            margin: '2px 0',
                            userSelect: 'none',
                            touchAction: 'none'
                          }}
                        >
                          <div style={{
                            width: '48px',
                            height: '4px',
                            borderRadius: '2px',
                            background: 'rgba(168, 85, 247, 0.5)',
                            transition: 'background 0.2s'
                          }}
                          onMouseOver={e => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.9)'}
                          onMouseOut={e => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.5)'}
                          />
                        </div>

                        {/* Toggle switch for showing image in every card */}
                        <label 
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '8px',
                            marginTop: '4px',
                            padding: '6px 12px',
                            borderRadius: '12px',
                            background: 'rgba(255, 255, 255, 0.04)',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            cursor: 'pointer',
                            userSelect: 'none',
                            width: '100%',
                            boxSizing: 'border-box'
                          }}
                        >
                          <span style={{ fontSize: '0.78rem', color: '#e2e8f0', fontWeight: 500 }}>
                            Показывать картинку в каждой карточке
                          </span>
                          <input
                            type="checkbox"
                            checked={img.show_in_cards !== false}
                            onChange={(e) => handleToggleShowInCards(img, e.target.checked)}
                            style={{
                              width: '16px',
                              height: '16px',
                              accentColor: '#a855f7',
                              cursor: 'pointer'
                            }}
                          />
                        </label>
                      </div>
                    );
                  })}
                </div>
              )}

        {deckAudios.map((aud, idx) => (
          <DeckAudioPlayer key={idx} url={aud.url} title={aud.title} />
        ))}

        {deckVideos.map((vid, idx) => (
          <div key={idx} className="glass" style={{
            margin: '0 15px 10px 15px',
            borderRadius: '16px',
            overflow: 'hidden',
            border: '1px solid rgba(251, 113, 133, 0.2)',
            background: '#000'
          }}>
            <video 
              src={vid.url} 
              controls 
              playsInline
              style={{ width: '100%', maxHeight: '200px', display: 'block', objectFit: 'contain' }} 
            />
          </div>
        ))}

        {deckLinks.length > 0 && (
          <div style={{
            margin: '0 15px 10px 15px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px'
          }}>
            {deckLinks.map((lnk, idx) => (
              <a
                key={idx}
                href={lnk.url}
                target="_blank"
                rel="noopener noreferrer"
                className="glass"
                style={{
                  padding: '6px 12px',
                  borderRadius: '10px',
                  fontSize: '0.8rem',
                  color: '#34d399',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  textDecoration: 'none',
                  border: '1px solid rgba(52, 211, 153, 0.2)'
                }}
              >
                <ExternalLink size={14} />
                <span>{lnk.title || lnk.url}</span>
              </a>
            ))}
          </div>
        )}

        <div id="tut-card-list-content" className="card-list">
          {cardsLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
              <div className="cards-loading-state glass">
                <RefreshCw size={32} className="spin" color="#a855f7" />
                <h3>Загрузка карточек...</h3>
                <p>Получаем список карточек из базы данных</p>
              </div>
              {[1, 2, 3].map(idx => (
                <div key={idx} className="card-item glass card-skeleton" style={{ opacity: 0.6 }}>
                  <div className="card-item-text">
                    <div className="skeleton-line" style={{ width: '65%', height: '14px', marginBottom: '8px' }} />
                    <div className="skeleton-line" style={{ width: '45%', height: '10px' }} />
                  </div>
                  <div className="card-item-actions">
                    <div className="skeleton-action" />
                    <div className="skeleton-action" />
                    <div className="skeleton-action" />
                  </div>
                </div>
              ))}
            </div>
          ) : deckCards.length === 0 ? (
            <div className="empty-cards-state glass">
              <h3>В этой колоде пока нет карточек</h3>
              <p>Нажмите на "+" в правом верхнем углу или на кнопку ниже, чтобы создать свою первую карточку.</p>
              <button 
                className="btn btn-primary" 
                style={{ marginTop: '10px' }} 
                onClick={() => openCreator(currentDeck?.id)}
              >
                Создать карточку
              </button>
            </div>
          ) : filteredCards.length === 0 ? (
            <div className="search-empty-state glass">
              <Search size={32} opacity={0.4} color="#a855f7" />
              <h3>{t('cards.search_empty_title', 'Карточки не найдены')}</h3>
              <p>{t('cards.search_empty_desc', 'По вашему запросу ничего не найдено')}</p>
              <button 
                type="button" 
                className="btn btn-secondary" 
                style={{ padding: '8px 16px', fontSize: '0.85rem', marginTop: '4px' }}
                onClick={() => setSearchQuery('')}
              >
                {t('cards.search_clear', 'Сбросить поиск')}
              </button>
            </div>
          ) : (
            <Reorder.Group
              as="div"
              axis="y"
              values={filteredCards}
              onReorder={(newOrder) => {
                if (!searchQuery.trim()) {
                  const orderedIds = newOrder.map(c => c.id);
                  useDeckStore.getState().reorderCards(orderedIds);
                }
              }}
              className="card-list"
            >
              {filteredCards.map((c, idx) => (
                <DraggableCardItem 
                  key={c.id} 
                  c={c} 
                  index={searchQuery.trim() ? getOriginalIndex(c.id) : idx}
                  currentDeck={currentDeck} 
                  startStudyCard={startStudyCard}
                  frontTypographyStyle={frontTypographyStyle}
                />
              ))}
            </Reorder.Group>
          )}
        </div>
        
        <button id="tut-fab-add" className="fab-add-card" onClick={() => openCreator(currentDeck?.id)}>
          <Plus size={28} />
        </button>

        <DeckMediaModal 
          isOpen={isMediaModalOpen} 
          onClose={() => setIsMediaModalOpen(false)} 
        />

        <ImageEditorModal
          isOpen={!!editingDeckImgSrc}
          onClose={() => {
            setEditingDeckImgSrc(null);
            setEditingDeckImgIndex(-1);
          }}
          imageSrc={editingDeckImgSrc}
          onSave={async (editedFile) => {
            setEditingDeckImgSrc(null);
            if (editedFile && currentDeck?.id) {
              await uploadDeckResource(editedFile, 'image', currentDeck.id, editingDeckImgIndex);
            }
          }}
          title="Настройка фото списка"
        />
      </motion.div>
    </div>
  );
};
