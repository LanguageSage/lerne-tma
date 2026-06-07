import React from 'react';
import { motion, Reorder } from 'framer-motion';
import { ChevronLeft, Trash2, Plus, ImageIcon, Volume2, Edit2, Settings, Share2, Play, RefreshCw } from 'lucide-react';
import { HelpButton } from './TutorialOverlay';
import { CardActionButton } from './CardActionModal';
import { useUiStore } from '../store/useUiStore';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useCardActions } from '../hooks/useCardActions';
import { useCardNavigation } from '../hooks/useCardNavigation';
import { UserProfileBadge } from './common/UserBadge';

export const CardList = ({ startTutorial, startStudy, startStudyCard }) => {
  const { view, setView, setIsSettingsOpen, setEditorSourceView, setIsRenameModalOpen, setDeckToRename, lastSelectedCardId, setLastSelectedCardId } = useUiStore();
  const { currentDeck, deckCards, cardsLoading } = useDeckStore();
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
              disabled={true}
              title="Добавить картинку"
            >
              <ImageIcon size={22} />
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
                  <div className="card-item-text" style={{ flex: 1 }}>
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
                <Reorder.Item
                  key={c.id}
                  value={c}
                  as="div"
                  id={`card-item-${c.id}`}
                  className="card-item glass card-item-draggable"
                  onClick={() => startStudyCard(currentDeck, c.id)}
                  whileDrag={{
                    scale: 1.02,
                    boxShadow: "0 8px 30px rgba(0, 0, 0, 0.3)",
                    backgroundColor: "rgba(255, 255, 255, 0.08)",
                    cursor: "grabbing"
                  }}
                >
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
              ))}
            </Reorder.Group>
          )}
        </div>
        
        {/* Floating Action Button for adding cards */}
        <button id="tut-fab-add" className="fab-add-card" onClick={() => openCreator(currentDeck?.id)}>
          <Plus size={28} />
        </button>
      </motion.div>
    </div>
  );
};
