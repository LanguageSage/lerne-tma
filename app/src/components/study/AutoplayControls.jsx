import { Pause, Play, Settings2, Square } from 'lucide-react';
import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import './AutoplayControls.css';

export const AutoplayControls = ({ state, status, disabled, onStart, onPause, onResume, onStop, onSettings }) => {
  useInterfaceLocale();
  if (state === 'stopped') {
    return (
      <button type="button" className="autoplay-start-button" disabled={disabled}
        aria-label={tr("Запустить авто-режим")} title={tr("Запустить авто-режим")} onClick={onStart}>
        <Play size={22} fill="currentColor" aria-hidden="true" />
      </button>
    );
  }
  return (
    <div className="autoplay-player">
      <div className="autoplay-status" role="status">{status}</div>
      <div className="autoplay-player-buttons">
        <button type="button" onClick={state === 'paused' ? onResume : onPause}>
          {state === 'paused' ? <Play size={18} aria-hidden="true" /> : <Pause size={18} aria-hidden="true" />}
          {state === 'paused' ? tr("Продолжить") : tr("Пауза")}
        </button>
        <button type="button" onClick={onStop}><Square size={16} aria-hidden="true" />{tr("Стоп")}</button>
        <button type="button" onClick={onSettings}><Settings2 size={18} aria-hidden="true" />{tr("Настроить")}</button>
      </div>
    </div>
  );
};
