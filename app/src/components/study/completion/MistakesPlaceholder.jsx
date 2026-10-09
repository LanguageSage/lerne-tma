import React from 'react';
import { AlertCircle } from 'lucide-react';
import { tr } from '../../../i18n/locale';
import { useInterfaceLocale } from '../../../i18n/useInterfaceLocale';

/**
 * MistakesPlaceholder
 * 
 * Изолированная заглушка разбора ошибок.
 * Не извлекает ошибки и не показывает неактивные кнопки действий.
 */
export const MistakesPlaceholder = ({ isVisible = false }) => {
  useInterfaceLocale();

  if (!isVisible) return null;

  return (
    <div className="completion-mistakes-placeholder glass">
      <div className="completion-placeholder-header">
        <AlertCircle size={18} className="completion-placeholder-icon" />
        <span>{tr('Разбор ошибок')}</span>
      </div>
      <p className="completion-placeholder-desc">
        {tr('Анализ ошибок появится в следующих обновлениях.')}
      </p>
    </div>
  );
};
