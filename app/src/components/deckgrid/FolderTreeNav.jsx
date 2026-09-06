import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useState, useEffect, useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Folder, GripHorizontal, MoreHorizontal, ChevronRight, Users } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import { useDeckStore } from '../../store/useDeckStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { renderFlag } from './FlagIcons';
import { getSortedFolderTree, getDescendantFolderIds } from '../../utils/deckUtils';

export const FolderCardItem = React.memo(({
  folder,
  setActiveFolderId,
  decks,
  folders,
  showToast
}) => {
  useInterfaceLocale();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isMoveMenuOpen, setIsMoveMenuOpen] = useState(false);
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
      setIsMoveMenuOpen(false);
    }
  }, [isMenuOpen]);

  const childDecks = decks.filter(d => d.folder_id === folder.id);
  const totalDecksCount = childDecks.length;
  const folderColor = folder.color || '#ffd043';

  const handleShare = async (e) => {
    e.stopPropagation();
    setIsMenuOpen(false);
    
    try {
      const result = await useDeckStore.getState().handleShareFolder(folder.id);
      if (result.success) {
        if (result.type === 'copy') showToast(tr("Ссылка на папку скопирована!"), 'success');
        else if (result.type === 'telegram') showToast(tr("Открываем Telegram Share..."), 'success');
        else if (result.type === 'share') showToast(tr("Папка отправлена!"), 'success');
      }
    } catch (err) {
      console.error("Error sharing folder:", err);
      showToast(tr("Ошибка при создании ссылки на папку"), "error");
    }
  };

  const handleRename = (e) => {
    e.stopPropagation();
    setIsMenuOpen(false);
    const newName = window.prompt(tr("Введите новое название папки:"), folder.name);
    if (newName && newName.trim()) {
      useDeckStore.getState().renameFolder(folder.id, newName.trim());
      showToast(tr("Папка переименована"), "success");
    }
  };

  const handleMove = async (e, parentId) => {
    e.stopPropagation();
    setIsMenuOpen(false);
    setIsMoveMenuOpen(false);
    try {
      await useDeckStore.getState().moveFolder(folder.id, parentId);
      showToast(tr("Папка перемещена"), "success");
    } catch {
      showToast(tr("Ошибка при перемещении папки"), "error");
    }
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    setIsMenuOpen(false);
    if (window.confirm(tr("Удалить папку? Колоды внутри папки останутся и переместятся на верхний уровень."))) {
      useDeckStore.getState().deleteFolder(folder.id);
      showToast(tr("Папка удалена"), "success");
    }
  };

  const descendantFolderIds = getDescendantFolderIds(folder.id, folders || []);
  const validTargetFolders = getSortedFolderTree(folders || [], folder.id, descendantFolderIds);

  const folderStyle = {
    '--folder-color': folderColor,
    '--folder-color-border': `${folderColor}5a`,
    '--folder-color-hover': folderColor,
    '--folder-color-shadow': `${folderColor}4d`,
    '--folder-color-bg-tint': `${folderColor}14`
  };

  const folderLang = folder.target_language || useLanguageStore.getState().activeLanguage || 'de';

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: folder.id,
    animateLayoutChanges: () => false,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition || undefined,
    opacity: isDragging ? 0.35 : 1,
    zIndex: isDragging ? 999 : undefined,
    ...folderStyle
  };

  return (
    <div
      ref={setNodeRef}
      id={`folder-item-${folder.id}`}
      className={`deck-card glass folder-card-item ${isMenuOpen ? 'has-open-menu' : ''} ${isDragging ? 'is-dragging' : ''}`}
      style={style}
    >
      <div className="deck-main-action" onClick={() => {
        if (folder.target_language && folder.target_language !== useLanguageStore.getState().activeLanguage) {
          useLanguageStore.getState().setLanguage(folder.target_language);
        }
        setActiveFolderId(folder.id);
      }}>

        <div className="deck-info-row">
          <div className="deck-icon folder-icon-glow">
            <Folder size={24} color={folderColor} fill={folderColor} fillOpacity={0.2} />
          </div>
          <h3>
            <span className="deck-title-text">{folder.name === '📥 Входящие' ? tr("📥 Входящие") : folder.name}</span>
          </h3>
        </div>
      </div>

      <div className="deck-footer-actions">
        <div className="deck-footer-actions-left">
          <div
            className="deck-drag-handle-bottom"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            title={tr("Зажмите и потяните для перетаскивания папки")}
          >
            <GripHorizontal size={20} />
          </div>

          <div 
            className="deck-flag-badge-inline"
            title={tr("Язык: {{p0}}", { p0: folderLang.toUpperCase() })}
          >
            {renderFlag(folderLang, 26)}
          </div>

          <span style={{ 
            fontSize: '0.72rem', 
            fontWeight: 700, 
            color: folderColor, 
            background: `${folderColor}18`, 
            border: `1px solid ${folderColor}45`, 
            borderRadius: '7px', 
            padding: '2px 8px',
            display: 'inline-flex',
            alignItems: 'center'
          }}>
            {totalDecksCount} {totalDecksCount === 1 ? tr("колода") : totalDecksCount > 1 && totalDecksCount < 5 ? tr("колоды") : tr("колод")}
          </span>

          {folder.is_shared && (
            <div 
              title={tr("Совместный доступ")}
              onClick={(e) => {
                e.stopPropagation();
                useUiStore.getState().setCollaboratorsTarget({ type: 'folder', id: folder.id, name: folder.name });
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
            title={tr("Опции папки")}
          >
            <MoreHorizontal size={18} />
          </button>
        </div>

        {isMenuOpen && (
          <div className={`deck-dropdown-menu glass placement-${menuPlacement}`} ref={menuRef} onClick={(e) => e.stopPropagation()}>
            <button className="dropdown-item" onClick={(e) => {
              e.stopPropagation();
              setIsMenuOpen(false);
              useUiStore.getState().setCollaboratorsTarget({ type: 'folder', id: folder.id, name: folder.name });
              useUiStore.getState().setIsCollaboratorsModalOpen(true);
            }}>
              <span>{tr("👥 Совместный доступ")}</span>
            </button>
            <button className="dropdown-item" onClick={handleShare}>
              <span>{tr("🔗 Поделиться содержимым")}</span>
            </button>
            <button className="dropdown-item" onClick={handleRename}>
              <span>{tr("✍️ Переименовать")}</span>
            </button>

            
            <button 
              className={`dropdown-item ${isMoveMenuOpen ? 'active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setIsMoveMenuOpen(!isMoveMenuOpen);
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
                  className={`dropdown-sub-item ${folder.parent_id === null ? 'current' : ''}`}
                  onClick={(e) => handleMove(e, null)}
                >
                  <span>{tr("Без папки (Главная)")}</span>
                </button>
                {validTargetFolders.map(f => (
                  <button 
                    key={f.id}
                    className={`dropdown-sub-item ${folder.parent_id === f.id ? 'current' : ''}`}
                    onClick={(e) => handleMove(e, f.id)}
                    style={{ paddingLeft: `${12 + f.depth * 14}px` }}
                  >
                    <span>{f.name}</span>
                  </button>
                ))}
              </div>
            )}

            <button className="dropdown-item danger" onClick={handleDelete}>
              <span>{tr("🗑️ Удалить папку")}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
