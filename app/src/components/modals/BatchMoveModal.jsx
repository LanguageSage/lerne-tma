import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Move, Copy, Folder, FolderOpen, Layers, Check, AlertCircle } from 'lucide-react';
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
  const [selectedDeckId, setSelectedDeckId] = useState(null);
  const [duplicateAction, setDuplicateAction] = useState('skip'); // 'skip' | 'overwrite' | 'keep'
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset state when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setExpandedFolders({});
      setSelectedDeckId(null);
      setDuplicateAction('skip');
      setIsSubmitting(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const toggleFolder = (folderId) => {
    setExpandedFolders(prev => ({
      ...prev,
      [folderId]: !prev[folderId]
    }));
  };

  const handleConfirm = async () => {
    if (isSubmitting || !selectedDeckId || !onConfirm) return;
    setIsSubmitting(true);
    try {
      const success = await onConfirm(selectedDeckId, duplicateAction);
      if (success) {
        onClose();
      }
    } catch (err) {
      console.error('Confirm batch move/copy error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const treeItems = getSortedFolderAndDeckTree(folders, decks, expandedFolders);
  const isCopyMode = mode === 'copy';

  return (
    <div
      className="settings-overlay"
      onClick={onClose}
      style={{ zIndex: 2500 }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ duration: 0.18 }}
        className="settings-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '440px',
          width: '100%',
          maxHeight: 'calc(100dvh - 32px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: '20px',
          margin: 'auto',
          boxSizing: 'border-box'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexShrink: 0 }}>
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
            className="close-btn"
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

        <p style={{ fontSize: '0.84rem', color: '#94a3b8', margin: '0 0 12px 0', flexShrink: 0 }}>
          {isCopyMode ? tr("Выберите колоду для копирования:") : tr("Выберите колоду для перемещения:")}
        </p>

          {/* Decks & Folders tree */}
          <div
            className="deck-selector-list scrollable"
            style={{
              flex: 1,
              minHeight: 0,
              maxHeight: 'min(55vh, 380px)',
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
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
                  const isSelected = selectedDeckId === item.id;
                  return (
                    <button
                      key={`deck-${item.id}-${index}`}
                      type="button"
                      className="deck-select-item"
                      disabled={isDisabled}
                      onClick={() => setSelectedDeckId(item.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: '100%',
                        padding: '10px 12px',
                        paddingLeft: `${12 + item.depth * 14}px`,
                        background: isSelected
                          ? (isCopyMode ? 'rgba(56, 189, 248, 0.18)' : 'rgba(168, 85, 247, 0.18)')
                          : (isCurrent ? 'rgba(255, 255, 255, 0.04)' : 'transparent'),
                        opacity: isDisabled ? 0.45 : 1,
                        border: isSelected
                          ? (isCopyMode ? '1px solid rgba(56, 189, 248, 0.5)' : '1px solid rgba(168, 85, 247, 0.5)')
                          : '1px solid transparent',
                        borderBottom: isSelected ? undefined : '1px solid rgba(255, 255, 255, 0.03)',
                        borderRadius: '8px',
                        cursor: isDisabled ? 'not-allowed' : 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                        <Layers size={16} style={{ color: isCopyMode ? '#38bdf8' : '#a855f7', flexShrink: 0 }} />
                        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                          <strong style={{
                            fontSize: '0.9rem',
                            color: isSelected ? '#ffffff' : ((!isCopyMode && isCurrent) ? '#94a3b8' : '#f8fafc'),
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
                      {isSelected ? (
                        <div style={{
                          width: '22px',
                          height: '22px',
                          borderRadius: '50%',
                          background: isCopyMode ? '#38bdf8' : '#a855f7',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#0f172a',
                          flexShrink: 0
                        }}>
                          <Check size={14} strokeWidth={3} />
                        </div>
                      ) : (
                        !isDisabled && (
                          isCopyMode
                            ? <Copy size={14} style={{ color: '#38bdf8', opacity: 0.4, flexShrink: 0 }} />
                            : <Move size={14} style={{ color: '#a855f7', opacity: 0.4, flexShrink: 0 }} />
                        )
                      )}
                    </button>
                  );
                }
              })
            )}
          </div>

          {/* Duplicate collision selector */}
          <div style={{ marginTop: '12px', flexShrink: 0 }}>
            <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertCircle size={14} style={{ color: isCopyMode ? '#38bdf8' : '#a855f7' }} />
              <span>{tr("При совпадении текста карточки:")}</span>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '6px',
              background: 'rgba(0, 0, 0, 0.25)',
              padding: '4px',
              borderRadius: '12px',
              border: '1px solid rgba(255, 255, 255, 0.06)'
            }}>
              <button
                type="button"
                onClick={() => setDuplicateAction('skip')}
                style={{
                  padding: '7px 4px',
                  fontSize: '0.75rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: duplicateAction === 'skip' ? (isCopyMode ? '#0284c7' : '#9333ea') : 'transparent',
                  color: duplicateAction === 'skip' ? '#ffffff' : '#94a3b8',
                  fontWeight: duplicateAction === 'skip' ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  textAlign: 'center',
                  lineHeight: 1.2
                }}
                title={tr("Не копировать/перемещать карточки, которые уже есть в целевой колоде")}
              >
                {tr("Пропускать")}
              </button>
              <button
                type="button"
                onClick={() => setDuplicateAction('overwrite')}
                style={{
                  padding: '7px 4px',
                  fontSize: '0.75rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: duplicateAction === 'overwrite' ? (isCopyMode ? '#0284c7' : '#9333ea') : 'transparent',
                  color: duplicateAction === 'overwrite' ? '#ffffff' : '#94a3b8',
                  fontWeight: duplicateAction === 'overwrite' ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  textAlign: 'center',
                  lineHeight: 1.2
                }}
                title={tr("Обновить обратную сторону и данные существующей карточки")}
              >
                {tr("Заменять")}
              </button>
              <button
                type="button"
                onClick={() => setDuplicateAction('keep')}
                style={{
                  padding: '7px 4px',
                  fontSize: '0.75rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: duplicateAction === 'keep' ? (isCopyMode ? '#0284c7' : '#9333ea') : 'transparent',
                  color: duplicateAction === 'keep' ? '#ffffff' : '#94a3b8',
                  fontWeight: duplicateAction === 'keep' ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  textAlign: 'center',
                  lineHeight: 1.2
                }}
                title={tr("Создать новую копию карточки, даже если текст совпадает")}
              >
                {tr("Копии")}
              </button>
            </div>
          </div>

          {/* Footer Actions: Cancel + Confirm button */}
          <div style={{ display: 'flex', gap: '10px', marginTop: '14px', flexShrink: 0 }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={isSubmitting}
              style={{
                flex: '0 0 32%',
                height: '44px',
                borderRadius: '14px',
                fontSize: '0.88rem',
                fontWeight: 600
              }}
            >
              {tr("Отмена")}
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleConfirm}
              disabled={!selectedDeckId || isSubmitting}
              style={{
                flex: 1,
                height: '44px',
                borderRadius: '14px',
                fontSize: '0.88rem',
                fontWeight: 700,
                background: !selectedDeckId
                  ? 'rgba(255, 255, 255, 0.08)'
                  : (isCopyMode ? 'linear-gradient(135deg, #0284c7, #2563eb)' : 'linear-gradient(135deg, #9333ea, #6366f1)'),
                color: !selectedDeckId ? '#64748b' : '#ffffff',
                cursor: !selectedDeckId || isSubmitting ? 'not-allowed' : 'pointer',
                opacity: !selectedDeckId ? 0.6 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                boxShadow: selectedDeckId ? (isCopyMode ? '0 4px 14px rgba(2, 132, 199, 0.35)' : '0 4px 14px rgba(147, 51, 234, 0.35)') : 'none',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                padding: '0 12px'
              }}
            >
              {isSubmitting ? (
                tr("Выполняется...")
              ) : !selectedDeckId ? (
                tr("Выберите колоду")
              ) : isCopyMode ? (
                `${tr("Копировать")} (${selectedCount})`
              ) : (
                `${tr("Переместить")} (${selectedCount})`
              )}
            </button>
          </div>
        </motion.div>
      </div>
    );
  };

