import React, { useRef } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, Plus, Settings, X } from 'lucide-react';
import { HelpButton } from './TutorialOverlay';
import { CardForm } from './common/CardForm';
import { useUiStore } from '../store/useUiStore';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useCardActions } from '../hooks/useCardActions';
import { useAudio } from '../hooks/useAudio';
import { useSettingsStore } from '../store/useSettingsStore';
import { useMediaUpload } from '../hooks/useMediaUpload';

export const CardEditor = ({ startTutorial }) => {
  const { view, setView, setIsSettingsOpen, editorSourceView } = useUiStore();
  const { currentDeck } = useDeckStore();
  const { editingCard, setEditingCard } = useSessionStore();
  const { runAiGenerator, stopAiGeneration, saveCard, generateAudioInternal } = useCardActions();
  const { uploadCardVideo } = useMediaUpload();
  const { playAudio } = useAudio();
  const { autoPlay } = useSettingsStore();

  const videoFrontRef = useRef(null);
  const videoBackRef = useRef(null);

  if (view !== 'editor') return null;

  const handleAiGenerate = async () => {
    if (!editingCard?.front) return;
    const result = await runAiGenerator(editingCard.front, true);
    if (result) {
      const updated = {
        ...editingCard,
        front: result.front || editingCard.front,
        back: result.back || editingCard.back,
        context: result.context || editingCard.context
      };
      setEditingCard(updated);
      setTimeout(() => {
        generateAudioInternal(updated, setEditingCard, autoPlay ? playAudio : null);
      }, 500);
    }
  };

  const handleSave = () => {
    saveCard(null, 'editor');
  };

  return (
    <div className="view-editor">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="view">
        <div className="header-compact">
          <button className="back-btn" onClick={() => setView(editorSourceView)}><ChevronLeft size={24} /></button>
          <h2>Правка карточки</h2>
          <div className="header-actions">
            <button className="header-action-btn" disabled={true} title="Добавить карточку">
              <Plus size={22} />
            </button>
            <HelpButton onClick={() => startTutorial('editor')} />
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
          cardData={editingCard}
          setCardData={setEditingCard}
          onSave={handleSave}
          onAiGenerate={handleAiGenerate}
          onStopGeneration={stopAiGeneration}
          onGenerateAudio={generateAudioInternal}
          playAudio={playAudio}
          isCreator={false}
        />

      </motion.div>
    </div>
  );
};
