import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { User, Mail, Send } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import api from '../../services/api';

export const ProfileTab = () => {
  const { userProfile, setUserProfile, showToast } = useUiStore();
  const [name, setName] = useState(userProfile?.first_name || '');
  const [email, setEmail] = useState(userProfile?.email || '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await api.post('/auth/sync', {
        first_name: name,
        email: email,
        is_guest: userProfile?.is_guest
      });
      
      if (res.data.status === 'ok') {
        const updatedProfile = { ...userProfile, first_name: name, email: email };
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

  const handleLinkTelegram = () => {
    const guestId = userProfile?.user_id;
    window.open(`https://t.me/LerneDeutsch287_bot?start=link_${guestId}`, "_blank");
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="profile-tab"
    >
      <h3>Ваш профиль</h3>
      <p className="tab-description">
        {userProfile?.is_guest 
          ? "Вы используете гостевой режим. Укажите имя и почту, или привяжите Telegram для сохранения прогресса." 
          : "Ваш аккаунт привязан к Telegram."}
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
            <button className="btn btn-telegram" onClick={handleLinkTelegram}>
              <Send size={16} /> Открыть в Telegram
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
};
