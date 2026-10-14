import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useState, useEffect, useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Folder, GripHorizontal, MoreHorizontal, ChevronRight, Users } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import { useDeckStore } from '../../store/useDeckStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { useAuthStore } from '../../store/useAuthStore';
import api from '../../services/api';
import { renderFlag } from './FlagIcons';
import { getSortedFolderTree, getDescendantFolderIds, getFolderContentStats } from '../../utils/deckUtils';

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
  const isAdmin = useAuthStore(state => state.userProfile?.is_admin);
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


  const handleTogglePublish = async (e) => {
    e.stopPropagation();
    setIsMenuOpen(false);
    const newScope = folder.is_global_readonly ? 'private' : 'global_readonly';
    try {
      await api.post(`/collaborative/admin/folders/${folder.id}/access-scope`, { access_scope: newScope });
      showToast(folder.is_global_readonly ? 'Папка скрыта из общего доступа' : 'Папка опубликована', 'success');
      useDeckStore.getState().fetchDecks(true);
    } catch (err) {
      console.error(err);
      showToast('Ошибка публикации', 'error');
    }
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    setIsMenuOpen(false);
    if (window.confirm(tr("Удалить папку? Папка и все колоды внутри неё будут перемещены в корзину."))) {
      useDeckStore.getState().deleteFolder(folder.id);
      showToast(tr("Папка перемещена в корзину"), "success");
    }
  };

  const descendantFolderIds = getDescendantFolderIds(folder.id, folders || []);
  const validTargetFolders = getSortedFolderTree(folders || [], folder.id, descendantFolderIds);

  const {
    childFoldersCount,
    childDecksCount,
    isBranchEmpty
  } = getFolderContentStats(folder.id, folders || [], decks || []);

  const baseFolderColor = folder.color || '#ffd043';
  const folderColor = isBranchEmpty ? '#94a3b8' : baseFolderColor;

  const folderStyle = {
    '--folder-color': folderColor,
    '--folder-color-border': isBranchEmpty ? 'rgba(148, 163, 184, 0.28)' : `${folderColor}5a`,
    '--folder-color-hover': isBranchEmpty ? '#cbd5e1' : folderColor,
    '--folder-color-shadow': isBranchEmpty ? 'rgba(0, 0, 0, 0.2)' : `${folderColor}4d`,
    '--folder-color-bg-tint': isBranchEmpty ? 'rgba(148, 163, 184, 0.08)' : `${folderColor}14`
  };

  const folderLang = folder.target_language || useLanguageStore.getState().activeLanguage || 'de';
  const canEditFolder = folder.role === 'owner' || folder.role === 'editor';

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: folder.id,
    disabled: !canEditFolder,
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
      className={`deck-card glass folder-card-item ${isBranchEmpty ? 'folder-card-empty' : ''} ${isMenuOpen ? 'has-open-menu' : ''} ${isDragging ? 'is-dragging' : ''}`}
      style={style}
    >
      <div className="deck-main-action" onClick={() => {
        if (folder.target_language && folder.target_language !== useLanguageStore.getState().activeLanguage) {
          useLanguageStore.getState().setLanguage(folder.target_language);
        }
        setActiveFolderId(folder.id);
      }}>

        <div className="deck-info-row">
          <div className={`deck-icon ${isBranchEmpty ? 'folder-icon-muted' : 'folder-icon-glow'}`}>
            <Folder size={24} color={folderColor} fill={folderColor} fillOpacity={isBranchEmpty ? 0.12 : 0.2} />
          </div>
          <h3>
            <span className="deck-title-text">{folder.name === '📥 Входящие' ? tr("📥 Входящие") : folder.name}</span>
          </h3>
        </div>
      </div>

      <div className="deck-footer-actions">
        <div className="deck-footer-actions-left">
          {canEditFolder && <div
            className="deck-drag-handle-bottom"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            title={tr("Зажмите и потяните для перетаскивания папки")}
          >
            <GripHorizontal size={20} />
          </div>}

          <div 
            className="deck-flag-badge-inline"
            title={tr("Язык: {{p0}}", { p0: folderLang.toUpperCase() })}
          >
            {renderFlag(folderLang, 26)}
          </div>

          {childFoldersCount > 0 && (
            <span 
              className="folder-badge-item"
              title={tr("Вложенных папок: {{p0}}", { p0: childFoldersCount })}
              style={{ 
                fontSize: '0.72rem', 
                fontWeight: 700, 
                color: folderColor, 
                background: `${folderColor}18`, 
                border: `1px solid ${folderColor}45`, 
                borderRadius: '7px', 
                padding: '2px 8px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <span>📁</span>
              <span>
                {childFoldersCount} {childFoldersCount === 1 ? tr("папка") : childFoldersCount > 1 && childFoldersCount < 5 ? tr("папки") : tr("папок")}
              </span>
            </span>
          )}

          {isBranchEmpty && childFoldersCount === 0 ? (
            <span 
              className="folder-badge-item empty-state-badge"
              style={{ 
                fontSize: '0.72rem', 
                fontWeight: 700, 
                color: folderColor, 
                background: `${folderColor}18`, 
                border: `1px solid ${folderColor}45`, 
                borderRadius: '7px', 
                padding: '2px 8px',
                display: 'inline-flex',
                alignItems: 'center'
              }}
            >
              {tr("Пусто")}
            </span>
          ) : (
            <span 
              className="folder-badge-item"
              style={{ 
                fontSize: '0.72rem', 
                fontWeight: 700, 
                color: folderColor, 
                background: `${folderColor}18`, 
                border: `1px solid ${folderColor}45`, 
                borderRadius: '7px', 
                padding: '2px 8px',
                display: 'inline-flex',
                alignItems: 'center'
              }}
            >
              {childDecksCount} {childDecksCount === 1 ? tr("колода") : childDecksCount > 1 && childDecksCount < 5 ? tr("колоды") : tr("колод")}
            </span>
          )}

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
          {(canEditFolder || isAdmin) && (
            <button 
              className={`card-item-actions-trigger ${isMenuOpen ? 'active' : ''}`}
              onClick={toggleMenu}
              title={tr("Опции папки")}
            >
              <MoreHorizontal size={18} />
            </button>
          )}
        </div>

        {isMenuOpen && (
          <div className={`deck-dropdown-menu glass placement-${menuPlacement}`} ref={menuRef} onClick={(e) => e.stopPropagation()}>

            {isAdmin && (
              <button className="dropdown-item" onClick={handleTogglePublish} style={{ color: '#8b5cf6', fontWeight: 600 }}>
                <span>{folder.is_global_readonly ? '🔐 Скрыть из общего доступа' : '🌍 Опубликовать глобально'}</span>
              </button>
            )}
            {canEditFolder && <>
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
            </>}
          </div>
        )}
      </div>
    </div>
  );
});
