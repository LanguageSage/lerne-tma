import React, { useState } from 'react';
import { User } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import api from '../../services/api';
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
            localStorage.removeItem('lerne_last_sync_time');
            localStorage.removeItem('lerne_last_sync_user_id');
            
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
