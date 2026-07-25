import React, { useState, useEffect, useRef } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { Folder, FolderOpen, GripVertical, MoreHorizontal, ChevronRight } from 'lucide-react';
import { useDeckStore } from '../../store/useDeckStore';
import api from '../../services/api';

const getDescendantFolderIds = (folderId, foldersList) => {
  const descendantIds = [];
  const traverse = (parentId) => {
    const children = foldersList.filter(f => f.parent_id === parentId);
    for (const child of children) {
      descendantIds.push(child.id);
      traverse(child.id);
    }
  };
  traverse(folderId);
  return descendantIds;
};

const getSortedFolderTree = (foldersList, excludeId = null, excludeDescendantIds = []) => {
  const result = [];
  const traverse = (parentId, depth) => {
    const children = foldersList.filter(f => f.parent_id === parentId);
    for (const child of children) {
      if (child.id === excludeId || excludeDescendantIds.includes(child.id)) {
        continue;
      }
      result.push({
        ...child,
        depth: depth,
        displayName: `${'\u00A0'.repeat(depth * 3)}${child.name}`
      });
      traverse(child.id, depth + 1);
    }
  };
  traverse(null, 0);
  return result;
};

export const FolderCardItem = ({
  folder,
  setActiveFolderId,
  decks,
  folders,
  showToast
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

  const childDecks = decks.filter(d => d.folder_id === folder.id);
  const totalDecksCount = childDecks.length;
  const folderColor = folder.color || '#ffd043';

  const handleShare = async (e) => {
    e.stopPropagation();
    setIsMenuOpen(false);
    
    if (childDecks.length === 0) {
      showToast("В папке нет колод для отправки", "info");
      return;
    }

    try {
      if (childDecks.length === 1) {
        const deck = childDecks[0];
        const result = await useDeckStore.getState().handleShareDeck(deck.id);
        if (result.success) {
          if (result.type === 'copy') showToast('Ссылка скопирована!', 'success');
          else if (result.type === 'telegram') showToast('Открываем Telegram Share...', 'success');
        }
      } else {
        showToast("Генерируем ссылки для колод...", "info");
        const links = [];
        for (const deck of childDecks) {
          const res = await api.post(`/share/generate/deck/${deck.id}`);
          if (res.data.status === 'ok') {
            links.push({ name: deck.name, url: `${window.location.origin}/api/share/v/${res.data.share_id}` });
          }
        }
        
        if (links.length > 0) {
          const text = `📁 Папка «${folder.name}»:\n` + links.map(l => `📚 ${l.name}: ${l.url}`).join('\n');
          await navigator.clipboard.writeText(text);
          showToast("Ссылки на все колоды скопированы!", "success");
        } else {
          showToast("Не удалось создать ссылки", "error");
        }
      }
    } catch (err) {
      showToast("Ошибка при создании ссылок", "error");
    }
  };

  const handleRename = (e) => {
    e.stopPropagation();
    setIsMenuOpen(false);
    const newName = window.prompt("Введите новое название папки:", folder.name);
    if (newName && newName.trim()) {
      useDeckStore.getState().renameFolder(folder.id, newName.trim());
      showToast("Папка переименована", "success");
    }
  };

  const handleMove = async (e, parentId) => {
    e.stopPropagation();
    setIsMenuOpen(false);
    setIsMoveMenuOpen(false);
    try {
      await useDeckStore.getState().moveFolder(folder.id, parentId);
      showToast("Папка перемещена", "success");
    } catch (err) {
      showToast("Ошибка при перемещении папки", "error");
    }
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    setIsMenuOpen(false);
    if (window.confirm("Удалить папку? Колоды внутри папки останутся и переместятся на верхний уровень.")) {
      useDeckStore.getState().deleteFolder(folder.id);
      showToast("Папка удалена", "success");
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

  return (
    <Reorder.Item
      value={folder}
      dragListener={false}
      dragControls={dragControls}
      className="deck-card glass folder-card-item"
      style={folderStyle}
    >
      <div
        className="deck-drag-handle"
        onPointerDown={(e) => dragControls.start(e)}
        style={{ touchAction: 'none' }}
        title="Перетащить папку"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <GripVertical size={16} />
          <GripVertical size={16} />
        </div>
      </div>

      <div className="deck-main-action" onClick={() => setActiveFolderId(folder.id)}>
        <div className="deck-info-row">
          <div className="deck-icon folder-icon-glow">
            <Folder size={24} color={folderColor} fill={folderColor} fillOpacity={0.2} />
          </div>
          <h3>
            <span className="deck-title-text">{folder.name}</span>
          </h3>
        </div>

        <div className="folder-meta-row" style={{ marginTop: 8, fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.6)' }}>
          <span>{totalDecksCount} {totalDecksCount === 1 ? 'колода' : totalDecksCount > 1 && totalDecksCount < 5 ? 'колоды' : 'колод'}</span>
        </div>
      </div>

      <div className="deck-footer-actions" style={{ justifyContent: 'flex-end', padding: '8px 12px', position: 'relative' }}>
        <button 
          className={`menu-toggle-btn ${isMenuOpen ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setIsMenuOpen(!isMenuOpen);
          }}
          title="Опции папки"
        >
          <MoreHorizontal size={16} />
          <span>Опции</span>
        </button>

        {isMenuOpen && (
          <div className="deck-dropdown-menu glass" ref={menuRef} onClick={(e) => e.stopPropagation()}>
            <button className="dropdown-item" onClick={handleShare}>
              <span>🔗 Поделиться содержимым</span>
            </button>
            <button className="dropdown-item" onClick={handleRename}>
              <span>✍️ Переименовать</span>
            </button>
            
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
                  className={`dropdown-sub-item ${folder.parent_id === null ? 'current' : ''}`}
                  onClick={(e) => handleMove(e, null)}
                >
                  <span>Без папки (Главная)</span>
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
              <span>🗑️ Удалить папку</span>
            </button>
          </div>
        )}
      </div>
    </Reorder.Item>
  );
};
