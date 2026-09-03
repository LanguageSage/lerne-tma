import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Mail, Phone, Send, Sparkles, CheckCircle2 } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import { useDeckStore } from '../../store/useDeckStore';
import api from '../../services/api';
import { getUserId, storage } from '../../utils/auth';

export const RegisterModal = ({ isOpen, onClose, onSuccess }) => {
  const { setUserProfile, showToast, setIsAccountDeleted } = useUiStore();
  const { fetchDecks } = useDeckStore();
  
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [isPolling, setIsPolling] = useState(false);

  const currentUserId = getUserId();
  const botLink = `https://t.me/LerneDeutsch287_bot?start=link_${currentUserId}`;

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!name.trim()) {
      showToast("Пожалуйста, введите ваше имя", "error");
      return;
    }

    setLoading(true);
    try {
      const res = await api.post('/auth/sync', {
        first_name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        is_guest: false
      });

      if (res.data.status === 'ok' && res.data.user) {
        const newProfile = res.data.user;
        setUserProfile(newProfile);
        storage.set('lerne_user_profile', JSON.stringify(newProfile));
        storage.set('lerne_user_id', newProfile.user_id);
        
        setIsAccountDeleted(false);
        showToast("Профиль успешно создан!", "success");
        
        await fetchDecks(true);
        onSuccess?.();
        onClose?.();
      }
    } catch (err) {
      console.error("Registration error:", err);
      showToast("Ошибка при создании профиля", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleTelegramLink = async () => {
    if (isPolling) return;
    try {
      await api.post(`/auth/session?guest_id=${currentUserId}`);
      setIsPolling(true);

      const interval = setInterval(async () => {
        try {
          const res = await api.get(`/auth/session/${currentUserId}`);
          if (res.data.status === 'completed') {
            clearInterval(interval);
            setIsPolling(false);
            const tgUser = res.data.user;
            setUserProfile(tgUser);
            storage.set('lerne_user_id', tgUser.user_id);
            storage.set('lerne_user_profile', JSON.stringify(tgUser));
            storage.remove('lerne_last_sync_time');
            storage.remove('lerne_last_sync_user_id');
            setIsAccountDeleted(false);
            showToast("Успешный вход через Telegram!", "success");
            
            setTimeout(() => {
              window.location.reload();
            }, 600);
          }
        } catch { /* ignore */ }
      }, 2000);

      setTimeout(() => {
        clearInterval(interval);
        setIsPolling(false);
      }, 120000);
    } catch {
      showToast("Не удалось запустить привязку", "error");
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="settings-overlay" onClick={onClose}>
          <motion.div
            className="settings-modal"
            style={{ maxWidth: 440, width: '100%', padding: '24px', margin: 'auto' }}
            initial={{ scale: 0.92, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 20 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="settings-header" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 12,
                  background: 'linear-gradient(135deg, rgba(99,102,241,0.3), rgba(168,85,247,0.3))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <Sparkles size={20} color="#a855f7" />
                </div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'white' }}>
                  Создание профиля
                </h2>
              </div>
              <button className="close-btn" onClick={onClose}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ fontSize: '0.85rem', color: '#94a3b8', margin: '0 0 4px 0', lineHeight: 1.4 }}>
                Укажите данные для сохранения личного прогресса и доступа с любого устройства.
              </p>

              {/* Name */}
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: '#cbd5e1', marginBottom: 6 }}>
                  <User size={14} color="#818cf8" /> Ваше имя *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Как к вам обращаться"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{
                    width: '100%', padding: '12px 14px', borderRadius: 12,
                    background: 'rgba(255, 255, 255, 0.06)', border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: 'white', fontSize: '0.92rem', outline: 'none'
                  }}
                />
              </div>

              {/* Email */}
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: '#cbd5e1', marginBottom: 6 }}>
                  <Mail size={14} color="#818cf8" /> Email (электронная почта)
                </label>
                <input
                  type="email"
                  placeholder="example@mail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={{
                    width: '100%', padding: '12px 14px', borderRadius: 12,
                    background: 'rgba(255, 255, 255, 0.06)', border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: 'white', fontSize: '0.92rem', outline: 'none'
                  }}
                />
              </div>

              {/* Phone */}
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: '#cbd5e1', marginBottom: 6 }}>
                  <Phone size={14} color="#818cf8" /> Телефон (опционально)
                </label>
                <input
                  type="tel"
                  placeholder="+7 (900) 000-00-00"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  style={{
                    width: '100%', padding: '12px 14px', borderRadius: 12,
                    background: 'rgba(255, 255, 255, 0.06)', border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: 'white', fontSize: '0.92rem', outline: 'none'
                  }}
                />
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
                style={{
                  width: '100%', padding: '14px', borderRadius: 14,
                  fontSize: '0.96rem', fontWeight: 700, marginTop: 6,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                }}
              >
                <CheckCircle2 size={18} />
                <span>{loading ? "Сохранение..." : "Создать аккаунт и начать"}</span>
              </button>

              {/* Divider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '8px 0' }}>
                <div style={{ flex: 1, height: 1, background: 'rgba(255, 255, 255, 0.1)' }} />
                <span style={{ fontSize: '0.78rem', color: '#64748b' }}>ИЛИ</span>
                <div style={{ flex: 1, height: 1, background: 'rgba(255, 255, 255, 0.1)' }} />
              </div>

              {/* Telegram Link Option */}
              <a
                href={botLink}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleTelegramLink}
                className={`btn btn-secondary ${isPolling ? 'polling' : ''}`}
                style={{
                  width: '100%', padding: '12px', borderRadius: 14,
                  fontSize: '0.88rem', fontWeight: 600,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  background: 'rgba(34, 158, 217, 0.12)', borderColor: 'rgba(34, 158, 217, 0.3)', color: '#38bdf8',
                  textDecoration: 'none'
                }}
              >
                <Send size={16} />
                <span>{isPolling ? "Ожидание в Telegram..." : "Войти через Telegram в 1 клик"}</span>
              </a>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
