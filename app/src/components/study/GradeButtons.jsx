import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React from 'react';
import { useTranslation } from '../../i18n/i18nContext';
import { useSettingsStore } from '../../store/useSettingsStore';
import { getNextIntervals } from '../../utils/srsEngine';

export const GradeButtons = ({ card, loading, onGrade }) => {
  useInterfaceLocale();
  const { t } = useTranslation();
  const srsExtendedGrades = useSettingsStore((s) => s.srsExtendedGrades);

  if (!card) return null;

  const isNewCard = !card.queue || card.queue === 'new';

  if (srsExtendedGrades) {
    const dynIntervals = card.intervals?.extended || getNextIntervals(card).extended;
    const extGrades = [
      { grade: 0, num: 1, fallback: tr("5м") },
      { grade: 1, num: 2, fallback: isNewCard ? tr("8м") : tr("1д") },
      { grade: 2, num: 3, fallback: isNewCard ? tr("10м") : tr("2д") },
      { grade: 3, num: 4, fallback: isNewCard ? tr("1д") : tr("4д") },
      { grade: 4, num: 5, fallback: isNewCard ? tr("1д") : tr("8д") },
      { grade: 5, num: 6, fallback: isNewCard ? tr("2д") : tr("11д") },
      { grade: 6, num: 7, fallback: isNewCard ? tr("3д") : tr("13д") },
      { grade: 7, num: 8, fallback: isNewCard ? tr("5д") : tr("20д") },
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
              title={tr("Оценка {{p0}} ({{p1}})", { p0: num, p1: val })}
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
    { grade: 0, label: t('study.grade_again', 'Снова'), className: 'grade-0', intervalIdx: 0, fallback: tr("1м") },
    { grade: 1, label: t('study.grade_hard', 'Трудно'), className: 'grade-1', intervalIdx: 1, fallback: isNewCard ? tr("1.5м") : tr("1д") },
    { grade: 2, label: t('study.grade_good', 'Хорошо'), className: 'grade-2', intervalIdx: 2, fallback: isNewCard ? tr("10м") : tr("4д") },
    { grade: 3, label: t('study.grade_easy', 'Легко'), className: 'grade-3', intervalIdx: 3, fallback: isNewCard ? tr("4д") : tr("7д") },
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


