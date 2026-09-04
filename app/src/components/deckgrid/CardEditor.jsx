import React from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, Plus, Settings, X } from 'lucide-react';
import { HelpButton } from '../TutorialOverlay';
import { CardForm } from '../common/CardForm';
import { useUiStore } from '../../store/useUiStore';
import { useSessionStore } from '../../store/useSessionStore';
import { useCardActions } from '../../hooks/useCardActions';
import { useAudio } from '../../hooks/useAudio';
import { useSettingsStore } from '../../store/useSettingsStore';
import { navigateUp } from '../../utils/navigation';

export const CardEditor = ({ startTutorial }) => {
  const { view, setIsSettingsOpen } = useUiStore();
  const { editingCard, setEditingCard } = useSessionStore();
  const { runAiGenerator, stopAiGeneration, saveCard, generateAudioInternal } = useCardActions();
  const { playAudio } = useAudio();
  const { autoPlay } = useSettingsStore();

  const [animDone, setAnimDone] = React.useState(false);

  React.useEffect(() => {
    if (view === 'editor') {
      setAnimDone(false);
    }
  }, [view]);

  if (view !== 'editor') return null;

  const handleAiGenerate = async (actionType = 'full_card') => {
    if (!editingCard?.front) return;
    const result = await runAiGenerator(editingCard.front, true, actionType);
    if (result) {
      if (actionType === 'custom_directive' || actionType === 'explain_rule') {
        const currentCtx = editingCard.context || '';
        const updatedCtx = currentCtx ? `${result.context}\n\n${currentCtx.trim()}` : result.context;
        setEditingCard({
          ...editingCard,
          context: updatedCtx
        });
      } else {
        const updated = {
          ...editingCard,
          front: result.front || editingCard.front,
          back: result.back || editingCard.back,
          context: result.context || editingCard.context,
          level: result.level || editingCard.level,
          tags: result.tags || editingCard.tags
        };
        setEditingCard(updated);
        setTimeout(() => {
          generateAudioInternal(updated, setEditingCard, autoPlay ? playAudio : null);
        }, 500);
      }
    }
  };

  const handleBack = () => {
    navigateUp();
  };

  const handleSave = () => {
    saveCard(null, 'editor');
  };

  return (
    <div className="view-editor">
      <motion.div 
        initial={{ opacity: 0, y: 20 }} 
        animate={{ opacity: 1, y: 0 }} 
        onAnimationComplete={() => setAnimDone(true)}
        style={animDone ? { transform: 'none' } : {}}
        className="view"
      >
        <div className="header-compact">
          <button className="back-btn" onClick={handleBack}><ChevronLeft size={24} /></button>
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
