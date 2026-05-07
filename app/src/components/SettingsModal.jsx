import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { HelpButton } from './TutorialOverlay';

// Modular Tabs
import { GeneralTab } from './settings/GeneralTab';
import { DesignTab } from './settings/DesignTab';
import { VoiceTab } from './settings/VoiceTab';
import { AITab } from './settings/AITab';
import { PromptsTab } from './settings/PromptsTab';
import { PresetsTab } from './settings/PresetsTab';
import { CommunityTab } from './settings/CommunityTab';
import { FeedbackTab } from './settings/FeedbackTab';

export const SettingsModal = ({
  isSettingsOpen,
  setIsSettingsOpen,
  activeSettingsTab,
  setActiveSettingsTab,
  isAdmin,
  userId,
  saveAdminSettings,
  availableModels,
  fetchModels,
  isFetchingModels,
  saveUserPrompts,
  newPresetName,
  setNewPresetName,
  saveCurrentAsPreset,
  presets,
  applyPreset,
  deletePreset,
  communityDecks,
  fetchCommunityDecks,
  promoteDeck,
  customBackgrounds,
  uploadCustomBackground,
  startTutorial,
  showToast
}) => {
  if (!isSettingsOpen) return null;

  const handleCommunityClick = () => {
    setActiveSettingsTab('community');
    fetchCommunityDecks();
  };

  return (
    <AnimatePresence>
      <div className="settings-overlay" onClick={() => setIsSettingsOpen(false)}>
        <motion.div 
          initial={{ opacity: 0, y: 50 }} 
          animate={{ opacity: 1, y: 0 }} 
          exit={{ opacity: 0, y: 50 }} 
          className="settings-modal wide-modal" 
          onClick={e => e.stopPropagation()}
        >
          <div className="settings-header">
            <h2>Настройки</h2>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <HelpButton onClick={() => startTutorial('settings')} />
              <button className="close-btn" onClick={() => setIsSettingsOpen(false)}>
                <X size={24} />
              </button>
            </div>
          </div>

          <div id="tut-settings-tabs" className="settings-tabs">
            <button className={`tab-btn ${activeSettingsTab === 'general' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('general')}>Общие</button>
            <button className={`tab-btn ${activeSettingsTab === 'design' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('design')}>Дизайн</button>
            <button className={`tab-btn ${activeSettingsTab === 'voice' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('voice')}>Озвучка</button>
            <button className={`tab-btn ${activeSettingsTab === 'ai' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('ai')}>Провайдеры</button>
            <button className={`tab-btn ${activeSettingsTab === 'prompts' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('prompts')}>Промпты</button>
            <button className={`tab-btn ${activeSettingsTab === 'presets' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('presets')}>Пресеты</button>
            {isAdmin && (
              <button 
                className={`tab-btn ${activeSettingsTab === 'community' ? 'active' : ''}`} 
                onClick={handleCommunityClick}
              >
                Сообщество
              </button>
            )}
            <button className={`tab-btn ${activeSettingsTab === 'feedback' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('feedback')}>Отзыв</button>
          </div>

          <div className="settings-content scrollable">
            <AnimatePresence mode="wait">
              {activeSettingsTab === 'general' && <GeneralTab userId={userId} />}
              {activeSettingsTab === 'design' && (
                <DesignTab 
                  customBackgrounds={customBackgrounds} 
                  uploadCustomBackground={uploadCustomBackground} 
                />
              )}
              {activeSettingsTab === 'voice' && <VoiceTab saveAdminSettings={saveAdminSettings} />}
              {activeSettingsTab === 'ai' && (
                <AITab 
                  availableModels={availableModels} 
                  fetchModels={fetchModels} 
                  isFetchingModels={isFetchingModels} 
                  saveAdminSettings={saveAdminSettings} 
                />
              )}
              {activeSettingsTab === 'prompts' && <PromptsTab saveUserPrompts={saveUserPrompts} />}
              {activeSettingsTab === 'presets' && (
                <PresetsTab 
                  newPresetName={newPresetName} 
                  setNewPresetName={setNewPresetName} 
                  saveCurrentAsPreset={saveCurrentAsPreset} 
                  presets={presets} 
                  applyPreset={applyPreset} 
                  deletePreset={deletePreset} 
                />
              )}
              {activeSettingsTab === 'community' && (
                <CommunityTab 
                  communityDecks={communityDecks} 
                  promoteDeck={promoteDeck} 
                />
              )}
              {activeSettingsTab === 'feedback' && <FeedbackTab showToast={showToast} />}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
