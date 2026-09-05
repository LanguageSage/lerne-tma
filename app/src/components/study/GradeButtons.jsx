import React from 'react';
import { useTranslation } from '../../i18n/i18nContext';
import { useSettingsStore } from '../../store/useSettingsStore';
import { getNextIntervals } from '../../utils/srsEngine';

export const GradeButtons = ({ card, loading, onGrade }) => {
  const { t } = useTranslation();
  const srsExtendedGrades = useSettingsStore((s) => s.srsExtendedGrades);

  if (!card) return null;

  const isNewCard = !card.queue || card.queue === 'new';

  if (srsExtendedGrades) {
    const dynIntervals = card.intervals?.extended || getNextIntervals(card).extended;
    const extGrades = [
      { grade: 0, num: 1, fallback: '5м' },
      { grade: 1, num: 2, fallback: isNewCard ? '8м' : '1д' },
      { grade: 2, num: 3, fallback: isNewCard ? '10м' : '2д' },
      { grade: 3, num: 4, fallback: isNewCard ? '1д' : '4д' },
      { grade: 4, num: 5, fallback: isNewCard ? '1д' : '8д' },
      { grade: 5, num: 6, fallback: isNewCard ? '2д' : '11д' },
      { grade: 6, num: 7, fallback: isNewCard ? '3д' : '13д' },
      { grade: 7, num: 8, fallback: isNewCard ? '5д' : '20д' },
    ];

    return (
      <div id="tut-study-grades" className="grade-buttons grade-buttons-floating grade-buttons-extended">
        {extGrades.map(({ grade, num, fallback }) => {
          const val = dynIntervals?.[grade] || fallback;
          return (
            <button
              key={grade}
              disabled={loading}
              className={`btn-grade btn-grade-ext grade-ext-${grade}`}
              onClick={() => onGrade(grade, true)}
              title={`Оценка ${num} (${val})`}
            >
              <span className="grade-label grade-num">{num}</span>
              <span className="grade-val">{val}</span>
            </button>
          );
        })}
      </div>
    );
  }

  const grades = [
    { grade: 0, label: t('study.grade_again', 'Снова'), className: 'grade-0', intervalIdx: 0, fallback: '1м' },
    { grade: 1, label: t('study.grade_hard', 'Трудно'), className: 'grade-1', intervalIdx: 1, fallback: isNewCard ? '1.5м' : '1д' },
    { grade: 2, label: t('study.grade_good', 'Хорошо'), className: 'grade-2', intervalIdx: 2, fallback: isNewCard ? '10м' : '4д' },
    { grade: 3, label: t('study.grade_easy', 'Легко'), className: 'grade-3', intervalIdx: 3, fallback: isNewCard ? '4д' : '7д' },
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
            onClick={() => onGrade(grade, false)}
          >
            <span className="grade-label">{label}</span>
            <span className="grade-val">{val}</span>
          </button>
        );
      })}
    </div>
  );
};


