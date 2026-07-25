import React from 'react';
import { useTranslation } from '../../i18n/i18nContext';
import { SUPPORTED_NATIVE_LANGUAGES } from '../../constants/languageConstants';

export default function LanguageWelcomeModal({ isOpen, onClose }) {
  const { nativeLanguage, changeNativeLanguage, t } = useTranslation();

  if (!isOpen) return null;

  const handleSelect = (code) => {
    changeNativeLanguage(code);
  };

  const handleConfirm = () => {
    onClose();
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      backgroundColor: 'rgba(15, 23, 42, 0.85)',
      backdropFilter: 'blur(12px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px'
    }}>
      <div style={{
        background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.98))',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        borderRadius: '24px',
        padding: '32px 24px',
        maxWidth: '440px',
        width: '100%',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 30px rgba(56, 189, 248, 0.25)',
        color: '#ffffff',
        textAlign: 'center',
        animation: 'modalSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
      }}>
        <div style={{ fontSize: '3rem', marginBottom: '12px' }}>🌐</div>
        <h2 style={{ fontSize: '1.4rem', fontWeight: '700', marginBottom: '8px', color: '#f8fafc' }}>
          {t('welcome.title')}
        </h2>
        <p style={{ fontSize: '0.9rem', color: '#94a3b8', marginBottom: '24px', lineHeight: '1.4' }}>
          {t('welcome.subtitle')}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '28px' }}>
          {SUPPORTED_NATIVE_LANGUAGES.map((lang) => {
            const isSelected = nativeLanguage === lang.code;
            return (
              <button
                key={lang.code}
                onClick={() => handleSelect(lang.code)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  padding: '14px 20px',
                  borderRadius: '16px',
                  border: isSelected ? '2px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
                  background: isSelected ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                  color: '#ffffff',
                  fontSize: '1.05rem',
                  fontWeight: isSelected ? '700' : '500',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: isSelected ? '0 0 15px rgba(56, 189, 248, 0.3)' : 'none'
                }}
              >
                <span style={{ fontSize: '1.8rem' }}>{lang.flag}</span>
                <span style={{ flex: 1, textAlign: 'left' }}>{lang.name}</span>
                {isSelected && <span style={{ color: '#38bdf8', fontSize: '1.2rem' }}>✓</span>}
              </button>
            );
          })}
        </div>

        <button
          onClick={handleConfirm}
          style={{
            width: '100%',
            padding: '14px 24px',
            borderRadius: '16px',
            border: 'none',
            background: 'linear-gradient(135deg, #0284c7, #38bdf8)',
            color: '#ffffff',
            fontSize: '1rem',
            fontWeight: '700',
            cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(56, 189, 248, 0.4)'
          }}
        >
          {t('welcome.confirm')}
        </button>
      </div>
    </div>
  );
}
