import React from 'react';
import { TrendingUp } from 'lucide-react';
import { tr } from '../../../i18n/locale';
import { useInterfaceLocale } from '../../../i18n/useInterfaceLocale';

/**
 * ProgressPlaceholder
 * 
 * Изолированная заглушка прогресса обучения.
 * Не вычисляет фиктивные проценты и не отмечает урок освоенным.
 */
export const ProgressPlaceholder = ({ isVisible = false }) => {
  useInterfaceLocale();

  if (!isVisible) return null;

  return (
    <div className="completion-progress-placeholder glass">
      <div className="completion-placeholder-header">
        <TrendingUp size={18} className="completion-placeholder-icon" />
        <span>{tr('Прогресс обучения')}</span>
      </div>
      <p className="completion-placeholder-desc">
        {tr('Система отслеживания прогресса курса находится в разработке.')}
      </p>
    </div>
  );
};
