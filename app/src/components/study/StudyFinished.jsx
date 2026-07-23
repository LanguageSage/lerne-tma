import React from 'react';
import { CheckCircle } from 'lucide-react';

export const StudyFinished = ({
  apiError,
  onGoToDecks,
  onLearnMore,
  onSyncDeck,
  onResetProgress,
}) => (
  <div className="finished-view glass">
    <CheckCircle size={48} color="#22c55e" />
    <h3>Колода пройдена!</h3>
    <p>На сегодня больше нет карточек для повторения.</p>
    {apiError && (
      <div
        className="api-error-box glass"
        style={{ color: '#f87171', padding: '10px', margin: '10px 0', border: '1px solid #ef4444' }}
      >
        Ошибка сервера: {apiError}
      </div>
    )}
    <div className="finished-actions">
      <button className="btn btn-primary" onClick={onGoToDecks}>В меню</button>
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
