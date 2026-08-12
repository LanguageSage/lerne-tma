import React from 'react';
import { motion, Reorder, useDragControls } from 'framer-motion';
import { ChevronLeft, Trash2, Plus, Edit2, Settings, Play, RefreshCw, GripVertical, GripHorizontal, Paperclip, ExternalLink, Pause, Play as PlayIcon, Crop, Loader2 } from 'lucide-react';
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
import { getFlagStyle, FLAG_COLORS } from '../../constants/cardFlags';

const DraggableCardItem = ({ c, currentDeck, startStudyCard }) => {
  const dragControls = useDragControls();
  const flagStyle = getFlagStyle(c.flag);
  const flagInfo = FLAG_COLORS[c.flag] || FLAG_COLORS[0];
  const { setLastSelectedCardId, setCardsScrollTop } = useUiStore();

  const handleItemClick = () => {
    const container = document.getElementById('app-container');
    if (container) setCardsScrollTop(container.scrollTop);
    setLastSelectedCardId(c.id);
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
        className="deck-drag-handle-bottom" 
        onPointerDown={(e) => { e.stopPropagation(); dragControls.start(e); }}
        onClick={(e) => e.stopPropagation()}
        title="Зажмите и потяните для перетаскивания карточки"
      >
        <GripHorizontal size={22} />
      </div>
      <div 
        className="card-item-text"
        onClick={handleItemClick}
        style={{ cursor: 'pointer', position: 'relative' }}
      >
        <div className="front-min" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {flagInfo.hex && (
            <span 
              style={{ 
                width: '8px', 
                height: '8px', 
                borderRadius: '50%', 
                backgroundColor: flagInfo.hex, 
                boxShadow: `0 0 6px ${flagInfo.hex}`,
                flexShrink: 0 
              }} 
              title={`Флаг: ${flagInfo.name}`} 
            />
          )}
          <span>{c.front}</span>
        </div>
        <div className="back-min">{c.back}</div>
      </div>
      <div className="card-item-actions">
        <CardActionButton 
          card={c} 
          size={16} 
          className="card-item-actions-trigger" 
          stopDrag={true} 
        />
      </div>
    </Reorder.Item>
  );
};

