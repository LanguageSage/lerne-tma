import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Play, Pause, Square, Volume2, RefreshCw, Mic2, ChevronUp, ChevronDown } from 'lucide-react';
import { useSettingsStore } from '../../store/useSettingsStore';
import './CardAudioPlayer.css';


const formatTime = (seconds) => {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

const SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5];
const GENDER_ICON = { f: '♀', m: '♂', s: '🔊' };

export const CardAudioPlayer = React.memo(({
  audioUrl,
  playAudio,
  pauseAudio,
  togglePlayPause,
  stopAudio,
  seekAudio,
  setPlaybackSpeed,

  audioState = 'idle',
  currentUrl = null,
  currentTime = 0,
  duration = 0,
  playbackRate = 1.0,
  isAudioLoading = false,
  isGenerating = false,

  voicePicker = null,
  cardText = '',
  cardId = null,
  isBack = false,

  disabled = false,
  className = '',
  style = {},
  wrapperClassName = '',
  wrapperStyle = {}
}) => {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showVoiceMenu, setShowVoiceMenu] = useState(false);

  const autoPlay = useSettingsStore((s) => s.autoPlay);
  const setAutoPlay = useSettingsStore((s) => s.setAutoPlay);

  const resolveAudioUrl = (url) => {
    if (!url) return '';
    if (url.startsWith('http') || url.startsWith('/api/') || url.startsWith('blob:') || url.startsWith('data:')) return url;
    if (url.startsWith('audio/')) return `/api/media/${url}`;
    return `/api/media/audio/${url}`;
  };

  const rawUrl = (voicePicker?.previewUrl) || audioUrl;
  const effectiveUrl = resolveAudioUrl(rawUrl);
  const isThisActive = currentUrl === effectiveUrl && audioState !== 'idle';
  const isPlaying = isThisActive && audioState === 'playing';
  const isLoading = (isThisActive && (audioState === 'loading' || isAudioLoading))
    || isGenerating
    || voicePicker?.isGenerating;

  const handlePlayPauseClick = (e) => {
    e.stopPropagation();
    if (disabled || isLoading) return;
    if (togglePlayPause) {
      togglePlayPause(effectiveUrl);
    } else if (isPlaying) {
      pauseAudio?.();
    } else {
      playAudio?.(effectiveUrl);
    }
  };

  const handleStopClick = (e) => {
    e.stopPropagation();
    stopAudio?.();
  };

  const handleSeekChange = (e) => {
    e.stopPropagation();
    seekAudio?.(parseFloat(e.target.value));
  };

  const handleSpeedSelect = (speed, e) => {
    e.stopPropagation();
    setPlaybackSpeed?.(speed);
    setShowSpeedMenu(false);
  };

  const handleVoiceSelect = async (voice, e) => {
    e.stopPropagation();
    if (!voicePicker) return;
    setShowVoiceMenu(false);

    if (isThisActive) stopAudio?.();

    const voiceVal = (voice?.value === 'saved' || !voice?.value) ? null : voice.value;
    voicePicker.setSelectedVoice(voiceVal);
    voicePicker.setPreviewUrl(null);

    if (!voiceVal) {
      if (effectiveUrl) {
        playAudio?.(effectiveUrl);
      }
      return;
    }

    if (cardText) {
      if (cardId) {
        const url = await voicePicker.generateAndSaveToCard(cardId, cardText, isBack, voiceVal);
        if (url) playAudio?.(url);
      } else {
        const url = await voicePicker.generatePreview(cardText, voiceVal);
        if (url) playAudio?.(url);
      }
    }
  };

  const handleGeneratePreview = async (e) => {
    e.stopPropagation();
    if (!voicePicker || !cardText) return;
    const url = await voicePicker.generatePreview(cardText);
    if (url) {
      playAudio?.(url);
    }
  };

  const handleRegenerateAndSave = async (e) => {
    e.stopPropagation();
    if (!voicePicker || !cardText || !cardId) return;
    const url = await voicePicker.generateAndSaveToCard(cardId, cardText, isBack);
    if (url) {
      playAudio?.(url);
    }
  };

  // If card has no audio yet, allow generating audio on demand
  if (!effectiveUrl) {
    if (!voicePicker || !cardText || !cardId) return null;
    return createPortal(
      <div className={`card-audio-floating-wrapper ${wrapperClassName}`} style={wrapperStyle}>
        <div
          className={`card-audio-floating-pill glass ${className}`}
          style={{ ...style, gap: '8px', padding: '6px 12px' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="pill-btn-play"
            onClick={handleRegenerateAndSave}
            disabled={disabled || isLoading}
            style={{ width: 'auto', padding: '0 8px', borderRadius: '12px', gap: '4px', display: 'flex', alignItems: 'center' }}
            title="Сгенерировать и сохранить озвучку"
          >
            {isLoading ? (
              <RefreshCw size={14} className="spin" />
            ) : (
              <Volume2 size={14} />
            )}
            <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>Озвучить</span>
          </button>
        </div>
      </div>,
      document.body
    );
  }

  const progressPercent = duration > 0
    ? Math.min(100, Math.max(0, (currentTime / duration) * 100))
    : 0;

  const selectedVoiceLabel = voicePicker?.selectedVoice
    ? voicePicker?.voices.find((v) => v.value === voicePicker?.selectedVoice)
    : { value: null, label: 'Оригинал', gender: 's' };

  // ── COLLAPSED FLOATING PILL STATE ──────────────────────────────────────────
  if (isCollapsed) {
    return createPortal(
      <div className={`card-audio-floating-wrapper ${wrapperClassName}`} style={wrapperStyle}>
        <div
          className={`card-audio-floating-pill glass ${isPlaying ? 'playing' : ''} ${className}`}
          style={style}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Play/Pause Button */}
          <button
            type="button"
            className="pill-btn-play"
            onClick={handlePlayPauseClick}
            disabled={disabled || isLoading}
            title={isPlaying ? 'Пауза' : 'Воспроизвести'}
          >
            {isLoading ? (
              <RefreshCw size={16} className="spin" />
            ) : isPlaying ? (
              <Pause size={16} />
            ) : (
              <Play size={16} style={{ marginLeft: '1px' }} />
            )}
          </button>

          {/* Small Progress / Time indicator when playing */}
          {isThisActive && (
            <div className="pill-mini-info">
              <span className="pill-time">{formatTime(currentTime)}</span>
            </div>
          )}

          {/* Playback Speed indicator */}
          <button
            type="button"
            className="pill-btn-speed"
            onClick={(e) => {
              e.stopPropagation();
              const speeds = [0.5, 0.75, 1.0, 1.25, 1.5];
              const nextIdx = (speeds.indexOf(playbackRate) + 1) % speeds.length;
              setPlaybackSpeed?.(speeds[nextIdx]);
            }}
            title="Скорость"
          >
            {playbackRate}x
          </button>

          {/* Expand Button */}
          <button
            type="button"
            className="pill-btn-expand"
            onClick={(e) => {
              e.stopPropagation();
              setIsCollapsed(false);
            }}
            title="Раскрыть плеер"
          >
            <ChevronUp size={16} />
          </button>
        </div>
      </div>,
      document.body
    );
  }


  // ── EXPANDED FULL PLAYER STATE ────────────────────────────────────────────
  return createPortal(
    <div className={`card-audio-floating-wrapper ${wrapperClassName}`} style={wrapperStyle}>
      <div
        className={`card-audio-player-bar floating-expanded glass ${isThisActive ? 'active' : ''} ${className}`}
        style={style}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header Row with Voice Picker & Collapse toggle */}
        <div className="audio-player-header-row">
          <div className="audio-player-header-left">
            {voicePicker && voicePicker.voices.length > 0 && (
              <div className="audio-player-voice-picker">
                <button
                  type="button"
                  className={`audio-player-btn-voice ${!voicePicker.isDefaultVoice ? 'custom' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowVoiceMenu(!showVoiceMenu);
                    setShowSpeedMenu(false);
                  }}
                  title="Выбрать голос"
                >
                  <Mic2 size={12} />
                  <span>{selectedVoiceLabel?.label || '…'}</span>
                  <span className="voice-gender-icon">
                    {GENDER_ICON[selectedVoiceLabel?.gender] || ''}
                  </span>
                </button>

                {showVoiceMenu && (
                  <div className="audio-player-voice-dropdown glass">
                    <button
                      type="button"
                      className={`voice-option ${!voicePicker.selectedVoice ? 'active' : ''}`}
                      onClick={(e) => handleVoiceSelect({ value: null }, e)}
                    >
                      <span className="voice-option-gender">🔊</span>
                      <span>Оригинал</span>
                    </button>
                    {voicePicker.voices.map((v) => (
                      <button
                        key={v.value}
                        type="button"
                        className={`voice-option ${voicePicker.selectedVoice === v.value ? 'active' : ''}`}
                        onClick={(e) => handleVoiceSelect(v, e)}
                      >
                        <span className="voice-option-gender">{GENDER_ICON[v.gender]}</span>
                        <span>{v.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {voicePicker && (
              <button
                type="button"
                className={`audio-player-btn-regenerate ${voicePicker.isGenerating ? 'loading' : ''}`}
                onClick={cardId ? handleRegenerateAndSave : handleGeneratePreview}
                disabled={voicePicker.isGenerating || !cardText}
                title={cardId ? "Перезаписать озвучку выбранным голосом" : "Озвучить выбранным голосом"}
              >
                {voicePicker.isGenerating ? (
                  <RefreshCw size={12} className="spin" />
                ) : (
                  <RefreshCw size={12} />
                )}
                <span>{voicePicker.isGenerating ? 'Генерирую…' : cardId ? 'Перезаписать' : 'Прослушать'}</span>
              </button>
            )}

            <label
              className="audio-player-autoplay-label"
              onClick={(e) => e.stopPropagation()}
              title="Автоматическое воспроизведение аудио при открытии карточки"
            >
              <input
                type="checkbox"
                className="audio-player-autoplay-checkbox"
                checked={autoPlay}
                onChange={(e) => setAutoPlay(e.target.checked)}
              />
              <span className="audio-player-autoplay-text">Автовоспроизведение</span>
            </label>
          </div>

          <button
            type="button"
            className="audio-player-btn-collapse"
            onClick={(e) => {
              e.stopPropagation();
              setIsCollapsed(true);
              setShowSpeedMenu(false);
              setShowVoiceMenu(false);
            }}
            title="Свернуть"
          >
            <ChevronDown size={18} />
          </button>
        </div>

        {/* Row 1: Playback Controls */}
        <div className="audio-player-controls">
          {/* Play / Pause */}
          <button
            type="button"
            className={`audio-player-btn-main ${isPlaying ? 'playing' : ''}`}
            onClick={handlePlayPauseClick}
            disabled={disabled || isLoading}
            title={isPlaying ? 'Пауза' : 'Воспроизвести'}
          >
            {isLoading ? (
              <RefreshCw size={20} className="spin" />
            ) : isPlaying ? (
              <Pause size={20} />
            ) : (
              <Play size={20} style={{ marginLeft: '2px' }} />
            )}
          </button>

          {/* Stop */}
          {isThisActive && (
            <button
              type="button"
              className="audio-player-btn-stop"
              onClick={handleStopClick}
              title="Остановить"
            >
              <Square size={16} />
            </button>
          )}

          {/* Scrubber & Timestamps */}
          <div className="audio-player-progress-wrapper">
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTime || 0}
              onChange={handleSeekChange}
              className="audio-player-slider"
              style={{
                background: `linear-gradient(to right, #a855f7 ${progressPercent}%, rgba(255,255,255,0.15) ${progressPercent}%)`
              }}
            />
            <div className="audio-player-timestamps">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Speed Selector */}
          <div className="audio-player-speed-picker">
            <button
              type="button"
              className="audio-player-btn-speed"
              onClick={(e) => {
                e.stopPropagation();
                setShowSpeedMenu(!showSpeedMenu);
                setShowVoiceMenu(false);
              }}
              title="Скорость воспроизведения"
            >
              {playbackRate}x
            </button>
            {showSpeedMenu && (
              <div className="audio-player-speed-dropdown glass">
                {SPEEDS.map((spd) => (
                  <button
                    key={spd}
                    type="button"
                    className={`speed-option ${playbackRate === spd ? 'active' : ''}`}
                    onClick={(e) => handleSpeedSelect(spd, e)}
                  >
                    {spd}x
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
});

