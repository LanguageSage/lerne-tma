import { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, Plus, Settings } from 'lucide-react';
import { HelpButton } from '../TutorialOverlay';
import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import { useUiStore } from '../../store/useUiStore';
import { navigateUp } from '../../utils/navigation';

export function CardEditorShell({ view, title, settingsTitle, onBack = null, children }) {
  useInterfaceLocale();
  const setIsSettingsOpen = useUiStore(state => state.setIsSettingsOpen);
  const [animDone, setAnimDone] = useState(false);

  return (
    <div className={`view-${view}`}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        onAnimationComplete={() => setAnimDone(true)}
        style={animDone ? { transform: 'none' } : {}}
        className="view"
      >
        <div className="header-compact">
          <button
            type="button"
            className="back-btn"
            onClick={onBack || navigateUp}
            aria-label={tr('Назад')}
            title={tr('Назад')}
          >
            <ChevronLeft size={24} />
          </button>
          <h2>{title}</h2>
          <div className="header-actions">
            <button className="header-action-btn" disabled title={tr('Добавить карточку')}>
              <Plus size={22} />
            </button>
            <HelpButton topic="creator" />
            <button className="header-action-btn settings-btn" onClick={() => setIsSettingsOpen(true)}
              title={settingsTitle ?? tr('Настройки')}>
              <Settings size={22} />
            </button>
          </div>
        </div>
        {children}
      </motion.div>
    </div>
  );
}
