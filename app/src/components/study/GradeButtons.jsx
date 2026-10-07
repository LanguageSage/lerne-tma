import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useEffect, useRef } from 'react';
import { useTranslation } from '../../i18n/i18nContext';
import { useSettingsStore } from '../../store/useSettingsStore';
import { getNextIntervals } from '../../utils/srsEngine';
import { StudyControlsBlock } from './StudyControlsBlock';

export const GradeButtons = ({ card, loading, onGrade }) => {
  useInterfaceLocale();
  const { t } = useTranslation();
  const srsExtendedGrades = useSettingsStore((s) => s.srsExtendedGrades);
  const gradingCollapsed = useSettingsStore((s) => s.gradingCollapsed);
  const setGradingCollapsed = useSettingsStore((s) => s.setGradingCollapsed);
  const containerRef = useRef(null);
  const hasCard = Boolean(card);

  useEffect(() => {
    if (!hasCard) return;
    const container = containerRef.current;
    const updateHeight = () => document.documentElement.style.setProperty('--study-grading-height', `${container.getBoundingClientRect().height}px`);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(container);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--study-grading-height');
    };
  }, [hasCard]);

  if (!card) return null;

  const isNewCard = !card.queue || card.queue === 'new';

  const wrapControls = (controls) => (
    <div id="tut-study-grades" className="study-grading-controls" ref={containerRef}>
      <StudyControlsBlock
        collapsed={gradingCollapsed}
        onCollapsedChange={setGradingCollapsed}
        label={tr('Оценить ответ')}
      >
        {controls}
      </StudyControlsBlock>
    </div>
  );

  if (srsExtendedGrades) {
    const dynIntervals = card.intervals?.extended || getNextIntervals(card).extended;
    const extGrades = [
      { grade: 0, num: 1, fallback: tr("5м") },
      { grade: 1, num: 2, fallback: isNewCard ? tr("8м") : tr("1д") },
      { grade: 2, num: 3, fallback: isNewCard ? tr("10м") : tr("2д") },
      { grade: 3, num: 4, fallback: isNewCard ? tr("25м") : tr("4д") },
      { grade: 4, num: 5, fallback: isNewCard ? tr("1д") : tr("8д") },
      { grade: 5, num: 6, fallback: isNewCard ? tr("2д") : tr("11д") },
      { grade: 6, num: 7, fallback: isNewCard ? tr("3д") : tr("13д") },
      { grade: 7, num: 8, fallback: isNewCard ? tr("5д") : tr("20д") },
    ];

    return wrapControls(
      <div className="grade-buttons grade-buttons-floating grade-buttons-extended">
        {extGrades.map(({ grade, fallback }) => {
          const val = dynIntervals?.[grade] || fallback;
          return (
            <button
              key={grade}
              disabled={loading}
              className={`btn-grade btn-grade-ext grade-ext-${grade}`}
              onClick={event => { if (event.detail <= 1) onGrade(grade, true); }}
              title={tr("Интервал: {{p0}}", { p0: val })}
            >
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

  return wrapControls(
    <div className="grade-buttons grade-buttons-floating">
      {grades.map(({ grade, label, className, intervalIdx, fallback }) => {
        const val = card.intervals?.[intervalIdx] || card.intervals?.[String(intervalIdx)] || fallback;
        return (
          <button
            key={grade}
            disabled={loading}
            className={`btn-grade ${className}`}
            onClick={event => { if (event.detail <= 1) onGrade(grade, false); }}
          >
            <span className="grade-label">{label}</span>
            <span className="grade-val">{val}</span>
          </button>
        );
      })}
    </div>
  );
};


