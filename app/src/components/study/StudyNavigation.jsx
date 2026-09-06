import { tr, getInterfaceLanguage } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, RotateCw, Square } from 'lucide-react';
import { useSettingsStore } from '../../store/useSettingsStore';

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
  onAutoplayStop,
  onAutoplayPause,
  onAutoplayResume
}) => {
  useInterfaceLocale();
  const isPlaying = autoplayState === 'playing';
  const isPaused = autoplayState === 'paused';
  const isAutoplayOpen = isPlaying || isPaused;

  const autoplayOrder = useSettingsStore(s => s.autoplayOrder);
  const setAutoplayOrder = useSettingsStore(s => s.setAutoplayOrder);
  const autoplayFrontPause = useSettingsStore(s => s.autoplayFrontPause);
  const setAutoplayFrontPause = useSettingsStore(s => s.setAutoplayFrontPause);
  const autoplayBackPause = useSettingsStore(s => s.autoplayBackPause);
  const setAutoplayBackPause = useSettingsStore(s => s.setAutoplayBackPause);
  const autoplayFrontRepeat = useSettingsStore(s => s.autoplayFrontRepeat);
  const setAutoplayFrontRepeat = useSettingsStore(s => s.setAutoplayFrontRepeat);
  const autoplayBackRepeat = useSettingsStore(s => s.autoplayBackRepeat);
  const setAutoplayBackRepeat = useSettingsStore(s => s.setAutoplayBackRepeat);
  const ttsSpeed = useSettingsStore(s => s.ttsSpeed);
  const setTtsSpeed = useSettingsStore(s => s.setTtsSpeed);
  const ttsSpeedRu = useSettingsStore(s => s.ttsSpeedRu);
  const setTtsSpeedRu = useSettingsStore(s => s.setTtsSpeedRu);
  const autoplayLoop = useSettingsStore(s => s.autoplayLoop);
  const setAutoplayLoop = useSettingsStore(s => s.setAutoplayLoop);
  const autoplayForceFrontAudio = useSettingsStore(s => s.autoplayForceFrontAudio);
  const setAutoplayForceFrontAudio = useSettingsStore(s => s.setAutoplayForceFrontAudio);
  const autoplayForceBackAudio = useSettingsStore(s => s.autoplayForceBackAudio);
  const setAutoplayForceBackAudio = useSettingsStore(s => s.setAutoplayForceBackAudio);

  const currentNumber = (typeof historyIndex === 'number' && historyIndex >= 0) ? historyIndex + 1 : 1;
  const total = totalCards || 0;
  const isBackDisabled = historyIndex <= 0 || loading;
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

      {isAutoplayOpen && (
        <div className="autoplay-controls">
          <div className="autoplay-status">{autoplayStatus || (isPaused ? tr("Пауза") : tr("Авто-режим активен"))}</div>

          {/* Order Switcher: List vs SRS */}
          <div className="autoplay-order-toggle">
            <button
              type="button"
              className={`autoplay-order-btn ${autoplayOrder === 'list' ? 'active' : ''}`}
              onClick={() => setAutoplayOrder('list')}
              title={tr("Линейный перебор всех карточек колоды по порядку")}
            >{tr("🔢 По списку")}{' '}</button>
            <button
              type="button"
              className={`autoplay-order-btn ${autoplayOrder === 'srs' ? 'active' : ''}`}
              onClick={() => setAutoplayOrder('srs')}
              title={tr("Только карточки, требующие повторения на сегодня (SRS)")}
            >{tr("🧠 По SRS")}{' '}</button>
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', width: '100%' }}>
            <button
              className={`autoplay-pause-btn ${isPaused ? 'is-paused' : ''}`}
              type="button"
              onClick={isPaused ? onAutoplayResume : onAutoplayPause}
              title={isPaused ? tr("Продолжить авто-режим") : tr("Поставить авто-режим на паузу")}
            >
              {isPaused ? <Play size={18} fill="currentColor" /> : <Pause size={18} fill="currentColor" />}
              <span>{isPaused ? tr("Продолжить") : tr("Пауза")}</span>
            </button>

            <button
              className="autoplay-pause-btn"
              type="button"
              onClick={onAutoplayStop}
              title={tr("Остановить авто-режим")}
              style={{ borderColor: 'rgba(248, 113, 113, 0.4)', background: 'rgba(239, 68, 68, 0.15)', color: '#fca5a5' }}
            >
              <Square size={16} fill="currentColor" />
              <span>{tr("Стоп")}</span>
            </button>
          </div>

          <div className="autoplay-control-grid">
            <label className="autoplay-field">
              <span>{tr("Пауза фразы")}</span>
              <select
                value={autoplayFrontPause}
                onChange={(e) => setAutoplayFrontPause(e.target.value)}
              >
                {PAUSE_OPTIONS.map((value) => (
                  <option key={value} value={value}>{value}{tr("с")}</option>
                ))}
              </select>
            </label>

            <label className="autoplay-field">
              <span>{tr("Пауза перевода")}</span>
              <select
                value={autoplayBackPause}
                onChange={(e) => setAutoplayBackPause(e.target.value)}
              >
                {PAUSE_OPTIONS.map((value) => (
                  <option key={value} value={value}>{value}{tr("с")}</option>
                ))}
              </select>
            </label>

            <label className="autoplay-field">
              <span>{tr("Повторов фразы")}</span>
              <select
                value={autoplayFrontRepeat}
                onChange={(e) => setAutoplayFrontRepeat(e.target.value)}
              >
                {PAUSE_OPTIONS.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>

            <label className="autoplay-field">
              <span>{tr("Повторов перевода")}</span>
              <select
                value={autoplayBackRepeat}
                onChange={(e) => setAutoplayBackRepeat(e.target.value)}
              >
                {PAUSE_OPTIONS.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>

            <label className="autoplay-slider">
              <span>{(useSettingsStore.getState().adminSettings?.TARGET_LANG || 'DE').toUpperCase()} {ttsSpeed > 0 ? '+' : ''}{ttsSpeed}%</span>
              <input
                type="range"
                min="-50"
                max="50"
                step="5"
                value={ttsSpeed}
                onChange={(e) => setTtsSpeed(e.target.value)}
                list="autoplay-speed-values"
              />
            </label>

            <label className="autoplay-slider">
              <span>{getInterfaceLanguage().toUpperCase()} {ttsSpeedRu > 0 ? '+' : ''}{ttsSpeedRu}%</span>
              <input
                type="range"
                min="-50"
                max="50"
                step="5"
                value={ttsSpeedRu}
                onChange={(e) => setTtsSpeedRu(e.target.value)}
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
              checked={autoplayLoop}
              onChange={(e) => setAutoplayLoop(e.target.checked)}
            />
            <span>{tr("Повторять колоду")}</span>
          </label>

          <label className="autoplay-loop">
            <input
              type="checkbox"
              checked={autoplayForceFrontAudio}
              onChange={(e) => setAutoplayForceFrontAudio(e.target.checked)}
            />
            <span><RotateCw size={14} />{' '}{tr("Генерировать фразу заново")}</span>
          </label>

          <label className="autoplay-loop">
            <input
              type="checkbox"
              checked={autoplayForceBackAudio}
              onChange={(e) => setAutoplayForceBackAudio(e.target.checked)}
            />
            <span><RotateCw size={14} />{' '}{tr("Генерировать перевод заново")}</span>
          </label>
        </div>
      )}
    </div>
  );
};
