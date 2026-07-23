import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { User, Mail, Send } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import { useDeckStore } from '../../store/useDeckStore';
import api from '../../services/api';
import { isOfflineMode } from '../../services/localDb';
import { syncService } from '../../services/syncService';

export const ProfileTab = () => {
  const { userProfile, setUserProfile, showToast } = useUiStore();
  const [name, setName] = useState(userProfile?.first_name || '');
  const [email, setEmail] = useState(userProfile?.email || '');
  const [phone, setPhone] = useState(userProfile?.phone || '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await api.post('/auth/sync', {
        first_name: name,
        email: email,
        phone: phone,
        is_guest: userProfile?.is_guest
      });
      
      if (res.data.status === 'ok') {
        const updatedProfile = { ...userProfile, first_name: name, email: email, phone: phone };
        setUserProfile(updatedProfile);
        localStorage.setItem('lerne_user_profile', JSON.stringify(updatedProfile));
        showToast("Профиль обновлен!", "success");
      }
    } catch (err) {
      showToast("Ошибка при сохранении");
    } finally {
      setIsSaving(false);
    }
  };

  const [isPolling, setIsPolling] = useState(false);
  const botLink = `https://t.me/LerneDeutsch287_bot?start=link_${userProfile?.user_id}`;
  
  const startPolling = async () => {
    if (isPolling) return;
    
    try {
      await api.post(`/auth/session?guest_id=${userProfile.user_id}`);
      setIsPolling(true);
      
      const interval = setInterval(async () => {
        try {
          const res = await api.get(`/auth/session/${userProfile.user_id}`);
          if (res.data.status === 'completed') {
            clearInterval(interval);
            setIsPolling(false);
            setUserProfile(res.data.user);
            localStorage.setItem('lerne_user_id', res.data.user_id);
            localStorage.setItem('lerne_user_profile', JSON.stringify(res.data.user));
            showToast("Аккаунт успешно привязан!", "success");
            
            setTimeout(() => {
              window.location.reload();
            }, 800);
          }
        } catch (e) {}
      }, 2000);
      
      setTimeout(() => {
        clearInterval(interval);
        setIsPolling(false);
      }, 120000);
    } catch (e) {}
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="profile-tab"
    >
      <h3>Ваш профиль</h3>
      <p className="tab-description">
        {userProfile?.is_guest && !userProfile?.first_name 
          ? (isPolling ? "Ожидание подтверждения в Telegram..." : "Вы используете гостевой режим. Привяжите Telegram для сохранения прогресса.")
          : "Ваш профиль настроен."}
      </p>

      <div className="profile-form">
        <div className="form-group">
          <label><User size={14} /> Имя</label>
          <input 
            type="text" 
            value={name} 
            onChange={(e) => setName(e.target.value)} 
            placeholder="Введите ваше имя"
          />
        </div>

        <div className="form-group">
          <label><Mail size={14} /> Email</label>
          <input 
            type="email" 
            value={email} 
            onChange={(e) => setEmail(e.target.value)} 
            placeholder="example@mail.com"
          />
        </div>

        <div className="form-group">
          <label>📱 Телефон</label>
          <input 
            type="text" 
            value={phone} 
            onChange={(e) => setPhone(e.target.value)} 
            placeholder="+7 (900) 000-00-00"
          />
        </div>

        {!userProfile?.is_guest && userProfile?.username && (
          <div className="form-group">
            <label><Send size={14} /> Telegram</label>
            <div className="telegram-contact-display">
              <a href={`https://t.me/${userProfile.username}`} target="_blank" rel="noopener noreferrer">
                @{userProfile.username}
              </a>
            </div>
          </div>
        )}

        <button 
          className="btn btn-primary" 
          onClick={handleSave} 
          disabled={isSaving}
        >
          {isSaving ? "Сохранение..." : "Сохранить изменения"}
        </button>

        {userProfile?.is_guest && (
          <div className="link-telegram-section glass">
            <h4>Синхронизация</h4>
            <p>Чтобы ваш прогресс был доступен на всех устройствах, используйте нашего бота.</p>
            <a 
              href={botLink} 
              target="_blank" 
              rel="noopener noreferrer" 
              className={`btn btn-telegram ${isPolling ? 'polling' : ''}`}
              onClick={startPolling}
            >
              <Send size={16} /> {isPolling ? "Ожидание..." : "Привязать Telegram"}
            </a>
          </div>
        )}

        {isOfflineMode() && (
          <div className="link-telegram-section glass" style={{ marginTop: '15px' }}>
            <h4>Локальная база данных</h4>
            <p>Данные сохраняются на вашем устройстве. Синхронизируйте их с сервером при наличии сети.</p>
            <button 
              className="btn btn-primary"
              onClick={async () => {
                showToast("Синхронизация...");
                const res = await syncService.sync();
                if (res.success) {
                  showToast("Синхронизация успешно завершена!", "success");
                  const { fetchDecks } = useDeckStore.getState();
                  fetchDecks(true);
                } else {
                  showToast(`Сбой синхронизации: ${res.reason || 'нет сети'}`);
                }
              }}
            >
              Синхронизировать сейчас
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
};

