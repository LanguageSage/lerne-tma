import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Lock, Send, KeyRound, RefreshCw, ExternalLink } from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { openExternalLink } from '../../utils/platform';

export const AuthRequiredModal = ({ isOpen, onClose, title = tr("Вход в аккаунт") }) => {
  useInterfaceLocale();
  const [tab, setTab] = useState('telegram'); // 'telegram' | 'code'
  const [inputCode, setInputCode] = useState('');
  
  const {
    isPolling,
    isVerifyingCode,
    authError,
    startTelegramLinking,
    checkPendingSession,
    loginWithCode
  } = useAuthStore();

  if (!isOpen) return null;

  const botCodeUrl = "https://t.me/LerneDeutsch287_bot?start=code";

  const handleCodeChange = (e) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 6);
    setInputCode(val);
  };

  const handleVerifyCode = async (e) => {
    e?.preventDefault();
    if (inputCode.length !== 6) return;
    const res = await loginWithCode(inputCode);
    if (res.success) {
      if (onClose) onClose();
    }
  };

  const handleManualCheck = async () => {
    const success = await checkPendingSession();
    if (success && onClose) {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      <div 
        className="settings-overlay" 
        onClick={onClose} 
        style={{ 
          zIndex: 1100,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          WebkitOverflowScrolling: 'touch'
        }}
      >
        <motion.div 
          initial={{ opacity: 0, scale: 0.9, y: 20 }} 
          animate={{ opacity: 1, scale: 1, y: 0 }} 
          exit={{ opacity: 0, scale: 0.9, y: 20 }} 
          className="settings-modal" 
          onClick={e => e.stopPropagation()}
          style={{ 
            maxWidth: 380, 
            width: '100%',
            maxHeight: 'calc(100dvh - 32px)',
            overflowY: 'auto',
            margin: 'auto',
            boxSizing: 'border-box',
            textAlign: 'center', 
            padding: '24px 20px',
            borderRadius: 24
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>{tr("Авторизация")}{' '}</span>
            <button className="close-btn" onClick={onClose}><X size={20} /></button>
          </div>

          <div style={{
            width: 56, height: 56, borderRadius: 18,
            background: 'linear-gradient(135deg, rgba(99,102,241,0.25), rgba(168,85,247,0.25))',
            border: '1px solid rgba(168,85,247,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 12px'
          }}>
            {tab === 'telegram' ? <Lock size={26} color="#c084fc" /> : <KeyRound size={26} color="#c084fc" />}
          </div>

          <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'white', marginBottom: 6 }}>
            {title}
          </h3>

          {/* Navigation Tabs */}
          <div style={{
            display: 'flex',
            background: 'rgba(255, 255, 255, 0.06)',
            borderRadius: 12,
            padding: 4,
            margin: '16px 0 20px',
            gap: 4
          }}>
            <button
              type="button"
              onClick={() => setTab('telegram')}
              style={{
                flex: 1,
                padding: '8px 10px',
                borderRadius: 8,
                border: 'none',
                background: tab === 'telegram' ? 'rgba(168, 85, 247, 0.35)' : 'transparent',
                color: tab === 'telegram' ? '#ffffff' : '#94a3b8',
                fontWeight: tab === 'telegram' ? 600 : 500,
                fontSize: '0.85rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                transition: 'all 0.2s ease'
              }}
            >
              <Send size={14} /> Telegram
            </button>
            <button
              type="button"
              onClick={() => setTab('code')}
              style={{
                flex: 1,
                padding: '8px 10px',
                borderRadius: 8,
                border: 'none',
                background: tab === 'code' ? 'rgba(168, 85, 247, 0.35)' : 'transparent',
                color: tab === 'code' ? '#ffffff' : '#94a3b8',
                fontWeight: tab === 'code' ? 600 : 500,
                fontSize: '0.85rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                transition: 'all 0.2s ease'
              }}
            >
              <KeyRound size={14} />{' '}{tr("Ввести код")}{' '}</button>
          </div>

          {/* Tab 1: Telegram 1-click */}
          {tab === 'telegram' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ fontSize: '0.88rem', color: '#94a3b8', lineHeight: 1.5, margin: '0 0 4px' }}>{tr("Войдите через Telegram-бота, чтобы сохранять колоды и прогресс на всех устройствах.")}{' '}</p>

              {isPolling && (
                <div style={{
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: 'rgba(168, 85, 247, 0.12)',
                  border: '1px solid rgba(168, 85, 247, 0.3)',
                  fontSize: '0.82rem',
                  color: '#e9d5ff',
                  lineHeight: 1.4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  textAlign: 'left'
                }}>
                  <RefreshCw size={18} className="spin" color="#c084fc" style={{ flexShrink: 0 }} />
                  <span>{tr("Ожидание подтверждения... После нажатия «Старт» в боте вернитесь в приложение — вход выполнится автоматически!")}{' '}</span>
                </div>
              )}

              <button 
                className="btn btn-primary btn-full" 
                onClick={startTelegramLinking}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  padding: '13px', borderRadius: 14, fontWeight: 600, fontSize: '0.95rem'
                }}
              >
                <Send size={18} /> {isPolling ? tr("Открыть бота снова") : tr("Войти через Telegram")}
              </button>

              {isPolling && (
                <button
                  type="button"
                  className="btn btn-secondary btn-full"
                  onClick={handleManualCheck}
                  style={{ padding: '11px', borderRadius: 14, fontSize: '0.85rem' }}
                >{tr("Я подтвердил, войти")}{' '}</button>
              )}
            </div>
          )}

          {/* Tab 2: 6-digit Code */}
          {tab === 'code' && (
            <form onSubmit={handleVerifyCode} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ fontSize: '0.88rem', color: '#94a3b8', lineHeight: 1.4, margin: '0 0 2px' }}>{tr("Получите 6-значный код в боте командой")}{' '}<code style={{ color: '#c084fc', background: 'rgba(168,85,247,0.15)', padding: '2px 6px', borderRadius: 6 }}>/code</code>{' '}{tr("и введите его ниже:")}{' '}</p>

              <div style={{ margin: '8px 0' }}>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="000 000"
                  value={inputCode}
                  onChange={handleCodeChange}
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '14px',
                    fontSize: '1.75rem',
                    fontWeight: 700,
                    textAlign: 'center',
                    letterSpacing: 8,
                    borderRadius: 14,
                    border: authError ? '1px solid #ef4444' : '1px solid rgba(168, 85, 247, 0.4)',
                    background: 'rgba(0, 0, 0, 0.25)',
                    color: 'white',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
                {authError && (
                  <p style={{ color: '#f87171', fontSize: '0.8rem', marginTop: 6, marginInline: 'auto' }}>
                    {authError}
                  </p>
                )}
              </div>

              <button 
                type="submit"
                className="btn btn-primary btn-full"
                disabled={inputCode.length !== 6 || isVerifyingCode}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  padding: '13px', borderRadius: 14, fontWeight: 600, fontSize: '0.95rem',
                  opacity: (inputCode.length === 6 && !isVerifyingCode) ? 1 : 0.6
                }}
              >
                {isVerifyingCode ? (
                  <>
                    <RefreshCw size={18} className="spin" />{' '}{tr("Проверяем код...")}{' '}</>
                ) : (
                  <>
                    <KeyRound size={18} />{' '}{tr("Войти по коду")}{' '}</>
                )}
              </button>

              <button
                type="button"
                onClick={() => openExternalLink(botCodeUrl)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#c084fc',
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '6px'
                }}
              >
                <ExternalLink size={13} />{' '}{tr("Открыть бота для получения кода")}{' '}</button>
            </form>
          )}

          <button 
            type="button"
            className="btn-secondary btn-full" 
            onClick={onClose}
            style={{ marginTop: 8, padding: '11px', borderRadius: 14, fontSize: '0.85rem' }}
          >{tr("Позже")}{' '}</button>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
