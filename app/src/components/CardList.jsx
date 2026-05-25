import React from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, Trash2, Plus, ImageIcon, Volume2, Edit2, Settings, Share2, Play } from 'lucide-react';
import { HelpButton } from './TutorialOverlay';
import { useUiStore } from '../store/useUiStore';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useCardActions } from '../hooks/useCardActions';
import { useCardNavigation } from '../hooks/useCardNavigation';
import { UserProfileBadge } from './common/UserBadge';

export const CardList = ({ startTutorial, startStudy, startStudyCard }) => {
  const { view, setView, setIsSettingsOpen, setEditorSourceView, setIsRenameModalOpen, setDeckToRename } = useUiStore();
  const { currentDeck, deckCards } = useDeckStore();
  const { setEditingCard } = useSessionStore();
  const { handleDeleteCard, handleShareCard } = useCardActions();
  const { openEditor, openCreator } = useCardNavigation();

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
        {deckCards.length > 0 && (
          <div className="study-action-bar">
            <button className="btn-study-main" onClick={() => startStudy(currentDeck)}>
              <Play size={20} fill="currentColor" />
              <span>Начать изучение</span>
            </button>
          </div>
        )}
        <div id="tut-card-list-content" className="card-list">
          {deckCards.map(c => (
            <div key={c.id} className="card-item glass" onClick={() => startStudyCard(currentDeck, c.id)}>
              <div className="card-item-text">
                <div className="front-min">{c.front}</div>
                <div className="back-min">{c.back}</div>
              </div>
              <div className="card-item-actions">
                <div className="card-item-share" onClick={(e) => { e.stopPropagation(); handleShareCard(c); }} title="Поделиться">
                  <Share2 size={16} />
                </div>
                <div className="card-item-edit" onClick={(e) => { e.stopPropagation(); openEditor(currentDeck.id, c, 'cards'); }} title="Редактировать">
                  <Edit2 size={16} />
                </div>
                <div className="card-item-delete" onClick={(e) => { e.stopPropagation(); handleDeleteCard(c.id); }} title="Удалить">
                  <Trash2 size={16} />
                </div>
              </div>
            </div>
          ))}
        </div>
        
        {/* Floating Action Button for adding cards */}
        <button id="tut-fab-add" className="fab-add-card" onClick={() => openCreator(currentDeck?.id)}>
          <Plus size={28} />
        </button>
      </motion.div>
    </div>
  );
};
