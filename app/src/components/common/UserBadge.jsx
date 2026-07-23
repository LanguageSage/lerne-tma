import React from 'react';
import { useUiStore } from '../../store/useUiStore';
import api from '../../services/api';
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
        {(is_guest && !first_name) && <span className="guest-label">Guest Mode</span>}
      </div>
    </div>
  );
};

export const GuestBanner = () => {
  const { userProfile, setUserProfile } = useUiStore();
  const [isPolling, setIsPolling] = React.useState(false);
  
  if (!userProfile?.is_guest) return null;

  const botLink = `https://t.me/LerneDeutsch287_bot?start=link_${userProfile?.user_id}`;
  
  const startPolling = async () => {
    if (isPolling) return;
    
    try {
      // Create session on backend
      await api.post(`/auth/session?guest_id=${userProfile.user_id}`);
      setIsPolling(true);
      
      const interval = setInterval(async () => {
        try {
          const res = await api.get(`/auth/session/${userProfile.user_id}`);
          if (res.data.status === 'completed') {
            clearInterval(interval);
            setIsPolling(false);
            
            // Update profile
            const newProfile = res.data.user;
            setUserProfile(newProfile);
            localStorage.setItem('lerne_user_id', newProfile.user_id);
            localStorage.setItem('lerne_user_profile', JSON.stringify(newProfile));
            
            // Reload page to fetch decks and settings for the real user
            setTimeout(() => {
              window.location.reload();
            }, 500);
          }
        } catch (e) {
          console.error("Polling error:", e);
        }
      }, 2000);
      
      // Cleanup after 2 minutes
      setTimeout(() => {
        clearInterval(interval);
        setIsPolling(false);
      }, 120000);
      
    } catch (e) {
      console.error("Failed to start session:", e);
    }
  };

  return (
    <div className="guest-banner">
      <div className="guest-banner-content">
        <span className="icon">{isPolling ? "⌛" : "⚠️"}</span>
        <p>
          {isPolling 
            ? "Ожидание подтверждения в Telegram... Пожалуйста, нажмите кнопку 'Старт' в боте."
            : "Вы вошли как гость. Чтобы сохранить прогресс навсегда, откройте приложение в Telegram."}
        </p>
        <a 
          href={botLink} 
          target="_blank" 
          rel="noopener noreferrer" 
          className={`banner-btn ${isPolling ? 'polling' : ''}`}
          onClick={startPolling}
        >
          {isPolling ? "Открыто в Telegram" : "Открыть в Telegram"}
        </a>
      </div>
    </div>
  );
};
