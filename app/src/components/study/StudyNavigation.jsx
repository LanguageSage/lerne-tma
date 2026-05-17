import React from 'react';
import { ChevronLeft, ChevronRight, Play, Square } from 'lucide-react';

const PAUSE_OPTIONS = Array.from({ length: 10 }, (_, index) => index + 1);
const SPEED_OPTIONS = Array.from({ length: 21 }, (_, index) => -50 + index * 5);

export const StudyNavigation = ({
  historyIndex,
  totalCards,
  loading,
  onBack,
  onNext,
  autoplayState,
  autoplayStatus,
  autoplaySettings,
  onAutoplayStart,
  onAutoplayStop
}) => {
  const isPlaying = autoplayState === 'playing';

  return (
    <div className="study-navigation-panel">
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

      <button
        className={`autoplay-main-btn ${isPlaying ? 'is-playing' : ''}`}
        onClick={isPlaying ? onAutoplayStop : onAutoplayStart}
        disabled={loading}
        title={isPlaying ? 'Остановить авто-режим' : 'Запустить авто-режим'}
      >
        {isPlaying ? <Square size={18} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
        <span>{isPlaying ? 'Стоп' : 'Авто'}</span>
      </button>

      {isPlaying && (
        <div className="autoplay-controls">
          <div className="autoplay-status">{autoplayStatus || 'Авто-режим активен'}</div>

          <div className="autoplay-control-grid">
            <label className="autoplay-field">
              <span>После фразы</span>
              <select
                value={autoplaySettings.autoplayFrontPause}
                onChange={(e) => autoplaySettings.setAutoplayFrontPause(e.target.value)}
              >
                {PAUSE_OPTIONS.map((value) => (
                  <option key={value} value={value}>{value}с</option>
                ))}
              </select>
            </label>

            <label className="autoplay-field">
              <span>После перевода</span>
              <select
                value={autoplaySettings.autoplayBackPause}
                onChange={(e) => autoplaySettings.setAutoplayBackPause(e.target.value)}
              >
                {PAUSE_OPTIONS.map((value) => (
                  <option key={value} value={value}>{value}с</option>
                ))}
              </select>
            </label>

            <label className="autoplay-slider">
              <span>DE {autoplaySettings.ttsSpeed > 0 ? '+' : ''}{autoplaySettings.ttsSpeed}%</span>
              <input
                type="range"
                min="-50"
                max="50"
                step="5"
                value={autoplaySettings.ttsSpeed}
                onChange={(e) => autoplaySettings.setTtsSpeed(e.target.value)}
                list="autoplay-speed-values"
              />
            </label>

            <label className="autoplay-slider">
              <span>RU {autoplaySettings.ttsSpeedRu > 0 ? '+' : ''}{autoplaySettings.ttsSpeedRu}%</span>
              <input
                type="range"
                min="-50"
                max="50"
                step="5"
                value={autoplaySettings.ttsSpeedRu}
                onChange={(e) => autoplaySettings.setTtsSpeedRu(e.target.value)}
                list="autoplay-speed-values"
              />
            </label>
          </div>

          <datalist id="autoplay-speed-values">
            {SPEED_OPTIONS.map((value) => <option key={value} value={value} />)}
          </datalist>

          <label className="autoplay-loop">
            <input
              type="checkbox"
              checked={autoplaySettings.autoplayLoop}
              onChange={(e) => autoplaySettings.setAutoplayLoop(e.target.checked)}
            />
            <span>Повторять колоду</span>
          </label>
        </div>
      )}
    </div>
  );
};
