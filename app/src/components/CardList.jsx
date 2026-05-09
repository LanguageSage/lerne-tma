import React from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, Trash2, Plus, ImageIcon, Volume2, Edit2, Settings } from 'lucide-react';
import { HelpButton } from './TutorialOverlay';
import { useUiStore } from '../store/useUiStore';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useCardActions } from '../hooks/useCardActions';

export const CardList = ({ startTutorial }) => {
  const { view, setView, setIsSettingsOpen, setEditorSourceView } = useUiStore();
  const { currentDeck, deckCards } = useDeckStore();
  const { setEditingCard } = useSessionStore();
  const { handleDeleteCard } = useCardActions();

  if (view !== 'cards') return null;

  const openEditor = (deckId, cardToEdit = null, source = 'cards') => {
    const cleanMedia = (p) => {
      if (!p) return '';
      if (p.startsWith('/api/media/')) {
        const parts = p.split('/');
        return parts.slice(3).join('/');
      }
      return p;
    };

    if (cardToEdit) {
      setEditingCard({
        id: cardToEdit.id,
        front: cardToEdit.front || '',
        back: cardToEdit.back || '',
        context: cardToEdit.context || '',
        image_path: cleanMedia(cardToEdit.image_path || cardToEdit.image_url),
        audio_path: cleanMedia(cardToEdit.audio_path || cardToEdit.audio_url),
        video_front_url: cardToEdit.video_front_url || '',
        video_back_url: cardToEdit.video_back_url || '',
        deck_id: deckId
      });
    } else {
      setEditingCard({ front: '', back: '', context: '', deck_id: deckId });
    }
    setEditorSourceView(source);
    setView('editor');
  };

  const openCreator = (deckId, source = 'cards') => {
    setEditorSourceView(source);
    setEditingCard({
      deck_id: deckId,
      front: '',
      back: '',
      context: '',
      image_path: '',
      audio_path: ''
    });
    setView('creator');
  };

  return (
    <div className="view-cards">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="view">
        <div className="header-compact">
          <button className="back-btn" onClick={() => setView('decks')}><ChevronLeft size={24} /></button>
          <h2 className="header-title">{currentDeck?.name}</h2>
          <div className="header-actions">
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
              disabled={true}
              title="Озвучить"
            >
              <Volume2 size={22} />
            </button>

            <button 
              className="header-action-btn" 
              disabled={true}
              title="Редактировать"
            >
              <Edit2 size={22} />
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
        <div id="tut-card-list-content" className="card-list">
          {deckCards.map(c => (
            <div key={c.id} className="card-item glass" onClick={() => openEditor(currentDeck.id, c, 'cards')}>
              <div className="card-item-text">
                <div className="front-min">{c.front}</div>
                <div className="back-min">{c.back}</div>
              </div>
              <div className="card-item-actions">
                <div className="card-item-edit" onClick={(e) => { e.stopPropagation(); openEditor(currentDeck.id, c, 'cards'); }}>✎</div>
                <div className="card-item-delete" onClick={(e) => { e.stopPropagation(); handleDeleteCard(c.id); }}><Trash2 size={16} /></div>
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
