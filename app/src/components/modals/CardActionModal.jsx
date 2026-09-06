import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Move, Copy, Trash2, Edit2, Settings2, Play, Square, Pause, RotateCw } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import { useCardActions } from '../../hooks/useCardActions';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useSessionStore } from '../../store/useSessionStore';
import { FlagPicker } from '../common/FlagPicker';

const PAUSE_OPTIONS = Array.from({ length: 10 }, (_, index) => { useInterfaceLocale(); return (index + 1); });
const SPEED_OPTIONS = Array.from({ length: 21 }, (_, index) => { useInterfaceLocale(); return (-50 + index * 5); });

const getSortedFolderAndDeckTree = (foldersList, decksList, expandedFolders) => {
  const result = [];
  const traverse = (folderId, depth, isParentVisible) => {
    if (!isParentVisible) return;

    // 1. Process child folders first
    const childFolders = foldersList.filter(f => f.parent_id === folderId);
    for (const folder of childFolders) {
      const isExpanded = !!expandedFolders[folder.id];
      result.push({
        type: 'folder',
        id: folder.id,
        name: folder.name,
        depth: depth,
        isExpanded: isExpanded
      });
      traverse(folder.id, depth + 1, isExpanded);
    }

    // 2. Process child decks
    const childDecks = decksList.filter(d => d.folder_id === folderId);
    for (const deck of childDecks) {
      result.push({
        type: 'deck',
        id: deck.id,
        name: deck.name,
        totalCards: deck.stats?.total || 0,
        depth: depth
      });
    }
  };

  traverse(null, 0, true);
  return result;
};

