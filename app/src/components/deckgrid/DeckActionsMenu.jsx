import React from 'react';
import { MoreHorizontal, ChevronRight } from 'lucide-react';
import { tr } from '../../i18n/locale';
import { useUiStore } from '../../store/useUiStore';
import { useDeckStore } from '../../store/useDeckStore';
import { getSortedFolderTree } from '../../utils/deckUtils';
import { reclassifyDeck } from '../../services/reclassificationService.js';

export const DeckActionsMenu = ({ currentDeck, canEditContent, folders, onOpenMedia }) => {
  const { setView, setIsRenameModalOpen, setDeckToRename, showToast } = useUiStore();
  const { handleDeleteDeck, handleResetProgress, handleSyncDeck } = useDeckStore();

  const [isDeckMenuOpen, setIsDeckMenuOpen] = React.useState(false);
  const [isMoveMenuOpen, setIsMoveMenuOpen] = React.useState(false);
  const [isCopyMenuOpen, setIsCopyMenuOpen] = React.useState(false);
  const deckMenuRef = React.useRef(null);

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
        if (result.type === 'copy') showToast(tr("Ссылка скопирована!"), 'success');
        else if (result.type === 'telegram') showToast(tr("Открываем Telegram Share..."), 'success');
      }
    } catch {
      showToast(tr("Ошибка при создании ссылки"), 'error');
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
    if (window.confirm(tr("Это сбросит весь прогресс обучения по этой колоде. Вы уверены?"))) {
      try {
        await handleResetProgress(currentDeck.id);
        showToast(tr("Прогресс успешно сброшен"), "success");
      } catch {
        showToast(tr("Ошибка при сбросе прогресса"));
      }
    }
  };

  const handleDelete = (e) => {
    e?.stopPropagation();
    setIsDeckMenuOpen(false);
    if (window.confirm(tr("Вы уверены, что хотите полностью удалить эту колоду и весь прогресс?"))) {
      handleDeleteDeck(currentDeck.id);
      setView('decks');
    }
  };

  const handleReclassifyDeck = async (e) => {
    e?.stopPropagation();
    setIsDeckMenuOpen(false);
    await reclassifyDeck(currentDeck, { showToast, refresh: useDeckStore.getState().fetchDeckCards });
  };

  const handleMoveToFolder = async (e, folderId) => {
    e?.stopPropagation();
    setIsDeckMenuOpen(false);
    setIsMoveMenuOpen(false);
    try {
      await useDeckStore.getState().moveDeckToFolder(currentDeck.id, folderId);
      showToast(tr("Колода перемещена"), "success");
    } catch {
      showToast(tr("Ошибка при перемещении колоды"), "error");
    }
  };

  const handleCopyToFolder = async (e, folderId) => {
    e?.stopPropagation();
    setIsDeckMenuOpen(false);
    setIsCopyMenuOpen(false);
    try {
      await useDeckStore.getState().copyDeckToFolder(currentDeck.id, folderId);
      showToast(tr("Колода скопирована"), "success");
    } catch {
      showToast(tr("Ошибка при копировании колоды"), "error");
    }
  };

  return (
    <div style={{ position: 'relative' }} ref={deckMenuRef}>
      <button
        className={`header-action-btn ${isDeckMenuOpen ? 'active' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          setIsDeckMenuOpen(prev => !prev);
        }}
        title={tr("Опции колоды")}
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
          {canEditContent && <button className="dropdown-item" onClick={() => {
            setIsDeckMenuOpen(false);
            onOpenMedia();
          }}>
            <span>{tr("📎 Ресурсы колоды")}</span>
          </button>}

          {canEditContent && !currentDeck?.is_inbox && (
            <button className="dropdown-item" onClick={handleRename}>
              <span>{tr("✍️ Переименовать")}</span>
            </button>
          )}

          {canEditContent && !currentDeck?.is_inbox && (
            <button className="dropdown-item" onClick={() => {
              setIsDeckMenuOpen(false);
              useUiStore.getState().setCollaboratorsTarget({ type: 'deck', id: currentDeck.id, name: currentDeck.name });
              useUiStore.getState().setIsCollaboratorsModalOpen(true);
            }}>
              <span>{tr("👥 Совместный доступ")}</span>
            </button>
          )}

          {canEditContent && !currentDeck?.is_inbox && (
            <button className="dropdown-item" onClick={handleShare}>
              <span>{tr("🔗 Поделиться")}</span>
            </button>
          )}

          {canEditContent && !currentDeck?.is_inbox && (
            <button className="dropdown-item" onClick={handleSync}>
              <span>🔄 {currentDeck?.has_updates ? tr("❗️ Обновить") : tr("Обновить")}</span>
            </button>
          )}

          {canEditContent && !currentDeck?.is_inbox && (
            <>
              <button
                className={`dropdown-item ${isMoveMenuOpen ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsMoveMenuOpen(prev => !prev);
                }}
              >
                <span>{tr("📁 Переместить в")}</span>
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
                    <span>{tr("Без папки (Главная)")}</span>
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
                <span>{tr("📋 Скопировать в")}</span>
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
                    <span>{tr("Без папки (Главная)")}</span>
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
                <span>{tr("✨ Обновить CEFR-уровни")}</span>
              </button>
              <button className="dropdown-item danger" onClick={handleDelete}>
                <span>{tr("🗑️ Удалить колоду")}</span>
              </button>
            </>
          )}
          {!currentDeck?.is_inbox && (
            <button className="dropdown-item warning" onClick={handleReset}>
              <span>{tr("🧹 Сбросить прогресс")}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
