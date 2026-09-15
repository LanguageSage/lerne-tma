import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { HelpButton } from '../TutorialOverlay';
import { useUiStore } from '../../store/useUiStore';
import { useTranslation } from '../../i18n/i18nContext';

// Modular Tabs
import { GeneralTab } from '../settings/GeneralTab';
import { DesignTab } from '../settings/DesignTab';
import { VoiceTab } from '../settings/VoiceTab';
import { AITab } from '../settings/AITab';
import { PromptsTab } from '../settings/PromptsTab';
import { ProfileTab } from '../settings/ProfileTab';
import { RemindersTab } from '../settings/RemindersTab';
import { SrsTab } from '../settings/SrsTab';
import { AutoplaySettingsTab } from '../settings/AutoplaySettingsTab';
import { useSessionStore } from '../../store/useSessionStore';

export const SettingsModal = ({ userId }) => {
  useInterfaceLocale();
  const { isSettingsOpen, setIsSettingsOpen, settingsTab, setSettingsTab } = useUiStore();
  const { t } = useTranslation();

  const ADMIN_USER_ID = 642478257;
  const isAdmin = Number(userId) === ADMIN_USER_ID;

  const activeSettingsTab = !isAdmin && settingsTab === 'ai' ? 'general' : settingsTab;
  const [customBackgrounds] = useState([]);
  const handleTabChange = setSettingsTab;

  React.useEffect(() => {
    if (isSettingsOpen) {
      const session = useSessionStore.getState();
      if (session.autoplayState === 'playing') session.pauseAutoplayFn?.();
    }
  }, [isSettingsOpen]);

  return (
    <AnimatePresence>
      {isSettingsOpen && (
        <div className="settings-overlay" onClick={() => setIsSettingsOpen(false)}>
          <motion.div 
            initial={{ opacity: 0, y: 50 }} 
            animate={{ opacity: 1, y: 0 }} 
            exit={{ opacity: 0, y: 50 }} 
            className="settings-modal wide-modal" 
            onClick={e => e.stopPropagation()}
          >
            <div className="settings-header">
              <h2>{t('settings.title', 'Настройки')}</h2>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <HelpButton topic="settings" />
                <button className="close-btn" aria-label={tr("Закрыть настройки")} title={tr("Закрыть настройки")} onClick={() => setIsSettingsOpen(false)}>
                  <X size={24} />
                </button>
              </div>
            </div>

            <div className="settings-dropdown-container">
              <label htmlFor="settings-tab-select" className="settings-dropdown-label">{tr("Раздел настроек:")}</label>
              <select
                id="settings-tab-select"
                className="settings-dropdown-select glass"
                value={activeSettingsTab}
                onChange={(e) => handleTabChange(e.target.value)}
              >
                <option value="profile">{tr("👤 Профиль")}</option>
                <option value="srs">{tr("🧠 SRS (Интервалы и память)")}</option>
                <option value="reminders">{tr("🔔 Напоминания бота")}</option>
                <option value="general">⚙️ {t('settings.tab_general', 'Общие настройки')}</option>
                <option value="design">🎨 {t('settings.tab_design', 'Дизайн')}</option>
                <option value="autoplay">▶ {tr("Авто-режим")}</option>
                <option value="voice">🗣 {t('settings.tab_voice', 'Озвучка')}</option>
                {isAdmin && <option value="ai">🤖 {t('settings.tab_models', 'Провайдеры ИИ')}</option>}
                <option value="prompts">📝 {t('settings.tab_prompts', 'Промпты ИИ')}</option>
              </select>
            </div>

            <div className="settings-content scrollable">
              {activeSettingsTab === 'profile' && <ProfileTab userId={userId} />}
              {activeSettingsTab === 'srs' && <SrsTab />}
              {activeSettingsTab === 'reminders' && <RemindersTab />}
              {activeSettingsTab === 'general' && <GeneralTab userId={userId} />}
              {activeSettingsTab === 'design' && (
                <DesignTab 
                  customBackgrounds={customBackgrounds} 
                  uploadCustomBackground={() => {}} 
                />
              )}
              {activeSettingsTab === 'autoplay' && <AutoplaySettingsTab />}
              {activeSettingsTab === 'voice' && <VoiceTab />}
              {activeSettingsTab === 'ai' && isAdmin && <AITab />}
              {activeSettingsTab === 'prompts' && <PromptsTab />}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};


