import React from 'react';

/**
 * CourseProgressPlaceholder
 * 
 * Изолированная заглушка прогресса курса.
 * На данном этапе не выполняет вычислений и не обращается к API.
 * Обычному пользователю не отображается (показывается только при явном флаге debug/admin preview).
 */
export const CourseProgressPlaceholder = ({ isVisible = false }) => {
  if (!isVisible) return null;

  return (
    <div className="course-progress-placeholder glass" style={{ padding: '12px 16px', margin: '12px 0', borderRadius: '12px', opacity: 0.7 }}>
      <div style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Прогресс курса (скоро)
      </div>
    </div>
  );
};
