import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, Plus, Settings } from 'lucide-react';
import { HelpButton } from '../TutorialOverlay';
import { CardForm } from '../common/CardForm';
import { useUiStore } from '../../store/useUiStore';
import { useDeckStore } from '../../store/useDeckStore';
import { useSessionStore } from '../../store/useSessionStore';
import { useCardActions } from '../../hooks/useCardActions';
import { useAudio } from '../../hooks/useAudio';
import { useSettingsStore } from '../../store/useSettingsStore';

import { useTranslation } from '../../i18n/i18nContext';
import { navigateUp } from '../../utils/navigation';

export const CardCreator = ({ startTutorial }) => {
  useInterfaceLocale();
  const { t } = useTranslation();
  const { view, setIsSettingsOpen } = useUiStore();
  const { currentDeck } = useDeckStore();
  const { runAiGenerator, stopAiGeneration, saveCard, generateAudioInternal } = useCardActions();
  const { playAudio } = useAudio();
  const { autoPlay } = useSettingsStore();

  const editingCard = useSessionStore.getState().editingCard;
  const editingCardDeckId = editingCard?.deck_id;
  const initialDeckId = editingCardDeckId !== undefined ? editingCardDeckId : (currentDeck?.id || '');
  const initialAfterCardId = editingCard?.after_card_id || null;

  const [newCardData, setNewCardData] = useState({
    front: '',
    back: '',
    context: '',
    audio_path: '',
    audio_url: '',
    image_path: '',
    image_url: '',
    flag: 0,
    deck_id: initialDeckId,
    after_card_id: initialAfterCardId
  });

  const handleBack = () => {
    navigateUp();
  };

  const [animDone, setAnimDone] = useState(false);

  useEffect(() => {
    if (view === 'creator') {
      const activeEditingCard = useSessionStore.getState().editingCard;
      const activeEditingDeckId = activeEditingCard?.deck_id;
      const targetId = activeEditingDeckId !== undefined ? activeEditingDeckId : (currentDeck?.id || '');
      const activeAfterCardId = activeEditingCard?.after_card_id || null;
      setNewCardData({
        front: '',
        back: '',
        context: '',
        flag: 0,
        deck_id: targetId,
        after_card_id: activeAfterCardId
      });
      setAnimDone(false);
    }
  }, [view, currentDeck?.id]);

  if (view !== 'creator') return null;

  const handleAiGenerate = async (actionType = 'full_card') => {
    if (!newCardData.front) return;
    const result = await runAiGenerator(newCardData.front, true, actionType);
    if (result) {
      if (actionType === 'custom_directive' || actionType === 'explain_rule') {
        const currentCtx = newCardData.context || '';
        const updatedCtx = currentCtx ? `${result.context}\n\n${currentCtx.trim()}` : result.context;
        setNewCardData({
          ...newCardData,
          context: updatedCtx
        });
      } else {
        const updated = {
          ...newCardData,
          front: result.front || newCardData.front,
          back: result.back || newCardData.back,
          context: result.context || newCardData.context,
          level: result.level || newCardData.level,
          tags: result.tags || newCardData.tags
        };
        setNewCardData(updated);
        
        setTimeout(() => {
          generateAudioInternal(updated, setNewCardData, autoPlay ? playAudio : null);
        }, 500);
      }
    }
  };

  const handleSave = () => {
    saveCard(newCardData, 'creator');
  };

  return (
    <div className="view-creator">
      <motion.div 
        initial={{ opacity: 0, y: 20 }} 
        animate={{ opacity: 1, y: 0 }} 
        onAnimationComplete={() => setAnimDone(true)}
        style={animDone ? { transform: 'none' } : {}}
        className="view"
      >
        <div className="header-compact">
          <button className="back-btn" onClick={handleBack}><ChevronLeft size={24} /></button>
          <h2>{t('creator.title', 'Новая карточка')}</h2>
          <div className="header-actions">
            <button className="header-action-btn" disabled={true} title={tr("Добавить карточку")}>
              <Plus size={22} />
            </button>
            <HelpButton onClick={() => startTutorial('creator')} />
            <button 
              className="header-action-btn settings-btn" 
              onClick={() => setIsSettingsOpen(true)}
              title={t('settings.title', 'Настройки')}
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
          onStopGeneration={stopAiGeneration}
          onGenerateAudio={generateAudioInternal}
          playAudio={playAudio}
          isCreator={true}
        />
        
      </motion.div>
    </div>
  );
};
