import React from 'react';
import { Plus, Settings, Info, Copy } from 'lucide-react';
import { UserProfileBadge } from '../common/UserBadge';
import { LanguageSelectorBadge } from './LanguageSelectorBadge';
import { HelpButton } from '../TutorialOverlay';

export const DeckGridHeader = ({
  personalLink,
  startTutorial,
  setIsNewDeckModalOpen,
  setIsSettingsOpen,
  showToast,
  onLanguageChange
}) => {
  return (
    <div className="header">
      <div className="header-title-row">
        <div className="header-left">
          <div className="user-profile-and-lang">
            <UserProfileBadge />
            <LanguageSelectorBadge onLanguageChange={onLanguageChange} />
          </div>
          <h1>Lerne TMA</h1>
        </div>
        <div className="header-actions">
          <HelpButton onClick={() => startTutorial('decks')} />
          <button 
            id="tut-add-deck" 
            className="add-deck-btn" 
            onClick={() => setIsNewDeckModalOpen(true)}
            title="Создать новую колоду"
          >
            <Plus size={20} />
          </button>
          <button 
            id="tut-main-settings" 
            className="settings-btn" 
            onClick={(e) => { e.stopPropagation(); setIsSettingsOpen(true); }}
            title="Настройки"
          >
            <Settings size={20} />
          </button>
        </div>
      </div>
      <p>Выбирайте колоду и начните обучение</p>
      
      {personalLink && (
        <div className="commercial-info glass">
          <Info size={16} />
          <div className="web-link-container">
            <span>Персональная ссылка: </span>
            <code className="web-link">{personalLink}</code>
            <button 
              className="copy-link-btn" 
              onClick={() => {
                navigator.clipboard.writeText(personalLink);
                showToast("Ссылка скопирована!", "success");
              }}
              title="Копировать ссылку"
            >
              <Copy size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
