import React from 'react';
import { motion, Reorder, useDragControls } from 'framer-motion';
import { ChevronLeft, Trash2, Plus, ImageIcon, Volume2, Edit2, Settings, Share2, Play, RefreshCw, GripVertical, Paperclip, ExternalLink, Pause, Play as PlayIcon } from 'lucide-react';
import { HelpButton } from './TutorialOverlay';
import { CardActionButton } from './CardActionModal';
import { useUiStore } from '../store/useUiStore';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useCardActions } from '../hooks/useCardActions';
import { useCardNavigation } from '../hooks/useCardNavigation';
import { UserProfileBadge } from './common/UserBadge';
import { DeckMediaModal } from './DeckMediaModal';

const DeckAudioPlayer = React.memo(({ url, title }) => {
  const audioRef = React.useRef(null);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [playbackRate, setPlaybackRate] = React.useState(1);

  React.useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    if (audioRef.current) {
      audioRef.current.load();
      audioRef.current.playbackRate = playbackRate;
    }
  }, [url]);

  const togglePlay = (e) => {
    e.stopPropagation();
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(err => console.error(err));
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleSeek = (e) => {
    const time = Number(e.target.value);
    setCurrentTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  const changeSpeed = (e) => {
    e.stopPropagation();
    const rates = [1, 1.25, 1.5, 0.75];
    const nextIdx = (rates.indexOf(playbackRate) + 1) % rates.length;
    const nextRate = rates[nextIdx];
    setPlaybackRate(nextRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
  };

  const formatTime = (time) => {
    if (isNaN(time)) return '0:00';
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className="deck-audio-player glass" style={{
      padding: '12px 16px',
      borderRadius: '16px',
      background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.08) 0%, rgba(99, 102, 241, 0.04) 100%)',
      border: '1px solid rgba(56, 189, 248, 0.25)',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      margin: '0 15px 15px 15px'
    }} onClick={e => e.stopPropagation()}>
      <audio 
        ref={audioRef} 
        src={url} 
        onPlay={() => setIsPlaying(true)} 
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => setIsPlaying(false)}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
        <span style={{ fontSize: '0.75rem', color: '#38bdf8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Аудиоматериал
        </span>
        <span style={{ fontSize: '0.8rem', color: '#e2e8f0', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>
          {title || 'Запись'}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button 
          onClick={togglePlay}
          style={{
            background: 'linear-gradient(135deg, #38bdf8, #6366f1)',
            border: 'none',
            color: 'white',
            width: '38px',
            height: '38px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
            boxShadow: '0 4px 12px rgba(56, 189, 248, 0.3)'
          }}
        >
          {isPlaying ? <Pause size={18} fill="currentColor" /> : <PlayIcon size={18} fill="currentColor" style={{ marginLeft: '2px' }} />}
        </button>

        <input 
          type="range"
          min={0}
          max={duration || 100}
          value={currentTime}
          onChange={handleSeek}
          style={{
            flex: 1,
            height: '5px',
            borderRadius: '5px',
            background: 'rgba(255,255,255,0.1)',
            outline: 'none',
            cursor: 'pointer',
            WebkitAppearance: 'none'
          }}
          className="deck-audio-slider"
        />

        <span style={{ fontSize: '0.75rem', color: '#94a3b8', minWidth: '70px', textAlign: 'right', fontFamily: 'monospace' }}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        <button
          onClick={changeSpeed}
          style={{
            background: 'rgba(255, 255, 255, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: '8px',
            padding: '4px 8px',
            fontSize: '0.75rem',
            color: '#38bdf8',
            fontWeight: 700,
            cursor: 'pointer',
            minWidth: '42px',
            textAlign: 'center'
          }}
        >
          {playbackRate}x
        </button>
      </div>
    </div>
  );
});

const DraggableCardItem = React.memo(({ c, currentDeck, startStudyCard }) => {
  const dragControls = useDragControls();

  return (
    <Reorder.Item
      key={c.id}
      value={c}
      as="div"
      id={`card-item-${c.id}`}
      className="card-item glass card-item-draggable"
      onClick={() => startStudyCard(currentDeck, c.id)}
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
        className="card-drag-handle" 
        onPointerDown={(e) => dragControls.start(e)}
        style={{ touchAction: 'none' }}
        title="Перетащить карточку"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <GripVertical size={16} />
          <GripVertical size={16} />
        </div>
      </div>
      <div className="card-item-text">
        <div className="front-min">{c.front}</div>
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
}, (prevProps, nextProps) => {
  return prevProps.c.id === nextProps.c.id &&
         prevProps.c.front === nextProps.c.front &&
         prevProps.c.back === nextProps.c.back &&
         prevProps.currentDeck?.id === nextProps.currentDeck?.id;
});

export const CardList = ({ startTutorial, startStudy, startStudyCard }) => {
  const { view, setView, setIsSettingsOpen, setEditorSourceView, setIsRenameModalOpen, setDeckToRename, lastSelectedCardId, setLastSelectedCardId, showToast } = useUiStore();
  const { currentDeck, deckCards, cardsLoading } = useDeckStore();
  const [isMediaModalOpen, setIsMediaModalOpen] = React.useState(false);
  const { setEditingCard } = useSessionStore();
  const { handleDeleteCard, handleShareCard } = useCardActions();
  const { openEditor, openCreator } = useCardNavigation();

  React.useEffect(() => {
    if (lastSelectedCardId) {
      const timer = setTimeout(() => {
        const el = document.getElementById(`card-item-${lastSelectedCardId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        setLastSelectedCardId(null);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [lastSelectedCardId, setLastSelectedCardId]);

  if (view !== 'cards') return null;

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
              className="header-action-btn" 
              onClick={() => startStudy(currentDeck)}
              title="Начать изучение"
              style={{ color: '#10b981' }}
            >
              <Play size={22} fill="currentColor" />
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

        {/* Deck Title Header */}
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

        {/* Resources container */}
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

              {/* Images Carousel */}
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
                  {images.map((img, idx) => (
                    <div key={idx} className="glass" style={{
                      position: 'relative',
                      borderRadius: '16px',
                      overflow: 'hidden',
                      aspectRatio: '16 / 9',
                      flex: '0 0 100%',
                      maxWidth: '100%',
                      height: '180px',
                      scrollSnapAlign: 'start',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      background: 'rgba(0, 0, 0, 0.2)'
                    }}>
                      <img 
                        src={img.url} 
                        alt={img.title || 'Deck image'} 
                        style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'zoom-in' }} 
                        onClick={() => window.open(img.url, '_blank')}
                      />
                      {images.length > 1 && (
                        <div style={{
                          position: 'absolute',
                          bottom: '8px',
                          right: '12px',
                          background: 'rgba(0,0,0,0.6)',
                          color: 'white',
                          fontSize: '0.7rem',
                          padding: '2px 8px',
                          borderRadius: '10px',
                          fontWeight: 600
                        }}>
                          {idx + 1} / {images.length}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Audios List */}
              {audios.map((aud, idx) => (
                <DeckAudioPlayer key={idx} url={aud.url} title={aud.title} />
              ))}

              {/* Videos List */}
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

              {/* Links Grid */}
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
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '8px 14px',
                        borderRadius: '20px',
                        border: '1px solid rgba(52, 211, 153, 0.3)',
                        background: 'rgba(52, 211, 153, 0.06)',
                        color: '#a7f3d0',
                        fontSize: '0.78rem',
                        textDecoration: 'none',
                        fontWeight: 600,
                        transition: 'all 0.2s'
                      }}
                      onMouseOver={e => e.currentTarget.style.background = 'rgba(52, 211, 153, 0.15)'}
                      onMouseOut={e => e.currentTarget.style.background = 'rgba(52, 211, 153, 0.06)'}
                    >
                      <Paperclip size={13} />
                      <span>{lnk.title || 'Ссылка'}</span>
                      <ExternalLink size={11} style={{ opacity: 0.7 }} />
                    </a>
                  ))}
                </div>
              )}
            </>
          );
        })()}

        {/* Prominent Study Button */}
        {!cardsLoading && deckCards.length > 0 && (
          <div className="study-action-bar">
            <button className="btn-back-main" onClick={() => setView('decks')} title="Назад к колодам">
              <ChevronLeft size={24} />
            </button>
            <button className="btn-study-main" onClick={() => startStudy(currentDeck)}>
              <Play size={20} fill="currentColor" />
              <span>Начать изучение</span>
            </button>
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
          ) : currentDeck?.id === 'favorites' ? (
            <div className="card-list">
              {deckCards.map(c => (
                <div key={c.id} id={`card-item-${c.id}`} className="card-item glass" onClick={() => startStudyCard(currentDeck, c.id)}>
                  <div className="card-item-text">
                    <div className="front-min">{c.front}</div>
                    <div className="back-min">{c.back}</div>
                  </div>
                  <div className="card-item-actions">
                    <CardActionButton 
                      card={c} 
                      size={16} 
                      className="card-item-actions-trigger" 
                      stopDrag={false} 
                    />
                  </div>
                </div>
              ))}
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
        
        {/* Floating Action Button for adding cards */}
        <button id="tut-fab-add" className="fab-add-card" onClick={() => openCreator(currentDeck?.id)}>
          <Plus size={28} />
        </button>

        <DeckMediaModal 
          isOpen={isMediaModalOpen} 
          onClose={() => setIsMediaModalOpen(false)} 
        />
      </motion.div>
    </div>
  );
};
