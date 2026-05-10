import React from 'react';
import { useUiStore } from '../../store/useUiStore';
import './UserBadge.css';

export const UserProfileBadge = () => {
  const { userProfile, setIsSettingsOpen } = useUiStore();
  
  if (!userProfile) return null;

  const { first_name, last_name, photo_url, is_guest } = userProfile;
  
  const getInitials = () => {
    const f = first_name ? first_name[0] : '';
    const l = last_name ? last_name[0] : '';
    return (f + l).toUpperCase() || 'G';
  };

  return (
    <div 
      className={`user-badge-container ${is_guest ? 'guest' : ''}`}
      onClick={() => setIsSettingsOpen(true)}
      title={is_guest ? "Настроить профиль" : "Ваш профиль"}
    >
      <div className="avatar-wrapper">
        {photo_url ? (
          <img src={photo_url} alt="Avatar" className="user-avatar" />
        ) : (
          <div className="avatar-placeholder">
            {getInitials()}
          </div>
        )}
      </div>
      <div className="user-info">
        <span className="user-name">{first_name || (is_guest ? 'Гость' : 'Пользователь')}</span>
        {is_guest && <span className="guest-label">Guest Mode</span>}
      </div>
    </div>
  );
};

export const GuestBanner = () => {
  const { userProfile } = useUiStore();
  
  if (!userProfile?.is_guest) return null;

  const handleOpenTelegram = () => {
    const guestId = userProfile?.user_id;
    window.open(`https://t.me/LerneDeutsch287_bot?start=link_${guestId}`, "_blank");
  };

  return (
    <div className="guest-banner">
      <div className="guest-banner-content">
        <span className="icon">⚠️</span>
        <p>Вы вошли как гость. Чтобы сохранить прогресс навсегда, откройте приложение в Telegram.</p>
        <button onClick={handleOpenTelegram} className="banner-btn">
          Открыть в Telegram
        </button>
      </div>
    </div>
  );
};
