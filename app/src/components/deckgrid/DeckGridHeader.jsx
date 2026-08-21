import React from 'react';
import { Plus, Settings, Info, Copy, ChevronLeft, ExternalLink } from 'lucide-react';
import { UserProfileBadge } from '../common/UserBadge';
import { LanguageSelectorBadge } from './LanguageSelectorBadge';
import { NativeLanguageSelectorBadge } from './NativeLanguageSelectorBadge';
import { HelpButton } from '../TutorialOverlay';
import { useTranslation } from '../../i18n/i18nContext';
import { openExternalLink } from '../../utils/platform';

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

  const handleOpenLink = (e) => {
    e.preventDefault();
    if (!personalLink) return;
    openExternalLink(personalLink);
  };

  return (
    <div className="header">
      <div className="header-top-row">
        <div className="header-top-left">
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
          <UserProfileBadge />
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

      <div className="header-title-section">
        <h1>Lerne TMA</h1>
        <p>{t('decks.subtitle', 'Выберите колоду и начните обучение')}</p>
      </div>

      <div className="header-languages-bar">
        <div className="header-lang-item">
          <span className="header-lang-label">{t('header.target_lang', 'Изучаемый язык')}</span>
          <LanguageSelectorBadge onLanguageChange={onLanguageChange} />
        </div>
        <div className="header-lang-item">
          <span className="header-lang-label">{t('header.native_lang', 'Язык интерфейса')}</span>
          <NativeLanguageSelectorBadge />
        </div>
      </div>
      
      {personalLink && (
        <div className="commercial-info glass">
          <Info size={16} />
          <div className="web-link-container">
            <span>{t('decks.link', 'Персональная ссылка:')} </span>
            <a
              href={personalLink}
              target="_blank"
              rel="noopener noreferrer"
              className="web-link"
              onClick={handleOpenLink}
              title={t('decks.open_link', 'Открыть ссылку в браузере по умолчанию')}
            >
              <span>{personalLink}</span>
              <ExternalLink size={12} style={{ flexShrink: 0 }} />
            </a>
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

