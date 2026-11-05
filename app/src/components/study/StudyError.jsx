import React from 'react';
import { tr } from '../../i18n/locale';
import { isStudyMigrationError } from '../../utils/structuredStudyCard.js';

export const StudyError = ({ deck, error, onRetry, onGoToDecks }) => {
  const migrationPending = isStudyMigrationError(error);
  const message = migrationPending ? tr('Карточки ещё не перенесены в Structured Cards V2.')
    : typeof error === 'string' ? error : tr('Не удалось загрузить данные с сервера');
  return (
    <div className="finished-view glass" role="alert">
      <h2>{tr('Не удалось загрузить занятие')}</h2>
      <p className="study-error-message">{message}</p>
      <div className="finished-actions">
        {!migrationPending && <button className="btn btn-primary" onClick={onRetry}>{tr('Повторить запрос')}</button>}
        <button className="btn btn-secondary" onClick={onGoToDecks}>{deck?.folder_id != null ? tr('К колодам темы') : tr('К колодам')}</button>
      </div>
    </div>
  );
};
