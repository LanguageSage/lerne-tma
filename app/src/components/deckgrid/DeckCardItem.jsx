import React, { useState, useEffect, useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Layers, Inbox, Pin, GripHorizontal, MoreHorizontal, ChevronRight, Users, Dumbbell } from 'lucide-react';

import { useUiStore } from '../../store/useUiStore';
import { useDeckStore } from '../../store/useDeckStore';
import { useSessionStore } from '../../store/useSessionStore';
import { renderFlag } from './FlagIcons';
import { getSortedFolderTree } from '../../utils/deckUtils';

export const DeckCardItem = React.memo(({
  deck,
  setCurrentDeck,
  fetchDeckCards,
  showToast,
  openSyncModal,
  handleSyncDeck,
  handleResetProgress,
  handleDeleteDeck,
  setDeckToRename,
  setIsRenameModalOpen,
  togglePinDeck,
  folders,
  activeFolderColor
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isMoveMenuOpen, setIsMoveMenuOpen] = useState(false);
  const [isCopyMenuOpen, setIsCopyMenuOpen] = useState(false);
  const [menuPlacement, setMenuPlacement] = useState('bottom');
  const menuRef = useRef(null);

  const toggleMenu = (e) => {
    e.stopPropagation();
    if (!isMenuOpen) {
      const buttonRect = e.currentTarget.getBoundingClientRect();
      if (window.innerHeight - buttonRect.bottom < 360 && buttonRect.top > 360) {
        setMenuPlacement('top');
      } else {
        setMenuPlacement('bottom');
      }
      setIsMenuOpen(true);
    } else {
      setIsMenuOpen(false);
    }
  };

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
      queueMicrotask(() => {
        setIsMoveMenuOpen(false);
        setIsCopyMenuOpen(false);
      });
    }
  }, [isMenuOpen]);

  useEffect(() => {
    if (isMoveMenuOpen) queueMicrotask(() => setIsCopyMenuOpen(false));
  }, [isMoveMenuOpen]);

  useEffect(() => {
    if (isCopyMenuOpen) queueMicrotask(() => setIsMoveMenuOpen(false));
  }, [isCopyMenuOpen]);

  const onMainAction = () => {
    setCurrentDeck(deck);
    useUiStore.getState().setCardsScrollTop(0);
    useUiStore.getState().setLastSelectedCardId(null);
    useUiStore.getState().setView('cards');
    fetchDeckCards(deck.id);
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
    } catch {
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
        const session = useSessionStore.getState();
        if (session.card && session.card.deck_id === deck.id) {
          session.resetSession();
        }
        showToast("Прогресс успешно сброшен", "success");
      } catch {
        showToast("Ошибка при сбросе прогресса");
      }
    }
  };

  const handleToggleLearning = async (e) => {
    e.stopPropagation();
    try {
      const nextStatus = !deck.is_learning;
      await useDeckStore.getState().toggleDeckLearning(deck.id, nextStatus);
      if (nextStatus) {
        showToast(`🔥 Колода «${deck.name}» добавлена в изучаемые`, 'success');
      } else {
        showToast(`Колода «${deck.name}» убрана из изучаемых`, 'info');
      }
    } catch {
      showToast('Ошибка при смене статуса колоды', 'error');
    }
  };


  const handleDelete = (e) => {
    e.stopPropagation();
    setIsMenuOpen(false);
    if (window.confirm("Вы уверены, что хотите полностью удалить эту колоду и весь прогресс?")) {
      handleDeleteDeck(deck.id);
    }
  };

  const handleReclassifyDeck = async (e) => {
    e.stopPropagation();
    setIsMenuOpen(false);
    showToast('Обновление уровней колоды...', 'info');
    try {
      const response = await fetch('/api/cards/classify-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deck_id: deck.id, target_language: deck.target_language || 'de' })
      });
      if (response.ok) {
        const data = await response.json();
        if (fetchDeckCards) fetchDeckCards(deck.id);
        showToast(`✨ Уровни карточек обновлены! (${data.updated_count || 0} шт.)`, 'success');
      } else {
        showToast('Ошибка при переклассификации');
      }
    } catch {
      showToast('Ошибка сети при переклассификации');
    }
  };

  const handlePin = async (e) => {
    e.stopPropagation();
    try {
      await togglePinDeck(deck.id);
      showToast(deck.is_pinned ? 'Колода откреплена' : 'Колода закреплена', 'success');
    } catch {
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
    } catch {
      showToast("Ошибка при перемещении колоды", "error");
    }
  };

  const handleCopyToFolder = async (e, folderId) => {
    e.stopPropagation();
    setIsMenuOpen(false);
    setIsCopyMenuOpen(false);
    try {
      await useDeckStore.getState().copyDeckToFolder(deck.id, folderId);
      showToast("Колода скопирована", "success");
    } catch {
      showToast("Ошибка при копировании колоды", "error");
    }
  };

  const deckStyle = { position: 'relative' };
  if (activeFolderColor) {
    deckStyle['--folder-color'] = activeFolderColor;
    deckStyle['--folder-color-border'] = `${activeFolderColor}5a`;
    deckStyle['--folder-color-hover'] = activeFolderColor;
    deckStyle['--folder-color-shadow'] = `${activeFolderColor}4d`;
    deckStyle['--folder-color-bg-tint'] = `${activeFolderColor}14`;
  }

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: deck.id,
    animateLayoutChanges: () => false,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition || undefined,
    opacity: isDragging ? 0.35 : 1,
    zIndex: isDragging ? 999 : undefined,
    ...deckStyle
  };

  return (
    <div
      ref={setNodeRef}
      id={`deck-item-${deck.id}`}
      className={`deck-card glass ${deck.is_pinned ? 'deck-pinned' : ''} ${deck.is_learning === false ? 'deck-learning-paused' : ''} ${deck.is_inbox ? 'deck-card-inbox' : ''} ${!deck.is_inbox ? 'deck-card-draggable' : ''} ${isMenuOpen ? 'has-open-menu' : ''} ${isDragging ? 'is-dragging' : ''}`}
      style={style}
    >
      <div className="deck-main-action deck-main-action-with-stats" onClick={onMainAction}>
        <div className="deck-info-row">
          <div className="deck-icon">
            {deck.is_inbox ? (
              <Inbox size={24} />
            ) : deck.is_trainer ? (
              <Dumbbell size={24} color="#c084fc" />
            ) : (
              <Layers size={24} />
            )}
          </div>
          
          <h3>
            <span className="deck-title-text">{deck.name}</span>

            {!deck.is_inbox && (
              <button
                type="button"
                className={`pin-deck-btn ${deck.is_pinned ? 'pinned' : ''}`}
                onClick={handlePin}
                title={deck.is_pinned ? "Открепить колоду" : "Закрепить колоду"}
              >
                <Pin size={16} />
              </button>
            )}
          </h3>
        </div>

        <div className="deck-stats-container">
          <div className="deck-stat-item">
            <span className="deck-stat-value total">{deck.stats.total}</span>
            <span className="deck-stat-label">всего</span>
          </div>
          <div className="deck-stat-item">
            <span className="deck-stat-value new">{deck.stats.new}</span>
            <span className="deck-stat-label">новые</span>
          </div>
          <div className="deck-stat-item">
            <span className="deck-stat-value learning">{deck.stats.learning}</span>
            <span className="deck-stat-label">изучаю</span>
          </div>
          <div className="deck-stat-item">
            <span className="deck-stat-value due">{deck.stats.due}</span>
            <span className="deck-stat-label">повторить</span>
          </div>
        </div>
      </div>

      <div className="deck-footer-actions">
        <div className="deck-footer-actions-left">
          {!deck.is_inbox ? (
            <div
              className="deck-drag-handle-bottom"
              {...attributes}
              {...listeners}
              onClick={(e) => e.stopPropagation()}
              title="Зажмите и потяните для перетаскивания колоды"
            >
              <GripHorizontal size={20} />
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600 }}>
                📥 Входящие
              </span>
            </div>
          )}

          {!deck.is_inbox && (
            <div 
              className="deck-flag-badge-inline"
              title={`Язык: ${(deck.target_language || 'de').toUpperCase()}`}
            >
              {renderFlag(deck.target_language || 'de', 26)}
            </div>
          )}

          {!deck.is_inbox && (
            <button
              type="button"
              className={`deck-learning-action-btn ${deck.is_learning ? 'active' : 'inactive'}`}
              onClick={handleToggleLearning}
              title={deck.is_learning ? "Колода в активном изучении (бот напоминает). Нажмите, чтобы отключить" : "Нажмите, чтобы включить колоду в изучение"}
            >
              <span className={`learning-btn-icon ${deck.is_learning ? 'pulse' : ''}`}>
                {deck.is_learning ? '🔥' : '🎯'}
              </span>
              <span className="learning-btn-text">
                {deck.is_learning ? 'Учу' : 'Учить'}
              </span>
            </button>
          )}

          {deck.is_inbox && deck.stats.total > 0 && (
            <span style={{ fontSize: '0.7rem', background: 'rgba(99,102,241,0.3)', color: '#818cf8', padding: '2px 7px', borderRadius: 6, fontWeight: 700 }}>
              новые
            </span>
          )}

          {!deck.is_inbox && deck.is_trainer && (
            <span 
              style={{ 
                fontSize: '0.68rem', 
                background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.25), rgba(124, 58, 237, 0.2))', 
                border: '1px solid rgba(168, 85, 247, 0.45)', 
                color: '#c084fc', 
                padding: '2px 8px', 
                borderRadius: 8, 
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
                verticalAlign: 'middle',
                boxShadow: '0 2px 8px rgba(168, 85, 247, 0.2)'
              }}
            >
              <span>🏋️</span>
              <span>Тренажёр</span>
            </span>
          )}

          {deck.folder_id && folders && (() => {
            const parent = folders.find(f => f.id === deck.folder_id);
            if (!parent) return null;
            return (
              <span 
                className="deck-folder-shortcut-badge"
                title={`Папка: ${parent.name}`}
                style={{ 
                  fontSize: '0.68rem', 
                  background: parent.color ? `${parent.color}22` : 'rgba(255, 255, 255, 0.06)', 
                  border: `1px solid ${parent.color ? parent.color + '55' : 'rgba(255, 255, 255, 0.15)'}`, 
                  color: parent.color || '#cbd5e1', 
                  padding: '2px 7px', 
                  borderRadius: 8, 
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  maxWidth: '130px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                <span>📁</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{parent.name}</span>
              </span>
            );
          })()}

          {deck.is_shared && (
            <div 
              title="Совместный доступ"
              onClick={(e) => {
                e.stopPropagation();
                useUiStore.getState().setCollaboratorsTarget({ type: 'deck', id: deck.id, name: deck.name });
                useUiStore.getState().setIsCollaboratorsModalOpen(true);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '26px',
                height: '26px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, rgba(139,92,246,0.35), rgba(99,102,241,0.25))',
                border: '1px solid rgba(167,139,250,0.5)',
                color: '#c4b5fd',
                boxShadow: '0 0 10px rgba(139,92,246,0.35)',
                cursor: 'pointer'
              }}
            >
              <Users size={14} />
            </div>
          )}
        </div>

        <div className="deck-footer-actions-right">
          <button 
            className={`card-item-actions-trigger ${isMenuOpen ? 'active' : ''}`}
            onClick={toggleMenu}
            title="Опции колоды"
          >
            <MoreHorizontal size={18} />
            {deck.has_updates && !deck.is_inbox && (
              <span className="menu-update-indicator" />
            )}
          </button>
        </div>

        {isMenuOpen && (
          <div className={`deck-dropdown-menu glass placement-${menuPlacement}`} ref={menuRef} onClick={(e) => e.stopPropagation()}>
            {!deck.is_inbox && (
              <button className="dropdown-item" onClick={(e) => {
                e.stopPropagation();
                setIsMenuOpen(false);
                useUiStore.getState().setCollaboratorsTarget({ type: 'deck', id: deck.id, name: deck.name });
                useUiStore.getState().setIsCollaboratorsModalOpen(true);
              }}>
                <span>👥 Совместный доступ</span>
              </button>
            )}

            {!deck.is_inbox && (
              <button className="dropdown-item" onClick={(e) => {
                setIsMenuOpen(false);
                handleToggleLearning(e);
              }}>
                <span>{deck.is_learning ? '⏸ Отключить напоминания (Не учу)' : '🔥 Включить в изучение (Учить)'}</span>
              </button>
            )}

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
                      className={`dropdown-sub-item ${deck.folder_id === null ? 'current' : ''}`}
                      onClick={(e) => handleMoveToFolder(e, null)}
                    >
                      <span>Без папки (Главная)</span>
                    </button>
                    {getSortedFolderTree(folders || []).map(f => (
                      <button 
                        key={f.id}
                        className={`dropdown-sub-item ${deck.folder_id === f.id ? 'current' : ''}`}
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
                    setIsCopyMenuOpen(!isCopyMenuOpen);
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
                      className={`dropdown-sub-item ${deck.folder_id === null ? 'current' : ''}`}
                      onClick={(e) => handleCopyToFolder(e, null)}
                    >
                      <span>Без папки (Главная)</span>
                    </button>
                    {getSortedFolderTree(folders || []).map(f => (
                      <button 
                        key={f.id}
                        className={`dropdown-sub-item ${deck.folder_id === f.id ? 'current' : ''}`}
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
  );
});
