import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useRef, useEffect } from 'react';
import { Check, X } from 'lucide-react';

export const LidQuestionNavigator = ({
  questions = [],
  currentIndex = 0,
  answers = {},
  examMode = 'exam',
  onSelectIndex
}) => {
  useInterfaceLocale();
  const containerRef = useRef(null);

  // Auto-scroll to active index
  useEffect(() => {
    if (containerRef.current) {
      const activeEl = containerRef.current.children[currentIndex];
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, [currentIndex]);

  return (
    <div className="lid-navigator-container glass">
      <div className="lid-navigator-scroll" ref={containerRef}>
        {questions.map((q, idx) => {
          const isActive = idx === currentIndex;
          const userAns = answers[q.id];
          const isAnswered = Boolean(userAns);
          const isPractice = examMode === 'practice';
          const isCorrect = isPractice && isAnswered ? (userAns === q.correctOption) : null;

          let statusClass = '';
          if (isActive) statusClass += ' active';
          if (isAnswered) statusClass += ' answered';
          if (isPractice && isAnswered) {
            statusClass += isCorrect ? ' correct' : ' wrong';
          }

          return (
            <button
              key={`nav-q-${q.id || idx}`}
              type="button"
              className={`lid-nav-btn ${statusClass}`}
              onClick={() => onSelectIndex(idx)}
              title={tr("Вопрос {{p0}}", { p0: idx + 1 })}
            >
              <span className="lid-nav-num">{idx + 1}</span>
              {isPractice && isAnswered && (
                <span className="lid-nav-indicator">
                  {isCorrect ? <Check size={10} strokeWidth={3} /> : <X size={10} strokeWidth={3} />}
                </span>
              )}
              {!isPractice && isAnswered && (
                <span className="lid-nav-dot" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
