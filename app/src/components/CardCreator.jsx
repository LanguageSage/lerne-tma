import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, Plus, Settings } from 'lucide-react';
import { HelpButton } from './TutorialOverlay';
import { CardForm } from './common/CardForm';
import { useUiStore } from '../store/useUiStore';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useCardActions } from '../hooks/useCardActions';
import { useAudio } from '../hooks/useAudio';
import { useSettingsStore } from '../store/useSettingsStore';

export const CardCreator = ({ startTutorial }) => {
  const { view, setView, setIsSettingsOpen, editorSourceView } = useUiStore();
  const { currentDeck } = useDeckStore();
  const { card, setCard } = useSessionStore();
  const { runAiGenerator, stopAiGeneration, saveCard, generateAudioInternal } = useCardActions();
  const { playAudio } = useAudio();
  const { autoPlay } = useSettingsStore();

  const [newCardData, setNewCardData] = useState({
    front: '',
    back: '',
    context: '',
    audio_path: '',
    audio_url: '',
    image_path: '',
    image_url: '',
    deck_id: currentDeck?.id
  });

  const handleBack = () => {
    if (editorSourceView === 'study') {
      setView('study');
    } else if (editorSourceView === 'cards') {
      setView('cards');
    } else {
      setView('decks');
    }
  };

  useEffect(() => {
    if (view === 'creator') {
      setNewCardData({
        front: '',
        back: '',
        context: '',
        deck_id: currentDeck?.id
      });
    }
  }, [view, currentDeck?.id]);

  if (view !== 'creator') return null;

  const handleAiGenerate = async () => {
    if (!newCardData.front) return;
    const result = await runAiGenerator(newCardData.front, true);
    if (result) {
      const updated = {
        ...newCardData,
        front: result.front || newCardData.front,
        back: result.back || newCardData.back,
        context: result.context || newCardData.context
      };
      setNewCardData(updated);
      
      setTimeout(() => {
        generateAudioInternal(updated, setNewCardData, autoPlay ? playAudio : null);
      }, 500);
    }
  };

  const handleSave = () => {
    saveCard(newCardData, 'creator');
  };

  return (
    <div className="view-creator">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="view">
        <div className="header-compact">
          <button className="back-btn" onClick={handleBack}><ChevronLeft size={24} /></button>
          <h2>Новая карточка</h2>
          <div className="header-actions">
            <button className="header-action-btn" disabled={true} title="Добавить карточку">
              <Plus size={22} />
            </button>
            <HelpButton onClick={() => startTutorial('creator')} />
            <button 
              className="header-action-btn settings-btn" 
              onClick={() => setIsSettingsOpen(true)}
              title="Настройки"
            >
              <Settings size={22} />
            </button>
          </div>
        </div>

        <CardForm
          cardData={newCardData}
          setCardData={setNewCardData}
          onSave={handleSave}
          onAiGenerate={handleAiGenerate}
          onGenerateAudio={generateAudioInternal}
          playAudio={playAudio}
          isCreator={true}
        />
        
      </motion.div>
    </div>
  );
};
