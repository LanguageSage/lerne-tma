import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Lock, Send } from 'lucide-react';
import { useUiStore } from '../store/useUiStore';

export const AuthRequiredModal = ({ isOpen, onClose, title = "Требуется авторизация" }) => {
  if (!isOpen) return null;

  const botUrl = "https://t.me/LerneDeutsch287_bot";

  const handleOpenTelegram = () => {
    const tg = window.Telegram?.WebApp;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(botUrl);
    } else {
      window.open(botUrl, '_blank');
    }
    if (onClose) onClose();
  };

  return (
    <AnimatePresence>
      <div className="settings-overlay" onClick={onClose} style={{ zIndex: 1100 }}>
        <motion.div 
          initial={{ opacity: 0, scale: 0.9, y: 20 }} 
          animate={{ opacity: 1, scale: 1, y: 0 }} 
          exit={{ opacity: 0, scale: 0.9, y: 20 }} 
          className="settings-modal" 
          onClick={e => e.stopPropagation()}
          style={{ maxWidth: 360, textAlign: 'center', padding: '24px 20px' }}
        >
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: -10 }}>
            <button className="close-btn" onClick={onClose}><X size={20} /></button>
          </div>

          <div style={{
            width: 64, height: 64, borderRadius: 20,
            background: 'linear-gradient(135deg, rgba(99,102,241,0.25), rgba(168,85,247,0.25))',
            border: '1px solid rgba(168,85,247,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px'
          }}>
            <Lock size={30} color="#c084fc" />
          </div>

          <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'white', marginBottom: 8 }}>
            {title}
          </h3>

          <p style={{ fontSize: '0.9rem', color: '#94a3b8', lineHeight: 1.5, marginBottom: 24 }}>
            Чтобы создавать карточки, сохранять колоды и не терять прогресс обучения, откройте Lerne в Telegram!
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button 
              className="btn btn-primary btn-full" 
              onClick={handleOpenTelegram}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                padding: '14px', borderRadius: 14, fontWeight: 600, fontSize: '0.95rem'
              }}
            >
              <Send size={18} /> Войти через Telegram
            </button>
            <button 
              className="btn-secondary btn-full" 
              onClick={onClose}
              style={{ padding: '12px', borderRadius: 14, fontSize: '0.85rem' }}
            >
              Понятно, позже
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
