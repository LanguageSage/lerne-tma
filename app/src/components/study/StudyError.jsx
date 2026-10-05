import React from 'react';
import { tr } from '../../i18n/locale';

export const StudyError = ({ deck, error, onRetry, onGoToDecks }) => (
  <div className="finished-view glass" role="alert">
    <h2>{tr('Не удалось загрузить занятие')}</h2>
    <p className="study-error-message">{typeof error === 'string' ? error : tr('Не удалось загрузить данные с сервера')}</p>
    <div className="finished-actions">
      <button className="btn btn-primary" onClick={onRetry}>{tr('Повторить запрос')}</button>
      <button className="btn btn-secondary" onClick={onGoToDecks}>{deck?.folder_id != null ? tr('К колодам темы') : tr('К колодам')}</button>
    </div>
  </div>
);
