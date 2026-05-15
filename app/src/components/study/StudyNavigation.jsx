import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const StudyNavigation = ({ historyIndex, totalCards, loading, onBack, onNext }) => (
  <div className="study-navigation">
    <div className="nav-counter nav-counter-current" title="Текущая позиция">
      {historyIndex + 1}
    </div>
    <div className="nav-buttons-group">
      <button
        className="nav-arrow-btn"
        onClick={onBack}
        disabled={historyIndex <= 0 || loading}
        title="Назад"
      >
        <ChevronLeft size={28} />
      </button>
      <button
        className="nav-arrow-btn"
        onClick={onNext}
        disabled={loading}
        title="Вперед (пропустить)"
      >
        <ChevronRight size={28} />
      </button>
    </div>
    <div className="nav-counter nav-counter-total" title="Всего в колоде">
      {totalCards || 0}
    </div>
  </div>
);
