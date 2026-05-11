import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { HelpButton } from './TutorialOverlay';
import { useUiStore } from '../store/useUiStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useDeckStore } from '../store/useDeckStore';
import api from '../services/api';

// Modular Tabs
import { GeneralTab } from './settings/GeneralTab';
import { DesignTab } from './settings/DesignTab';
import { VoiceTab } from './settings/VoiceTab';
import { AITab } from './settings/AITab';
import { PromptsTab } from './settings/PromptsTab';
import { PresetsTab } from './settings/PresetsTab';
import { CommunityTab } from './settings/CommunityTab';
import { FeedbackTab } from './settings/FeedbackTab';
import { ProfileTab } from './settings/ProfileTab';

export const SettingsModal = ({ userId, startTutorial }) => {
  const { isSettingsOpen, setIsSettingsOpen, showToast } = useUiStore();
  const { isAdmin, adminSettings, setAdminSettings, userPrompts, setUserPrompts, applyDesignPreset } = useSettingsStore();
  const { communityDecks, setCommunityDecks } = useDeckStore();

  const [activeSettingsTab, setActiveSettingsTab] = useState('general');
  const [newPresetName, setNewPresetName] = useState('');
  const [presets, setPresets] = useState([]);
  const [customBackgrounds, setCustomBackgrounds] = useState([]);

  if (!isSettingsOpen) return null;

  const handleCommunityClick = async () => {
    setActiveSettingsTab('community');
    try {
      const res = await api.get('/decks/community');
      setCommunityDecks(res.data);
    } catch (err) {
      showToast("Ошибка загрузки сообщества");
    }
  };

  const saveCurrentAsPreset = async () => {
    if (!newPresetName) return;
    try {
      const currentSettings = useSettingsStore.getState();
      const presetData = {
        name: newPresetName,
        settings: {
          cardFont: currentSettings.cardFont,
          cardTextColor: currentSettings.cardTextColor,
          cardFontSize: currentSettings.cardFontSize,
          cardFontWeight: currentSettings.cardFontWeight,
          cardFontStyle: currentSettings.cardFontStyle,
          cardTextShadow: currentSettings.cardTextShadow,
          cardBgFront: currentSettings.cardBgFront,
          cardBgBack: currentSettings.cardBgBack,
          contextFont: currentSettings.contextFont,
          contextTextColor: currentSettings.contextTextColor,
          contextFontSize: currentSettings.contextFontSize,
          contextFontWeight: currentSettings.contextFontWeight,
          contextFontStyle: currentSettings.contextFontStyle,
          contextTextShadow: currentSettings.contextTextShadow
        }
      };
      await api.post('/settings/presets', presetData);
      showToast("Пресет сохранен", "success");
      setNewPresetName('');
      fetchPresets();
    } catch (err) {
      showToast("Ошибка сохранения пресета");
    }
  };

  const fetchPresets = async () => {
    try {
      const res = await api.get('/settings/presets');
      setPresets(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const deletePreset = async (name) => {
    try {
      await api.delete(`/settings/presets/${encodeURIComponent(name)}`);
      fetchPresets();
      showToast("Пресет удален", "success");
    } catch (err) {
      showToast("Ошибка удаления");
    }
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
            <button className={`tab-btn ${activeSettingsTab === 'profile' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('profile')}>Профиль</button>
            <button className={`tab-btn ${activeSettingsTab === 'general' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('general')}>Общие</button>
            <button className={`tab-btn ${activeSettingsTab === 'design' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('design')}>Дизайн</button>
            <button className={`tab-btn ${activeSettingsTab === 'voice' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('voice')}>Озвучка</button>
            <button className={`tab-btn ${activeSettingsTab === 'ai' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('ai')}>Провайдеры</button>
            <button className={`tab-btn ${activeSettingsTab === 'prompts' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('prompts')}>Промпты</button>
            <button className={`tab-btn ${activeSettingsTab === 'presets' ? 'active' : ''}`} onClick={() => { setActiveSettingsTab('presets'); fetchPresets(); }}>Пресеты</button>
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
              {activeSettingsTab === 'profile' && <ProfileTab />}
              {activeSettingsTab === 'general' && <GeneralTab userId={userId} />}
              {activeSettingsTab === 'design' && (
                <DesignTab 
                  customBackgrounds={customBackgrounds} 
                  uploadCustomBackground={() => {}} // Placeholder or implement
                />
              )}
              {activeSettingsTab === 'voice' && <VoiceTab />}
              {activeSettingsTab === 'ai' && <AITab />}
              {activeSettingsTab === 'prompts' && <PromptsTab />}
              {activeSettingsTab === 'presets' && (
                <PresetsTab 
                  newPresetName={newPresetName} 
                  setNewPresetName={setNewPresetName} 
                  saveCurrentAsPreset={saveCurrentAsPreset} 
                  presets={presets} 
                  applyPreset={applyDesignPreset} 
                  deletePreset={deletePreset} 
                />
              )}
              {activeSettingsTab === 'community' && (
                <CommunityTab 
                  communityDecks={communityDecks} 
                  promoteDeck={() => {}} // Implement if needed
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
