import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { AutoplayControls } from './AutoplayControls';


export const StudyNavigation = ({
  historyIndex,
  totalCards,
  loading,
  onBack,
  onNext,
  autoplayState,
  autoplayStatus,
  onAutoplayStop,
  onAutoplayPause,
  onAutoplayResume,
  onAutoplayStart,
  onAutoplaySettings,
  autoplayLoop
}) => {
  useInterfaceLocale();
  const currentNumber = (typeof historyIndex === 'number' && historyIndex >= 0) ? historyIndex + 1 : 1;
  const total = totalCards || 0;
  const isBackDisabled = loading || (historyIndex <= 0 && !(autoplayState !== 'stopped' && autoplayLoop));
  const isNextDisabled = loading;

  return (
    <div className="study-navigation-panel">
      <div className="study-navigation">
        <div className={`nav-btn-wrapper ${isBackDisabled ? 'is-disabled' : ''}`}>
          <button
            className="nav-arrow-btn"
            onClick={onBack}
            disabled={isBackDisabled}
            title={tr("Предыдущая карточка")}
          >
            <ChevronLeft size={38} strokeWidth={3} />
          </button>
          <span className="nav-arrow-subtext">{tr("предыдущая карточка")}</span>
        </div>

        <div className="nav-counter-wrapper">
          <div className="nav-card-counter" title={tr("Карточка {{p0}}{{p1}}", { p0: currentNumber, p1: total > 0 ? tr(" из {{p0}}", { p0: total }) : '' })}>
            <span className="nav-card-current">{currentNumber}</span>
            {total > 0 && (
              <>
                <span className="nav-card-divider">/</span>
                <span className="nav-card-total">{total}</span>
              </>
            )}
          </div>
        </div>

        <div className={`nav-btn-wrapper ${isNextDisabled ? 'is-disabled' : ''}`}>
          <button
            className="nav-arrow-btn"
            onClick={onNext}
            disabled={isNextDisabled}
            title={tr("Следующая карточка")}
          >
            <ChevronRight size={38} strokeWidth={3} />
          </button>
          <span className="nav-arrow-subtext">{tr("следующая карточка")}</span>
        </div>
      </div>

      <AutoplayControls state={autoplayState} status={autoplayStatus} disabled={loading}
        onStart={onAutoplayStart} onStop={onAutoplayStop} onPause={onAutoplayPause}
        onResume={onAutoplayResume} onSettings={onAutoplaySettings} />
    </div>
  );
};