export const CardList = ({ startTutorial, startStudy, startStudyCard }) => {
  const { view, setView, setIsSettingsOpen, setIsRenameModalOpen, setDeckToRename, lastSelectedCardId, cardsScrollTop, setCardsScrollTop } = useUiStore();
  const { currentDeck, deckCards, cardsLoading } = useDeckStore();
  const [isMediaModalOpen, setIsMediaModalOpen] = React.useState(false);
  const [editingDeckImgSrc, setEditingDeckImgSrc] = React.useState(null);
  const [editingDeckImgIndex, setEditingDeckImgIndex] = React.useState(-1);

  const { uploadDeckResource } = useMediaUpload();
  const { openCreator } = useCardNavigation();

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
        <div className="header-compact">
          <button className="back-btn" onClick={() => setView('decks')}><ChevronLeft size={24} /></button>

          <div className="header-actions">
            <UserProfileBadge />
            <button 
              className="header-action-btn" 
              onClick={() => openCreator(currentDeck?.id, 'cards')} 
              title="Добавить карточку"
            >
              <Plus size={22} />
            </button>

            <HelpButton onClick={() => startTutorial('cards')} />

            <button
              className="header-action-btn"
              onClick={() => setIsMediaModalOpen(true)}
              title="Ресурсы колоды"
            >
              <Paperclip size={22} style={{
                color: (currentDeck?.metadata && (typeof currentDeck.metadata === 'string' ? JSON.parse(currentDeck.metadata) : currentDeck.metadata)?.resources?.length > 0) ? '#c084fc' : 'currentColor'
              }} />
            </button>


            <button 
              className="header-action-btn settings-btn" 
              onClick={() => setIsSettingsOpen(true)}
              title="Настройки"
            >
              <Settings size={22} />
            </button>
          </div>
        </div>

        <div style={{ padding: '0 15px', marginTop: '15px', marginBottom: '10px', textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', flexWrap: 'wrap', minWidth: 0 }}>
            <h1 style={{ 
              fontSize: '1.4rem', 
              fontWeight: 800, 
              margin: 0,
              background: 'linear-gradient(135deg, #ffffff 0%, #a1a1aa 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              textAlign: 'center',
              lineHeight: 1.3,
              overflowWrap: 'anywhere'
            }}>
              {currentDeck?.name}
            </h1>
            {currentDeck && !currentDeck.is_inbox && (
              <button 
                onClick={(e) => { 
                  e.stopPropagation(); 
                  setDeckToRename(currentDeck); 
                  setIsRenameModalOpen(true); 
                }}
                style={{ 
                  background: 'transparent', 
                  border: 'none', 
                  color: '#a0ad0e', 
                  cursor: 'pointer', 
                  display: 'inline-flex', 
                  padding: '4px',
                  flexShrink: 0,
                  transition: 'color 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.color = '#c4d320'}
                onMouseOut={(e) => e.currentTarget.style.color = '#a0ad0e'}
                title="Переименовать колоду"
              >
                <Edit2 size={24} />
              </button>
            )}
          </div>
        </div>

        {(() => {
          let metadata = { resources: [] };
          if (currentDeck?.metadata) {
            metadata = typeof currentDeck.metadata === 'string'
              ? JSON.parse(currentDeck.metadata)
              : currentDeck.metadata;
          }
          const resources = metadata.resources || [];
          
          const images = resources.filter(r => r.type === 'image');
          const audios = resources.filter(r => r.type === 'audio');
          const videos = resources.filter(r => r.type === 'video');
          const links = resources.filter(r => r.type === 'link');

          return (
            <>
              {resources.length === 0 && (
                <div 
                  onClick={() => setIsMediaModalOpen(true)}
                  style={{
                    margin: '10px 15px 15px 15px',
                    padding: '12px',
                    borderRadius: '14px',
                    border: '1px dashed rgba(255, 255, 255, 0.15)',
                    background: 'rgba(255, 255, 255, 0.02)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    color: '#94a3b8',
                    fontSize: '0.85rem',
                    transition: 'all 0.2s'
                  }}
                  onMouseOver={e => {
                    e.currentTarget.style.borderColor = 'rgba(168, 85, 247, 0.4)';
                    e.currentTarget.style.color = '#c084fc';
                    e.currentTarget.style.background = 'rgba(168, 85, 247, 0.04)';
                  }}
                  onMouseOut={e => {
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                    e.currentTarget.style.color = '#94a3b8';
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
                  }}
                >
                  <Paperclip size={16} />
                  <span>Прикрепить картинку, аудио или ссылку к колоде</span>
                </div>
              )}

              {resources.length > 0 && (
                <div style={{
                  margin: '5px 15px 10px 15px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Ресурсы колоды
                  </span>
                  <button
                    onClick={() => setIsMediaModalOpen(true)}
                    style={{
                      background: 'rgba(168, 85, 247, 0.15)',
                      border: '1px solid rgba(168, 85, 247, 0.3)',
                      color: '#c084fc',
                      padding: '4px 10px',
                      borderRadius: '8px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      transition: 'all 0.2s'
                    }}
                    onMouseOver={e => {
                      e.currentTarget.style.background = 'rgba(168, 85, 247, 0.25)';
                      e.currentTarget.style.borderColor = 'rgba(168, 85, 247, 0.5)';
                    }}
                    onMouseOut={e => {
                      e.currentTarget.style.background = 'rgba(168, 85, 247, 0.15)';
                      e.currentTarget.style.borderColor = 'rgba(168, 85, 247, 0.3)';
                    }}
                  >
                    <Plus size={12} />
                    <span>Добавить / Изменить</span>
                  </button>
                </div>
              )}

              {images.length > 0 && (
                <div className="deck-images-gallery" style={{
                  margin: '10px 15px 15px 15px',
                  display: 'flex',
                  gap: '10px',
                  overflowX: 'auto',
                  paddingBottom: '5px',
                  scrollSnapType: 'x mandatory',
                  WebkitOverflowScrolling: 'touch'
                }}>
                  {images.map((img, idx) => {
                    const getImgSrc = (imgItem) => {
                      if (!imgItem) return '';
                      if (imgItem.url) return imgItem.url;
                      if (imgItem.path) {
                        const cleanPath = imgItem.path.replace(/^(images|audio|videos)\//, '');
                        return `/api/media/images/${cleanPath}`;
                      }
                      return '';
                    };
                    const imgSrc = getImgSrc(img);
                    const resourceIndex = resources.findIndex(r => r === img || (r.type === 'image' && (r.url === img.url || r.path === img.path)));
                    return (
                      <div key={idx} style={{ flex: '0 0 100%', maxWidth: '100%', scrollSnapAlign: 'start' }}>
                        <div className="glass" style={{
                          position: 'relative',
                          borderRadius: '16px',
                          overflow: 'hidden',
                          border: '1px solid rgba(255, 255, 255, 0.12)',
                          background: '#000'
                        }}>
                          <img 
                            src={imgSrc} 
                            alt="" 
                            style={{ 
                              display: 'block',
                              width: '100%', 
                              maxHeight: '260px', 
                              objectFit: 'contain',
                              borderRadius: '16px',
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
                              top: '10px',
                              right: '10px',
                              background: 'rgba(0, 0, 0, 0.7)',
                              backdropFilter: 'blur(6px)',
                              border: '1px solid rgba(255, 255, 255, 0.25)',
                              color: '#e9d5ff',
                              padding: '6px 12px',
                              borderRadius: '10px',
                              fontSize: '0.8rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              zIndex: 2,
                              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                              transition: 'all 0.2s'
                            }}
                            onMouseOver={e => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.85)'}
                            onMouseOut={e => e.currentTarget.style.background = 'rgba(0, 0, 0, 0.7)'}
                            title="Редактировать изображение списка"
                          >
                            <Crop size={14} />
                            <span>Изменить</span>
                          </button>

                          {images.length > 1 && (
                            <div style={{
                              position: 'absolute',
                              bottom: '10px',
                              right: '12px',
                              background: 'rgba(0, 0, 0, 0.65)',
                              color: 'white',
                              fontSize: '0.75rem',
                              padding: '3px 10px',
                              borderRadius: '10px',
                              fontWeight: 600
                            }}>
                              {idx + 1} / {images.length}
                            </div>
                          )}
                        </div>

                        {/* Toggle switch for showing image in every card */}
                        <label 
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '8px',
                            marginTop: '8px',
                            padding: '8px 12px',
                            borderRadius: '12px',
                            background: 'rgba(255, 255, 255, 0.04)',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            cursor: 'pointer',
                            userSelect: 'none',
                            width: '100%',
                            boxSizing: 'border-box'
                          }}
                        >
                          <span style={{ fontSize: '0.8rem', color: '#e2e8f0', fontWeight: 500 }}>
                            Показывать картинку в каждой карточке
                          </span>
                          <input
                            type="checkbox"
                            checked={img.show_in_cards !== false}
                            onChange={(e) => handleToggleShowInCards(img, e.target.checked)}
                            style={{
                              width: '18px',
                              height: '18px',
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

              {audios.map((aud, idx) => (
                <DeckAudioPlayer key={idx} url={aud.url} title={aud.title} />
              ))}

              {videos.map((vid, idx) => (
                <div key={idx} className="glass" style={{
                  margin: '0 15px 15px 15px',
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

              {links.length > 0 && (
                <div style={{
                  margin: '0 15px 15px 15px',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '8px'
                }}>
                  {links.map((lnk, idx) => (
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
            </>
          );
        })()}

        <div style={{ padding: '0 15px', marginBottom: '15px' }}>
          <button 
            className="btn btn-primary btn-full"
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              gap: '8px',
              padding: '14px',
              fontSize: '1.05rem',
              fontWeight: 700,
              borderRadius: '16px',
              background: 'linear-gradient(135deg, #a855f7 0%, #6366f1 100%)',
              boxShadow: '0 8px 20px rgba(168, 85, 247, 0.35)'
            }}
            onClick={() => startStudy(currentDeck)}
            disabled={!deckCards || deckCards.length === 0}
          >
            <Play size={20} fill="currentColor" />
            <span>Учить колоду ({deckCards?.length || 0})</span>
          </button>
        </div>

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
          ) : (
            <Reorder.Group
              as="div"
              axis="y"
              values={deckCards}
              onReorder={(newOrder) => {
                const orderedIds = newOrder.map(c => c.id);
                useDeckStore.getState().reorderCards(orderedIds);
              }}
              className="card-list"
              id="tut-card-list-content"
            >
              {deckCards.map(c => (
                <DraggableCardItem 
                  key={c.id} 
                  c={c} 
                  currentDeck={currentDeck} 
                  startStudyCard={startStudyCard} 
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
