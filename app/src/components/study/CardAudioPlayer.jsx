import React, { useState } from 'react';
import { Play, Pause, Square, Volume2, RefreshCw, Sparkles, Mic2 } from 'lucide-react';
import './CardAudioPlayer.css';

const formatTime = (seconds) => {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

const SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5];

const GENDER_ICON = { f: '♀', m: '♂' };

export const CardAudioPlayer = React.memo(({
  // Audio source — can be overridden by voicePicker.previewUrl
  audioUrl,

  // Playback controls from useAudio
  playAudio,
  pauseAudio,
  resumeAudio,
  togglePlayPause,
  stopAudio,
  seekAudio,
  setPlaybackSpeed,

  // Playback state from useAudio
  audioState = 'idle',
  currentUrl = null,
  currentTime = 0,
  duration = 0,
  playbackRate = 1.0,
  isAudioLoading = false,
  isGenerating = false,

  // Voice picker (optional) — pass the result of useVoicePicker()
  voicePicker = null,
  // Text to generate preview with (card.front or card.back)
  cardText = '',

  disabled = false,
  compact = false,
  className = '',
  style = {}
}) => {
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showVoiceMenu, setShowVoiceMenu] = useState(false);

  // If a voice preview was generated, use that URL; otherwise fall back to the original
  const effectiveUrl = (voicePicker?.previewUrl) || audioUrl;

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

    // Stop current audio before switching voice
    if (isThisActive) stopAudio?.();

    voicePicker.setSelectedVoice(voice.value);
    voicePicker.setPreviewUrl(null); // clear stale preview, will regenerate on play
  };

  const handleGeneratePreview = async (e) => {
    e.stopPropagation();
    if (!voicePicker || !cardText) return;
    const url = await voicePicker.generatePreview(cardText);
    if (url) {
      // Auto-play the new preview
      playAudio?.(url);
    }
  };

  if (!audioUrl) return null;

  // ── Compact mode ──────────────────────────────────────────────────────────
  // When compact=true and nothing is active, show a minimal play button.
  // Once playing/paused, we fall through to the full player bar.
  if (compact && !isThisActive && !voicePicker) {
    return (
      <button
        type="button"
        className={`card-audio-btn-compact ${className}`}
        style={style}
        disabled={disabled}
        onClick={handlePlayPauseClick}
        title="Прослушать"
      >
        {isLoading ? (
          isGenerating ? (
            <Sparkles size={22} className="sparkles-spin" style={{ color: '#a855f7' }} />
          ) : (
            <RefreshCw size={22} className="spin" />
          )
        ) : (
          <Volume2 size={22} />
        )}
      </button>
    );
  }

  // ── Full player bar ───────────────────────────────────────────────────────
  const progressPercent = duration > 0
    ? Math.min(100, Math.max(0, (currentTime / duration) * 100))
    : 0;

  const selectedVoiceLabel = voicePicker?.voices.find(
    (v) => v.value === voicePicker?.selectedVoice
  );

  const needsRegenerate = voicePicker && !voicePicker.isDefaultVoice && !voicePicker.previewUrl;

  return (
    <div
      className={`card-audio-player-bar glass ${isThisActive ? 'active' : ''} ${className}`}
      style={style}
      onClick={(e) => e.stopPropagation()}
    >
      {/* ── Row 1: Playback controls ──────────────────────────────── */}
      <div className="audio-player-controls">
        {/* Play / Pause */}
        <button
          type="button"
          className={`audio-player-btn-main ${isPlaying ? 'playing' : ''}`}
          onClick={handlePlayPauseClick}
          disabled={disabled || isLoading || needsRegenerate}
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

        {/* Progress scrubber */}
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

        {/* Speed picker */}
        <div className="audio-player-speed-picker">
          <button
            type="button"
            className="audio-player-btn-speed"
            onClick={(e) => { e.stopPropagation(); setShowSpeedMenu(!showSpeedMenu); setShowVoiceMenu(false); }}
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

      {/* ── Row 2: Voice picker (optional) ───────────────────────── */}
      {voicePicker && voicePicker.voices.length > 0 && (
        <div className="audio-player-voice-row">
          <div className="audio-player-voice-picker">
            <button
              type="button"
              className={`audio-player-btn-voice ${!voicePicker.isDefaultVoice ? 'custom' : ''}`}
              onClick={(e) => { e.stopPropagation(); setShowVoiceMenu(!showVoiceMenu); setShowSpeedMenu(false); }}
              title="Выбрать голос"
            >
              <Mic2 size={13} />
              <span>{selectedVoiceLabel?.label || '…'}</span>
              <span className="voice-gender-icon">
                {GENDER_ICON[selectedVoiceLabel?.gender] || ''}
              </span>
            </button>

            {showVoiceMenu && (
              <div className="audio-player-voice-dropdown glass">
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

          {/* Regenerate button — shown only when a non-default voice is selected */}
          {!voicePicker.isDefaultVoice && (
            <button
              type="button"
              className={`audio-player-btn-regenerate ${voicePicker.isGenerating ? 'loading' : ''}`}
              onClick={handleGeneratePreview}
              disabled={voicePicker.isGenerating || !cardText}
              title="Озвучить другим голосом"
            >
              {voicePicker.isGenerating ? (
                <RefreshCw size={13} className="spin" />
              ) : (
                <Volume2 size={13} />
              )}
              <span>{voicePicker.isGenerating ? 'Генерирую…' : 'Прослушать'}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
});
