import React from 'react';

export const GradeButtons = ({ card, loading, onGrade }) => {
  if (!card) return null;

  const isNewCard = !card.queue || card.queue === 'new';

  const grades = [
    { grade: 0, label: 'Снова', className: 'grade-0', intervalIdx: 0, fallback: '1м' },
    { grade: 1, label: 'Трудно', className: 'grade-1', intervalIdx: 1, fallback: isNewCard ? '1.5м' : '1д' },
    { grade: 2, label: 'Хорошо', className: 'grade-2', intervalIdx: 2, fallback: isNewCard ? '10м' : '4д' },
    { grade: 3, label: 'Легко', className: 'grade-3', intervalIdx: 3, fallback: isNewCard ? '4д' : '7д' },
  ];

  return (
    <div id="tut-study-grades" className="grade-buttons grade-buttons-floating">
      {grades.map(({ grade, label, className, intervalIdx, fallback }) => {
        const val = card.intervals?.[intervalIdx] || card.intervals?.[String(intervalIdx)] || fallback;
        return (
          <button
            key={grade}
            disabled={loading}
            className={`btn-grade ${className}`}
            onClick={() => onGrade(grade)}
          >
            <span className="grade-label">{label}</span>
            <span className="grade-val">{val}</span>
          </button>
        );
      })}
    </div>
  );
};
