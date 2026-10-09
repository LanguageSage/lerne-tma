import React from 'react';
import { CheckCircle2, XCircle, Percent, Clock, Dumbbell } from 'lucide-react';
import { tr } from '../../../i18n/locale';
import { useInterfaceLocale } from '../../../i18n/useInterfaceLocale';

/**
 * ResultsPlaceholder
 * 
 * Изолированная заглушка секции результатов занятия.
 * Поддерживает будущее подключение реальных показателей без изменения верстки.
 */
export const ResultsPlaceholder = ({ 
  exercises = '—',
  correct = '—',
  mistakes = '—',
  accuracy = '—',
  duration = '—'
}) => {
  useInterfaceLocale();

  const metrics = [
    { id: 'exercises', label: tr('Упражнения'), value: exercises, icon: Dumbbell, color: '#38bdf8' },
    { id: 'correct', label: tr('Верно'), value: correct, icon: CheckCircle2, color: '#4ade80' },
    { id: 'mistakes', label: tr('Ошибки'), value: mistakes, icon: XCircle, color: '#f87171' },
    { id: 'accuracy', label: tr('Точность'), value: accuracy, icon: Percent, color: '#a855f7' },
    { id: 'duration', label: tr('Время'), value: duration, icon: Clock, color: '#f59e0b' },
  ];

  return (
    <div className="completion-results-placeholder glass">
      <div className="completion-metrics-grid">
        {metrics.map(m => {
          const Icon = m.icon;
          return (
            <div key={m.id} className="completion-metric-item">
              <div className="completion-metric-icon" style={{ color: m.color }}>
                <Icon size={16} />
              </div>
              <span className="completion-metric-value">{m.value}</span>
              <span className="completion-metric-label">{m.label}</span>
            </div>
          );
        })}
      </div>
      <div className="completion-metrics-note">
        {exercises !== '—' ? tr('Итоги занятия') : tr('Подробная статистика появится позже')}
      </div>
    </div>
  );
};