export const CardActionModal = ({
  isOpen,
  onClose,
  card,
  decks,
  folders,
  onMove,
  onCopy,
  onDelete,
  onShare,
  onEdit,
  onStartAutoplay
}) => {
  useInterfaceLocale();
  const [mode, setMode] = React.useState('main'); // 'main' | 'move' | 'copy' | 'autoplay'
  const [expandedFolders, setExpandedFolders] = React.useState({});
  const { handleSetCardFlag } = useCardActions();

  const autoplayState = useSessionStore(s => s.autoplayState);
  const isAutoplayPlaying = autoplayState === 'playing';
  const isAutoplayPaused = autoplayState === 'paused';
  const isAutoplayActive = isAutoplayPlaying || isAutoplayPaused;

  const autoplayOrder = useSettingsStore(s => s.autoplayOrder);
  const setAutoplayOrder = useSettingsStore(s => s.setAutoplayOrder);
  const autoplayFrontPause = useSettingsStore(s => s.autoplayFrontPause);
  const setAutoplayFrontPause = useSettingsStore(s => s.setAutoplayFrontPause);
  const autoplayBackPause = useSettingsStore(s => s.autoplayBackPause);
  const setAutoplayBackPause = useSettingsStore(s => s.setAutoplayBackPause);
  const autoplayFrontRepeat = useSettingsStore(s => s.autoplayFrontRepeat);
  const setAutoplayFrontRepeat = useSettingsStore(s => s.setAutoplayFrontRepeat);
  const autoplayBackRepeat = useSettingsStore(s => s.autoplayBackRepeat);
  const setAutoplayBackRepeat = useSettingsStore(s => s.setAutoplayBackRepeat);
  const ttsSpeed = useSettingsStore(s => s.ttsSpeed);
  const setTtsSpeed = useSettingsStore(s => s.setTtsSpeed);
  const ttsSpeedRu = useSettingsStore(s => s.ttsSpeedRu);
  const setTtsSpeedRu = useSettingsStore(s => s.setTtsSpeedRu);
  const autoplayLoop = useSettingsStore(s => s.autoplayLoop);
  const setAutoplayLoop = useSettingsStore(s => s.setAutoplayLoop);
  const autoplayForceFrontAudio = useSettingsStore(s => s.autoplayForceFrontAudio);
  const setAutoplayForceFrontAudio = useSettingsStore(s => s.setAutoplayForceFrontAudio);
  const autoplayForceBackAudio = useSettingsStore(s => s.autoplayForceBackAudio);
  const setAutoplayForceBackAudio = useSettingsStore(s => s.setAutoplayForceBackAudio);

  const toggleFolder = (folderId) => {
    setExpandedFolders(prev => ({
      ...prev,
      [folderId]: !prev[folderId]
    }));
  };

  // Reset mode and expanded folders when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setMode('main');
      setExpandedFolders({});
    }
  }, [isOpen]);

  if (!isOpen || !card) return null;

  const handleMoveClick = (deckId) => {
    onMove(card, deckId);
    onClose();
  };

  const handleCopyClick = (deckId) => {
    onCopy(card, deckId);
    onClose();
  };

  return (
    <AnimatePresence>
      <div 
        className="settings-overlay" 
        onClick={onClose}
        style={{ 
          display: 'flex', 
          alignItems: 'flex-end', 
          justifyContent: 'center',
          padding: 0
        }}
      >
        <motion.div 
          initial={{ opacity: 0, y: 100 }} 
          animate={{ opacity: 1, y: 0 }} 
          exit={{ opacity: 0, y: 100 }} 
          className="card-action-modal glass" 
          onClick={e => e.stopPropagation()}
          style={{ 
            width: '100%',
            maxWidth: '450px',
            maxHeight: 'min(90vh, 90dvh)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            borderRadius: '28px 28px 0 0',
            padding: '20px 24px',
            paddingBottom: 'max(24px, env(safe-area-inset-bottom, 20px))',
            background: 'rgba(15, 23, 42, 0.95)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderBottom: 'none',
            boxShadow: '0 -10px 40px rgba(0,0,0,0.4)',
            boxSizing: 'border-box'
          }}
        >
          <div className="action-modal-drag-handle" style={{
            width: '40px',
            height: '4px',
            background: 'rgba(255, 255, 255, 0.2)',
            borderRadius: '2px',
            margin: '0 auto 16px',
            flexShrink: 0
          }} />

          <div className="settings-header" style={{ marginBottom: '16px', flexShrink: 0 }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>
              {mode === 'main' ? tr("Управление карточкой") : 
               mode === 'move' ? tr("Переместить") : 
               mode === 'copy' ? tr("Копировать") : tr("Режим «Авто»")}
            </h2>
            <button className="close-btn" onClick={onClose} style={{ background: 'rgba(255, 255, 255, 0.05)' }}>
              <X size={20} />
            </button>
          </div>
          
          <div className="settings-content scrollable" style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
            {mode === 'main' && (
              <div className="action-grid" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

                <button 
                  className="action-menu-item" 
                  onClick={() => setMode('autoplay')}
                >
                  <div className="action-menu-icon" style={{ 
                    background: isAutoplayActive ? 'rgba(239, 68, 68, 0.12)' : 'linear-gradient(135deg, rgba(14, 165, 233, 0.15), rgba(168, 85, 247, 0.15))', 
                    color: isAutoplayActive ? '#f87171' : '#38bdf8' 
                  }}>
                    {isAutoplayActive ? <Square size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
                  </div>
                  <div className="action-menu-text">
                    <strong style={{ color: isAutoplayActive ? '#f87171' : undefined }}>
                      {isAutoplayActive ? tr("Режим «Авто» (Активен)") : tr("Режим «Авто»")}
                    </strong>
                    <span>
                      {isAutoplayActive ? tr("Остановить или настроить параметры") : tr("Автоматическое воспроизведение карточек")}
                    </span>
                  </div>
                </button>

                <button 
                  className="action-menu-item" 
                  onClick={() => setMode('move')}
                >
                  <div className="action-menu-icon" style={{ background: 'rgba(99, 102, 241, 0.1)', color: '#818cf8' }}>
                    <Move size={20} />
                  </div>
                  <div className="action-menu-text">
                    <strong>{tr("Переместить")}</strong>
                    <span>{tr("Перенести в другую колоду")}</span>
                  </div>
                </button>
                
                <button 
                  className="action-menu-item" 
                  onClick={() => setMode('copy')}
                >
                  <div className="action-menu-icon" style={{ background: 'rgba(168, 85, 247, 0.1)', color: '#a855f7' }}>
                    <Copy size={20} />
                  </div>
                  <div className="action-menu-text">
                    <strong>{tr("Копировать")}</strong>
                    <span>{tr("Создать дубликат в другой колоде")}</span>
                  </div>
                </button>
                
                <button 
                  className="action-menu-item" 
                  onClick={() => { onShare(card); onClose(); }}
                >
                  <div className="action-menu-icon" style={{ background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
                  </div>
                  <div className="action-menu-text">
                    <strong>{tr("Поделиться")}</strong>
                    <span>{tr("Отправить ссылку в Telegram")}</span>
                  </div>
                </button>
                
                {onEdit && (
                  <button 
                    className="action-menu-item" 
                    onClick={() => { onEdit(card); onClose(); }}
                  >
                    <div className="action-menu-icon" style={{ background: 'rgba(234, 179, 8, 0.1)', color: '#eab308' }}>
                      <Edit2 size={20} />
                    </div>
                    <div className="action-menu-text">
                      <strong>{tr("Редактировать")}</strong>
                      <span>{tr("Изменить содержимое карточки")}</span>
                    </div>
                  </button>
                )}

                <FlagPicker 
                  value={card.flag} 
                  onChange={(flagId) => {
                    handleSetCardFlag(card, flagId);
                    onClose();
                  }} 
                />
                
                <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.05)', margin: '10px 0' }} />

                <button 
                  className="action-menu-item delete" 
                  onClick={() => { onDelete(card); onClose(); }}
                >
                  <div className="action-menu-icon" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>
                    <Trash2 size={20} />
                  </div>
                  <div className="action-menu-text">
                    <strong style={{ color: '#ef4444' }}>{tr("Удалить карточку")}</strong>
                    <span>{tr("Это действие нельзя отменить")}</span>
                  </div>
                </button>
              </div>
            )}

            {mode === 'autoplay' && (
              <div className="autoplay-modal-content" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  {!isAutoplayActive ? (
                    <button
                      className="btn-primary btn-full"
                      onClick={() => {
                        if (onStartAutoplay) {
                          onStartAutoplay(card);
                        } else {
                          const { startAutoplayFn } = useSessionStore.getState();
                          if (startAutoplayFn) startAutoplayFn();
                        }
                        onClose();
                      }}
                      style={{
                        height: '50px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '10px',
                        fontSize: '1rem',
                        fontWeight: 700,
                        borderRadius: '16px',
                        background: 'linear-gradient(135deg, #0ea5e9, #a855f7)',
                        boxShadow: '0 4px 16px rgba(14, 165, 233, 0.3)'
                      }}
                    >
                      <Play size={20} fill="currentColor" />
                      <span>{tr("Запустить авто-режим")}</span>
                    </button>
                  ) : (
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button
                        className="btn-secondary"
                        onClick={() => {
                          const { pauseAutoplayFn, resumeAutoplayFn } = useSessionStore.getState();
                          if (isAutoplayPaused) {
                            if (resumeAutoplayFn) resumeAutoplayFn();
                          } else {
                            if (pauseAutoplayFn) pauseAutoplayFn();
                          }
                        }}
                        style={{
                          flex: 1,
                          height: '48px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                          borderRadius: '14px',
                          fontWeight: 600
                        }}
                      >
                        {isAutoplayPaused ? <Play size={18} fill="currentColor" /> : <Pause size={18} fill="currentColor" />}
                        <span>{isAutoplayPaused ? tr("Продолжить") : tr("Пауза")}</span>
                      </button>

                      <button
                        className="btn-secondary"
                        onClick={() => {
                          const { stopAutoplayFn, stopAutoplay } = useSessionStore.getState();
                          if (stopAutoplayFn) stopAutoplayFn();
                          else stopAutoplay();
                        }}
                        style={{
                          flex: 1,
                          height: '48px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                          borderRadius: '14px',
                          borderColor: 'rgba(239, 68, 68, 0.4)',
                          background: 'rgba(239, 68, 68, 0.15)',
                          color: '#fca5a5',
                          fontWeight: 600
                        }}
                      >
                        <Square size={16} fill="currentColor" />
                        <span>{tr("Остановить")}</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Autoplay Order Selector */}
                <div className="autoplay-order-toggle" style={{ margin: '0 0 4px 0' }}>
                  <button
                    type="button"
                    className={`autoplay-order-btn ${autoplayOrder === 'list' ? 'active' : ''}`}
                    onClick={() => setAutoplayOrder('list')}
                    title={tr("Линейный перебор всех карточек колоды по порядку")}
                  >{tr("🔢 По списку")}{' '}</button>
                  <button
                    type="button"
                    className={`autoplay-order-btn ${autoplayOrder === 'srs' ? 'active' : ''}`}
                    onClick={() => setAutoplayOrder('srs')}
                    title={tr("Только карточки, требующие повторения на сегодня (SRS)")}
                  >{tr("🧠 По SRS")}{' '}</button>
                </div>

                <div className="autoplay-control-grid" style={{ marginTop: '5px' }}>
                  <label className="autoplay-field">
                    <span>{tr("Пауза фразы")}</span>
                    <select
                      value={autoplayFrontPause}
                      onChange={(e) => setAutoplayFrontPause(e.target.value)}
                    >
                      {PAUSE_OPTIONS.map((value) => (
                        <option key={value} value={value}>{value}{tr("с")}</option>
                      ))}
                    </select>
                  </label>

                  <label className="autoplay-field">
                    <span>{tr("Пауза перевода")}</span>
                    <select
                      value={autoplayBackPause}
                      onChange={(e) => setAutoplayBackPause(e.target.value)}
                    >
                      {PAUSE_OPTIONS.map((value) => (
                        <option key={value} value={value}>{value}{tr("с")}</option>
                      ))}
                    </select>
                  </label>

                  <label className="autoplay-field">
                    <span>{tr("Повторов фразы")}</span>
                    <select
                      value={autoplayFrontRepeat}
                      onChange={(e) => setAutoplayFrontRepeat(e.target.value)}
                    >
                      {PAUSE_OPTIONS.map((value) => (
                        <option key={value} value={value}>{value}</option>
                      ))}
                    </select>
                  </label>

                  <label className="autoplay-field">
                    <span>{tr("Повторов перевода")}</span>
                    <select
                      value={autoplayBackRepeat}
                      onChange={(e) => setAutoplayBackRepeat(e.target.value)}
                    >
                      {PAUSE_OPTIONS.map((value) => (
                        <option key={value} value={value}>{value}</option>
                      ))}
                    </select>
                  </label>

                  <label className="autoplay-slider">
                    <span>DE {ttsSpeed > 0 ? '+' : ''}{ttsSpeed}%</span>
                    <input
                      type="range"
                      min="-50"
                      max="50"
                      step="5"
                      value={ttsSpeed}
                      onChange={(e) => setTtsSpeed(e.target.value)}
                      list="autoplay-speed-values-modal"
                    />
                  </label>

                  <label className="autoplay-slider">
                    <span>RU {ttsSpeedRu > 0 ? '+' : ''}{ttsSpeedRu}%</span>
                    <input
                      type="range"
                      min="-50"
                      max="50"
                      step="5"
                      value={ttsSpeedRu}
                      onChange={(e) => setTtsSpeedRu(e.target.value)}
                      list="autoplay-speed-values-modal"
                    />
                  </label>
                </div>

                <datalist id="autoplay-speed-values-modal">
                  {SPEED_OPTIONS.map((value) => <option key={value} value={value} />)}
                </datalist>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label className="autoplay-loop">
                    <input
                      type="checkbox"
                      checked={autoplayLoop}
                      onChange={(e) => setAutoplayLoop(e.target.checked)}
                    />
                    <span>{tr("Повторять колоду")}</span>
                  </label>

                  <label className="autoplay-loop">
                    <input
                      type="checkbox"
                      checked={autoplayForceFrontAudio}
                      onChange={(e) => setAutoplayForceFrontAudio(e.target.checked)}
                    />
                    <span><RotateCw size={14} />{' '}{tr("Генерировать фразу заново")}</span>
                  </label>

                  <label className="autoplay-loop">
                    <input
                      type="checkbox"
                      checked={autoplayForceBackAudio}
                      onChange={(e) => setAutoplayForceBackAudio(e.target.checked)}
                    />
                    <span><RotateCw size={14} />{' '}{tr("Генерировать перевод заново")}</span>
                  </label>
                </div>

                <button 
                  className="btn-secondary btn-full" 
                  onClick={() => setMode('main')} 
                  style={{ height: '46px', marginTop: '6px', borderRadius: '14px' }}
                >{tr("Назад")}{' '}</button>
              </div>
            )}

            {(mode === 'move' || mode === 'copy') && (
              <div className="deck-selector-list scrollable" style={{ maxHeight: '350px', overflowY: 'auto' }}>
                <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '15px' }}>
                  {mode === 'move' ? tr("Выберите колоду для переноса:") : tr("Выберите колоду для копирования:")}
                </p>
                {getSortedFolderAndDeckTree(folders || [], decks || [], expandedFolders).map((item, index) => {
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
                          paddingLeft: `${12 + item.depth * 16}px`,
                          color: '#ffd043',
                          fontSize: '0.9rem',
                          fontWeight: 600,
                          opacity: 0.85,
                          background: 'rgba(255, 255, 255, 0.02)',
                          borderBottom: '1px solid rgba(255, 255, 255, 0.03)',
                          cursor: 'pointer',
                          userSelect: 'none'
                        }}
                      >
                        <span style={{ 
                          color: '#ffd043', 
                          fontSize: '0.7rem', 
                          marginRight: '4px',
                          display: 'inline-block',
                          transform: item.isExpanded ? 'rotate(90deg)' : 'none',
                          transition: 'transform 0.15s ease'
                        }}>
                          ▶
                        </span>
                        <span>{item.name}</span>
                      </div>
                    );
                  } else {
                    return (
                      <button 
                        key={`deck-${item.id}-${index}`} 
                        className="deck-select-item"
                        onClick={() => mode === 'move' ? handleMoveClick(item.id) : handleCopyClick(item.id)}
                        style={{
                          paddingLeft: `${12 + item.depth * 16}px`
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
                          <strong style={{ fontSize: '0.95rem', color: 'white' }}>
                            {item.name}
                          </strong>
                          <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>{item.totalCards}{' '}{tr("карт")}</span>
                        </div>
                        {mode === 'move' ? <Move size={14} style={{ opacity: 0.3 }} /> : <Copy size={14} style={{ opacity: 0.3 }} />}
                      </button>
                    );
                  }
                })}
                <button className="btn-secondary btn-full mt-2" onClick={() => setMode('main')} style={{ height: '50px', marginTop: '15px' }}>{tr("Назад")}</button>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export const CardActionButton = ({ card, size = 16, className = "", stopDrag = false }) => {
  useInterfaceLocale();
  const { setActionCard, setIsCardActionModalOpen, setLastSelectedCardId, setCardsScrollTop } = useUiStore();

  const handleClick = (e) => {
    e.stopPropagation();
    const container = document.getElementById('app-container');
    if (container) {
      setCardsScrollTop(container.scrollTop);
    }
    if (card?.id) {
      setLastSelectedCardId(card.id);
    }
    setActionCard(card);
    setIsCardActionModalOpen(true);
  };

  return (
    <div
      className={className}
      onPointerDown={stopDrag ? (e) => e.stopPropagation() : undefined}
      onClick={handleClick}
      title={tr("Действия с карточкой")}
    >
      <Settings2 size={size} />
    </div>
  );
};
