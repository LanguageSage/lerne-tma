import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, RefreshCw, UserPlus, LogOut } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import { useDeckStore } from '../../store/useDeckStore';
import { RegisterModal } from '../modals/RegisterModal';
import { storage } from '../../utils/auth';

export const AccountDeletedScreen = () => {
  const { isAccountDeleted, setIsAccountDeleted, setUserProfile, showToast } = useUiStore();
  const { fetchDecks } = useDeckStore();
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [closedMessage, setClosedMessage] = useState(false);

  if (!isAccountDeleted) return null;

  const handleStartGuest = async () => {
    // 1. Clear all local storage
    storage.remove('lerne_user_id');
    storage.remove('lerne_user_profile');
    storage.remove('lerne_init_cache');
    storage.remove('lerne_current_deck_id');

    // 2. Generate clean guest ID
    const newGuestId = Math.floor(100000000 + Math.random() * 900000000);
    const guestProfile = {
      user_id: newGuestId,
      first_name: 'Пользователь',
      is_guest: true
    };
    storage.set('lerne_user_id', newGuestId);
    storage.set('lerne_user_profile', JSON.stringify(guestProfile));
    setUserProfile(guestProfile);

    setIsAccountDeleted(false);
    showToast("Начата новая гостевая сессия", "info");

    try {
      await fetchDecks(true);
    } catch { /* ignore */ }

    setTimeout(() => {
      window.location.reload();
    }, 300);
  };

  const handleCloseApp = () => {
    const tg = window.Telegram?.WebApp;
    if (tg && tg.close) {
      tg.close();
      return;
    }
    
    // Attempt window.close
    window.close();
    setClosedMessage(true);
  };

  return (
    <>
      <AnimatePresence>
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 99999,
          background: '#090d16',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          boxSizing: 'border-box'
        }}>
          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 20 }}
            style={{
              maxWidth: 440,
              width: '100%',
              background: 'rgba(15, 23, 42, 0.92)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 24,
              padding: '28px 24px',
              textAlign: 'center',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
              backdropFilter: 'blur(16px)'
            }}
          >
            {/* Success Icon */}
            <div style={{
              width: 64,
              height: 64,
              borderRadius: 20,
              background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(16, 185, 129, 0.1))',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 18px auto'
            }}>
              <CheckCircle size={32} color="#4ade80" />
            </div>

            {/* Title & Subtitle */}
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#ffffff', margin: '0 0 8px 0' }}>
              Ваш аккаунт и данные успешно удалены
            </h2>
            <p style={{ fontSize: '0.88rem', color: '#94a3b8', margin: '0 0 24px 0', lineHeight: 1.45 }}>
              Все колоды, карточки, папки и прогресс обучения были безвозвратно стёрты с сервера.
            </p>

            {closedMessage && (
              <div style={{
                background: 'rgba(59, 130, 246, 0.12)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                borderRadius: 12,
                padding: '10px 14px',
                color: '#93c5fd',
                fontSize: '0.84rem',
                marginBottom: 16
              }}>
                Вкладка готова к закрытию. Вы можете закрыть это окно браузера вручную.
              </div>
            )}

            {/* Actions list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Option 1: Register / Setup Profile */}
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setRegisterModalOpen(true)}
                style={{
                  width: '100%',
                  padding: '14px',
                  borderRadius: 14,
                  fontSize: '0.94rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                  border: 'none',
                  color: 'white',
                  cursor: 'pointer'
                }}
              >
                <UserPlus size={18} />
                <span>Зарегистрироваться / Настроить профиль</span>
              </button>

              {/* Option 2: Start Clean as Guest */}
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleStartGuest}
                style={{
                  width: '100%',
                  padding: '13px',
                  borderRadius: 14,
                  fontSize: '0.88rem',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  background: 'rgba(255, 255, 255, 0.06)',
                  borderColor: 'rgba(255, 255, 255, 0.15)',
                  color: '#e2e8f0',
                  cursor: 'pointer'
                }}
              >
                <RefreshCw size={16} />
                <span>Начать заново как гость (без регистрации)</span>
              </button>

              {/* Option 3: Close app */}
              <button
                type="button"
                onClick={handleCloseApp}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: 'none',
                  border: 'none',
                  color: '#64748b',
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  marginTop: 4
                }}
              >
                <LogOut size={14} />
                <span>Закрыть приложение</span>
              </button>
            </div>
          </motion.div>
        </div>
      </AnimatePresence>

      <RegisterModal
        isOpen={registerModalOpen}
        onClose={() => setRegisterModalOpen(false)}
        onSuccess={() => {
          setIsAccountDeleted(false);
          window.location.reload();
        }}
      />
    </>
  );
};
