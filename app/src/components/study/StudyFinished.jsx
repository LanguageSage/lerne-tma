import React from 'react';
import { CheckCircle } from 'lucide-react';
import { useTranslation } from '../../i18n/i18nContext';

export const StudyFinished = ({
  apiError,
  onGoToDecks,
  onLearnMore,
  onSyncDeck,
  onResetProgress,
}) => {
  const { t } = useTranslation();

  return (
    <div className="finished-view glass">
      <CheckCircle size={48} color="#22c55e" />
      <h3>{t('study.done_title', 'Отличная работа! 🎉')}</h3>
      <p>{t('study.done_subtitle', 'Вы прошли все карточки на сегодня.')}</p>
      {apiError && (
        <div
          className="api-error-box glass"
          style={{ color: '#f87171', padding: '10px', margin: '10px 0', border: '1px solid #ef4444' }}
        >
          Ошибка сервера: {apiError}
        </div>
      )}
      <div className="finished-actions">
        <button className="btn btn-primary" onClick={onGoToDecks}>{t('study.back_to_decks', 'К списку колод')}</button>
        <button className="btn btn-secondary" onClick={onLearnMore}>Учить еще</button>
        <button className="btn btn-secondary" onClick={onSyncDeck}>Обновить данные</button>
        <button
          className="btn btn-secondary"
          onClick={onResetProgress}
        >
          Сбросить прогресс
        </button>
      </div>
    </div>
  );
};

