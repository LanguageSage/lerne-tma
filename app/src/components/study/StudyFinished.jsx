import React from 'react';
import { CheckCircle } from 'lucide-react';
import { useTranslation } from '../../i18n/i18nContext';
import { useUiStore } from '../../store/useUiStore';
import { useSessionStore } from '../../store/useSessionStore';

export const StudyFinished = ({
  apiError,
  onGoHome,
  onGoToDecks,
  onLearnMore,
  onSyncDeck,
  onResetProgress,
}) => {
  const { t } = useTranslation();

  const handleOk = () => {
    if (onGoHome) {
      onGoHome();
    } else {
      useSessionStore.getState().stopAutoplay?.();
      useSessionStore.getState().resetSession();
      useUiStore.getState().setActiveFolderId(null);
      useUiStore.getState().setView('decks');
    }
  };

  return (
    <div className="finished-view glass" style={{ maxWidth: '440px', margin: '0 auto', padding: '28px 20px', textAlign: 'center' }}>
      <div style={{
        display: 'inline-flex',
        padding: '16px',
        borderRadius: '50%',
        background: 'rgba(34, 197, 94, 0.15)',
        color: '#22c55e',
        marginBottom: '8px'
      }}>
        <CheckCircle size={60} />
      </div>

      <h2 style={{
        fontSize: '1.75rem',
        fontWeight: '800',
        margin: '0',
        color: '#ffffff',
        lineHeight: 1.25
      }}>
        {t('study.done_title', 'Отличная работа! 🎉')}
      </h2>

      <p style={{
        fontSize: '1.2rem',
        color: 'rgba(255, 255, 255, 0.88)',
        margin: '0',
        lineHeight: 1.45
      }}>
        {t('study.done_subtitle', 'Вы прошли все карточки на сегодня.')}
      </p>

      {apiError && (
        <div
          className="api-error-box glass"
          style={{ color: '#f87171', padding: '10px', margin: '10px 0', border: '1px solid #ef4444', width: '100%', borderRadius: '10px' }}
        >
          Ошибка сервера: {apiError}
        </div>
      )}

      <div className="finished-actions" style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', marginTop: '14px' }}>
        <button
          className="btn btn-primary btn-finished-ok"
          onClick={handleOk}
          style={{
            fontSize: '1.2rem',
            fontWeight: '700',
            padding: '15px 24px',
            borderRadius: '14px',
            background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
            boxShadow: '0 4px 18px rgba(34, 197, 94, 0.38)',
            border: 'none',
            color: '#ffffff'
          }}
        >
          {t('common.ok', 'Окей')}
        </button>

        <button
          className="btn btn-secondary"
          onClick={onGoToDecks}
          style={{ fontSize: '1.05rem', fontWeight: '600', padding: '13px 20px', borderRadius: '12px' }}
        >
          {t('study.back_to_decks', 'К списку колод')}
        </button>

        <button
          className="btn btn-secondary"
          onClick={onLearnMore}
          style={{ fontSize: '1.05rem', fontWeight: '600', padding: '13px 20px', borderRadius: '12px' }}
        >
          Учить еще
        </button>

        <button
          className="btn btn-secondary"
          onClick={onSyncDeck}
          style={{ fontSize: '1.05rem', fontWeight: '600', padding: '13px 20px', borderRadius: '12px' }}
        >
          Обновить данные
        </button>

        <button
          className="btn btn-secondary"
          onClick={onResetProgress}
          style={{ fontSize: '1.05rem', fontWeight: '600', padding: '13px 20px', borderRadius: '12px' }}
        >
          Сбросить прогресс
        </button>
      </div>
    </div>
  );
};

