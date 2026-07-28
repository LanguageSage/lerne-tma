import React from 'react';
import { Plus, Settings, Info, Copy, ChevronLeft } from 'lucide-react';
import { UserProfileBadge } from '../common/UserBadge';
import { LanguageSelectorBadge } from './LanguageSelectorBadge';
import { NativeLanguageSelectorBadge } from './NativeLanguageSelectorBadge';
import { HelpButton } from '../TutorialOverlay';
import { useTranslation } from '../../i18n/i18nContext';

export const DeckGridHeader = ({
  personalLink,
  startTutorial,
  setIsNewDeckModalOpen,
  setIsSettingsOpen,
  showToast,
  onLanguageChange,
  activeFolderId,
  onFolderBack
}) => {
  const { t } = useTranslation();

  return (
    <div className="header">
      <div className="header-title-row">
        <div className="header-left">
          {activeFolderId !== null && (
            <button 
              className="back-btn" 
              onClick={onFolderBack}
              title={t('common.back', 'Назад')}
              aria-label="Назад"
            >
              <ChevronLeft size={24} />
            </button>
          )}
          <div>
            <div className="user-profile-and-lang">
              <UserProfileBadge />
              <LanguageSelectorBadge onLanguageChange={onLanguageChange} />
              <NativeLanguageSelectorBadge />
            </div>
            <h1>Lerne TMA</h1>
          </div>
        </div>
        <div className="header-actions">
          <HelpButton onClick={() => startTutorial('decks')} />
          <button 
            id="tut-add-deck" 
            className="add-deck-btn" 
            onClick={() => setIsNewDeckModalOpen(true)}
            title={t('decks.add_deck', 'Создать новую колоду')}
          >
            <Plus size={20} />
          </button>
          <button 
            id="tut-main-settings" 
            className="settings-btn" 
            onClick={(e) => { e.stopPropagation(); setIsSettingsOpen(true); }}
            title={t('settings.title', 'Настройки')}
          >
            <Settings size={20} />
          </button>
        </div>
      </div>
      <p>{t('decks.subtitle', 'Выберите колоду и начните обучение')}</p>
      
      {personalLink && (
        <div className="commercial-info glass">
          <Info size={16} />
          <div className="web-link-container">
            <span>{t('decks.link', 'Персональная ссылка:')} </span>
            <code className="web-link">{personalLink}</code>
            <button 
              className="copy-link-btn" 
              onClick={() => {
                navigator.clipboard.writeText(personalLink);
                showToast(t('decks.copied', 'Ссылка скопирована!'), 'success');
              }}
              title={t('decks.copy', 'Копировать ссылку')}
            >
              <Copy size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

