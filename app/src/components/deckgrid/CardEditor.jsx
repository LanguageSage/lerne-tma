import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, Plus, Settings } from 'lucide-react';
import { HelpButton } from '../TutorialOverlay';
import { CardForm } from '../common/CardForm';
import { useUiStore } from '../../store/useUiStore';
import { useSessionStore } from '../../store/useSessionStore';
import { useCardActions } from '../../hooks/useCardActions';
import { useAudio } from '../../hooks/useAudio';


import { navigateUp } from '../../utils/navigation';
import { LocalPublishButton } from '../common/LocalPublishButton';

export const CardEditor = () => {
  useInterfaceLocale();
  const { view, setIsSettingsOpen } = useUiStore();
  const { editingCard, setEditingCard } = useSessionStore();
  const { runAiGenerator, stopAiGeneration, saveCard, generateAudioInternal } = useCardActions();
  const { playAudio } = useAudio();

  const [animDone, setAnimDone] = React.useState(false);

  React.useEffect(() => {
    if (view === 'editor') {
      setAnimDone(false);
    }
  }, [view]);

  if (view !== 'editor') return null;

  const handleAiGenerate = async (actionType = 'full_card', userRequest = '') => {
    const content = editingCard?.content_v2;
    if (!content) return;
    const result = await runAiGenerator(content, true, actionType, userRequest);
    if (result?.content_v2) {
      setEditingCard(current => current?.content_v2 === content ? { ...current, content_v2: result.content_v2 } : current);
    }
    return result;
  };

  const handleBack = () => {
    navigateUp();
  };

  const handleSave = () => {
    return saveCard(null, 'editor');
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
          <h2>{tr("Правка карточки")}</h2>
          <div className="header-actions">
            <button className="header-action-btn" disabled={true} title={tr("Добавить карточку")}>
              <Plus size={22} />
            </button>
            <HelpButton topic="creator" />
            <button 
              className="header-action-btn settings-btn" 
              onClick={() => setIsSettingsOpen(true)}
              title={tr("Настройки")}
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
        <LocalPublishButton cardId={editingCard?.id} beforeOpen={handleSave} />

      </motion.div>
    </div>
  );
};
