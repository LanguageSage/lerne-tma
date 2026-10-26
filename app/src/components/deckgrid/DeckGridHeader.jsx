import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React from 'react';
import { Plus, Settings, ChevronLeft, Search, BookOpen, MessageSquare } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import { getAccessToken, getUserId } from '../../utils/auth';
import { networkApi } from '../../services/api';
import { useAuthStore } from '../../store/useAuthStore';
import { UserProfileBadge } from '../common/UserBadge';
import { LanguageSelectorBadge } from './LanguageSelectorBadge';
import { NativeLanguageSelectorBadge } from './NativeLanguageSelectorBadge';
import { HelpButton } from '../TutorialOverlay';
import { useTranslation } from '../../i18n/i18nContext';

export const DeckGridHeader = ({
  setIsNewDeckModalOpen,
  setIsSettingsOpen,
  onLanguageChange,
  activeFolderId,
  canCreateContent = true,
  onFolderBack,
  isSearchOpen,
  onToggleSearch,
  hasSearchQuery
}) => {
  useInterfaceLocale();
  const { t } = useTranslation();
  const userProfile = useUiStore(state => state.userProfile);
  const profileId = userProfile?.user_id;
  const isGuest = userProfile?.is_guest;
  const messageRoots = useUiStore(state => state.messageRoots);
  const unreadCount = messageRoots.reduce((sum, row) => sum + row.unread_count, 0);

  React.useEffect(() => {
    if (!profileId || isGuest || !getUserId()) {
      useUiStore.getState().setMessageRoots([]);
      return;
    }
    let active = true;
    networkApi.get('/messages').then(({ data }) => {
      if (active && getUserId() === profileId) useUiStore.getState().setMessageRoots(data);
    }).catch(() => {}); // The messages screen shows actionable errors on open.
    return () => { active = false; };
  }, [profileId, isGuest]);

  return (
    <>
      <div className="header-top-row">
        <div className="header-top-left">
          {activeFolderId !== null && (
            <button 
              className="back-btn" 
              onClick={onFolderBack}
              title={t('common.back', 'Назад')}
              aria-label={tr("Назад")}
            >
              <ChevronLeft size={24} />
            </button>
          )}
          <UserProfileBadge />
        </div>
        <div className="header-actions">
          <button type="button" className="header-action-btn message-nav-button"
            onClick={() => {
              if (!getUserId() || userProfile?.is_guest) {
                useUiStore.getState().setIsAuthModalOpen(true, tr('Вход в аккаунт'));
              } else useUiStore.getState().setView('messages');
            }} aria-label={`${tr('Мои сообщения')}${unreadCount ? `, ${tr('Непрочитанных сообщений: {{p0}}', { p0: unreadCount })}` : ''}`}
            title={tr('Мои сообщения')}>
            <MessageSquare size={20} aria-hidden="true" />
            <span className="message-nav-label">{tr('Мои сообщения')}</span>
            {unreadCount > 0 && <span className="message-unread-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
          </button>
          <HelpButton topic="decks" />
          {canCreateContent && <button 
            id="tut-add-deck" 
            className="add-deck-btn" 
            onClick={() => setIsNewDeckModalOpen(true)}
            title={t('decks.add_deck', 'Создать новую колоду')}
          >
            <Plus size={20} />
          </button>}
          <button 
            className={`header-action-btn search-toggle-btn ${isSearchOpen ? 'active' : ''}`} 
            onClick={onToggleSearch}
            title={tr("Поиск колод и папок")}
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

      {activeFolderId === null && (
        <div className="header-title-section">
          <h1>Lerne TMA</h1>
          <p>{t('decks.subtitle', 'Выберите колоду и начните обучение')}</p>
          <button className="game-entry" onClick={() => {
            const ui = useUiStore.getState();
            if (getAccessToken() || useAuthStore.getState().isRestoring) ui.setView('game');
            else ui.setIsAuthModalOpen(true, tr('Войдите в аккаунт, чтобы начать разговор.'));
          }}><BookOpen size={20} /><span>Game Mode · Stadtbibliothek</span><small>{tr('Эксперимент')}</small></button>
        </div>
      )}

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
    </>
  );
};

