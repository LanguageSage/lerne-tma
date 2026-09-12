import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Move, Copy, Folder, FolderOpen, Layers } from 'lucide-react';
import { getSortedFolderAndDeckTree } from '../../utils/deckUtils';

export const BatchMoveModal = ({
  isOpen,
  onClose,
  selectedCount = 0,
  currentDeckId,
  decks = [],
  folders = [],
  mode = 'move', // 'move' | 'copy'
  onConfirm
}) => {
  useInterfaceLocale();
  const [expandedFolders, setExpandedFolders] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const toggleFolder = (folderId) => {
    setExpandedFolders(prev => ({
      ...prev,
      [folderId]: !prev[folderId]
    }));
  };

  const handleSelectDeck = async (targetDeckId) => {
    if (isSubmitting || !onConfirm) return;
    setIsSubmitting(true);
    try {
      const success = await onConfirm(targetDeckId);
      if (success) {
        onClose();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const treeItems = getSortedFolderAndDeckTree(folders, decks, expandedFolders);
  const isCopyMode = mode === 'copy';

  return (
    <AnimatePresence>
      <div className="modal-backdrop glass" onClick={onClose} style={{ zIndex: 1100 }}>
        <motion.div
          className="modal-content glass action-modal-content"
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.2 }}
          onClick={(e) => e.stopPropagation()}
          style={{
            maxWidth: '420px',
            width: '92%',
            borderRadius: '24px',
            padding: '20px',
            background: 'rgba(15, 23, 42, 0.94)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6)'
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '38px',
                height: '38px',
                borderRadius: '12px',
                background: isCopyMode 
                  ? 'linear-gradient(135deg, rgba(56, 189, 248, 0.25), rgba(99, 102, 241, 0.25))'
                  : 'linear-gradient(135deg, rgba(168, 85, 247, 0.25), rgba(99, 102, 241, 0.25))',
                border: isCopyMode ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid rgba(168, 85, 247, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: isCopyMode ? '#38bdf8' : '#c084fc'
              }}>
                {isCopyMode ? <Copy size={20} /> : <Move size={20} />}
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#f8fafc' }}>
                  {isCopyMode ? tr("Копировать карточки") : tr("Переместить карточки")}
                </h3>
                <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                  {tr("Выбрано: {{p0}}", { p0: selectedCount })}
                </span>
              </div>
            </div>

            <button
              type="button"
              className="modal-close-btn"
              onClick={onClose}
              disabled={isSubmitting}
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#94a3b8',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer'
              }}
            >
              <X size={18} />
            </button>
          </div>

          <p style={{ fontSize: '0.84rem', color: '#94a3b8', margin: '0 0 12px 0' }}>
            {isCopyMode ? tr("Выберите колоду для копирования:") : tr("Выберите колоду для перемещения:")}
          </p>

          {/* Decks & Folders tree */}
          <div
            className="deck-selector-list scrollable"
            style={{
              maxHeight: '340px',
              overflowY: 'auto',
              borderRadius: '14px',
              background: 'rgba(0, 0, 0, 0.25)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              padding: '4px'
            }}
          >
            {treeItems.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
                {tr("Нет доступных колод")}
              </div>
            ) : (
              treeItems.map((item, index) => {
                if (item.type === 'folder') {
                  return (
                    <div
                      key={`folder-${item.id}-${index}`}
                      onClick={() => toggleFolder(item.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '10px 12px',
                        paddingLeft: `${12 + item.depth * 14}px`,
                        color: '#fbbf24',
                        fontSize: '0.88rem',
                        fontWeight: 600,
                        background: 'rgba(255, 255, 255, 0.02)',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.03)',
                        cursor: 'pointer',
                        userSelect: 'none',
                        borderRadius: '8px'
                      }}
                    >
                      <span style={{
                        fontSize: '0.7rem',
                        marginRight: '2px',
                        display: 'inline-block',
                        transform: item.isExpanded ? 'rotate(90deg)' : 'none',
                        transition: 'transform 0.15s ease'
                      }}>
                        ▶
                      </span>
                      {item.isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />}
                      <span>{item.name}</span>
                    </div>
                  );
                } else {
                  const isCurrent = String(item.id) === String(currentDeckId);
                  const isDisabled = (!isCopyMode && isCurrent) || isSubmitting;
                  return (
                    <button
                      key={`deck-${item.id}-${index}`}
                      type="button"
                      className="deck-select-item"
                      disabled={isDisabled}
                      onClick={() => handleSelectDeck(item.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: '100%',
                        padding: '10px 12px',
                        paddingLeft: `${12 + item.depth * 14}px`,
                        background: isCurrent ? 'rgba(255, 255, 255, 0.04)' : 'transparent',
                        opacity: isDisabled ? 0.45 : 1,
                        border: 'none',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.03)',
                        borderRadius: '8px',
                        cursor: isDisabled ? 'not-allowed' : 'pointer',
                        textAlign: 'left',
                        transition: 'background 0.15s'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                        <Layers size={16} style={{ color: isCopyMode ? '#38bdf8' : '#a855f7', flexShrink: 0 }} />
                        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                          <strong style={{
                            fontSize: '0.9rem',
                            color: (!isCopyMode && isCurrent) ? '#94a3b8' : '#f8fafc',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}>
                            {item.name}
                            {isCurrent && (
                              <span style={{ fontSize: '0.72rem', color: isCopyMode ? '#38bdf8' : '#94a3b8', opacity: 0.8, marginLeft: '6px' }}>
                                ({isCopyMode ? tr("В эту же колоду") : tr("Текущая")})
                              </span>
                            )}
                          </strong>
                          <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                            {item.totalCards}{' '}{tr("карт")}
                          </span>
                        </div>
                      </div>
                      {!isDisabled && (
                        isCopyMode
                          ? <Copy size={14} style={{ color: '#38bdf8', opacity: 0.6, flexShrink: 0 }} />
                          : <Move size={14} style={{ color: '#a855f7', opacity: 0.6, flexShrink: 0 }} />
                      )}
                    </button>
                  );
                }
              })
            )}
          </div>

          {/* Footer button */}
          <button
            type="button"
            className="btn-secondary btn-full"
            onClick={onClose}
            disabled={isSubmitting}
            style={{
              height: '44px',
              marginTop: '14px',
              borderRadius: '14px',
              fontSize: '0.9rem',
              fontWeight: 600
            }}
          >
            {tr("Отмена")}
          </button>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
