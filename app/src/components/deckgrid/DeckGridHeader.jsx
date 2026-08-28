import React from 'react';
import { Plus, Settings, ChevronLeft, Search } from 'lucide-react';
import { UserProfileBadge } from '../common/UserBadge';
import { LanguageSelectorBadge } from './LanguageSelectorBadge';
import { NativeLanguageSelectorBadge } from './NativeLanguageSelectorBadge';
import { HelpButton } from '../TutorialOverlay';
import { useTranslation } from '../../i18n/i18nContext';

export const DeckGridHeader = ({
  startTutorial,
  setIsNewDeckModalOpen,
  setIsSettingsOpen,
  onLanguageChange,
  activeFolderId,
  onFolderBack,
  isSearchOpen,
  onToggleSearch,
  hasSearchQuery
}) => {
  const { t } = useTranslation();

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
            className={`header-action-btn search-toggle-btn ${isSearchOpen ? 'active' : ''}`} 
            onClick={onToggleSearch}
            title="Поиск колод и папок"
            style={{
              color: (isSearchOpen || hasSearchQuery) ? '#818cf8' : 'currentColor',
              background: (isSearchOpen || hasSearchQuery) ? 'rgba(129, 140, 248, 0.2)' : undefined,
              borderColor: (isSearchOpen || hasSearchQuery) ? 'rgba(129, 140, 248, 0.5)' : undefined
            }}
          >
            <Search size={20} />
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

      {activeFolderId === null && (
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
      )}
    </div>
  );
};

