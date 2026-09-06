import React, { useState } from 'react';
import { User } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import { useAuthStore } from '../../store/useAuthStore';
import './UserBadge.css';

export const UserProfileBadge = () => {
  const { userProfile, openSettings } = useUiStore();
  const [imgError, setImgError] = useState(false);
  
  if (!userProfile) return null;

  const { first_name, last_name, username, photo_url, is_guest } = userProfile;
  
  const validName = (first_name && first_name !== 'Пользователь') ? first_name : null;
  const displayName = validName 
    ? validName 
    : (username ? `@${username}` : (is_guest ? 'Гость' : 'Профиль'));

  const getInitials = () => {
    if (validName) {
      const parts = validName.trim().split(/\s+/);
      if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
      }
      if (last_name) {
        return (validName[0] + last_name[0]).toUpperCase();
      }
      return validName.slice(0, 2).toUpperCase();
    }
    if (username) {
      return username.slice(0, 2).toUpperCase();
    }
    return null;
  };

  const initials = getInitials();

  return (
    <div 
      className={`user-badge-container ${is_guest ? 'guest' : ''}`}
      onClick={() => openSettings('profile')}
      title={is_guest ? "Настроить профиль" : "Ваш профиль"}
    >
      <div className="avatar-wrapper">
        {photo_url && !imgError ? (
          <img 
            src={photo_url} 
            alt="Avatar" 
            className="user-avatar" 
            onError={() => setImgError(true)} 
          />
        ) : (
          <div className="avatar-placeholder">
            {initials ? initials : <User size={16} />}
          </div>
        )}
      </div>
      <div className="user-info">
        <span className="user-name">{displayName}</span>
        {(is_guest && !validName) && <span className="guest-label">Guest Mode</span>}
      </div>
    </div>
  );
};

export const GuestBanner = () => {
  const { userProfile } = useUiStore();
  const { 
    isPolling, 
    checkPendingSession 
  } = useAuthStore();
  
  if (!userProfile?.is_guest) return null;

  const handleOpenAuthModal = () => {
    useUiStore.getState().setIsAuthModalOpen(true, "Вход в аккаунт");
  };

  return (
    <div className="guest-banner">
      <div className="guest-banner-content">
        <span className="icon">{isPolling ? "⌛" : "⚠️"}</span>
        <p>
          {isPolling 
            ? "Ожидание подтверждения в боте... Нажмите кнопку «Старт» в Telegram и вернитесь сюда."
            : "Вы вошли как гость. Авторизуйтесь через Telegram или по 6-значному коду, чтобы сохранить колоды!"}
        </p>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {isPolling ? (
            <button
              type="button"
              className="banner-btn"
              onClick={() => checkPendingSession()}
              style={{ background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none' }}
            >
              Я подтвердил
            </button>
          ) : (
            <button 
              type="button"
              className="banner-btn"
              onClick={handleOpenAuthModal}
            >
              Войти в аккаунт
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
