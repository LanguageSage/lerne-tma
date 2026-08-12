import React, { useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Music, ChevronDown, ChevronUp, Pause, Play as PlayIcon } from 'lucide-react';

/**
 * Shared DeckAudioPlayer component.
 * Replaces duplicated audio players in StudyView.jsx (~210 lines) and CardList.jsx (~160 lines).
 *
 * @param {'compact' | 'full'} variant - 'compact' = collapsible (StudyView), 'full' = always expanded (CardList)
 */
const DeckAudioPlayer = React.memo(({ url, title, variant = 'full' }) => {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isExpanded, setIsExpanded] = useState(variant === 'full');

  useEffect(() => {
    queueMicrotask(() => {
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
    });
    if (audioRef.current) {
      audioRef.current.load();
      audioRef.current.playbackRate = playbackRate;
    }
  }, [url, playbackRate]);

  const togglePlay = (e) => {
    e.stopPropagation();
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(err => console.error(err));
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) setDuration(audioRef.current.duration);
  };

  const handleSeek = (e) => {
    const time = Number(e.target.value);
    setCurrentTime(time);
    if (audioRef.current) audioRef.current.currentTime = time;
  };

  const changeSpeed = (e) => {
    e.stopPropagation();
    const rates = [1, 1.25, 1.5, 0.75];
    const nextIdx = (rates.indexOf(playbackRate) + 1) % rates.length;
    const nextRate = rates[nextIdx];
    setPlaybackRate(nextRate);
    if (audioRef.current) audioRef.current.playbackRate = nextRate;
  };

  const formatTime = (time) => {
    if (isNaN(time)) return '0:00';
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const isCompact = variant === 'compact';

  // Controls row (shared between both variants)
  const renderControls = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', ...(isCompact ? { marginTop: '6px' } : {}) }}>
      <button
        onClick={togglePlay}
        style={{
          background: 'linear-gradient(135deg, #38bdf8, #6366f1)',
          border: 'none',
          color: 'white',
          width: isCompact ? '32px' : '38px',
          height: isCompact ? '32px' : '38px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          flexShrink: 0,
          ...(isCompact ? {} : { boxShadow: '0 4px 12px rgba(56, 189, 248, 0.3)' })
        }}
      >
        {isPlaying
          ? <Pause size={isCompact ? 14 : 18} fill="currentColor" />
          : <PlayIcon size={isCompact ? 14 : 18} fill="currentColor" style={{ marginLeft: isCompact ? '1px' : '2px' }} />
        }
      </button>

      <input
        type="range"
        min={0}
        max={duration || 100}
        value={currentTime}
        onChange={handleSeek}
        style={{
          flex: 1,
          height: isCompact ? '4px' : '5px',
          borderRadius: isCompact ? '4px' : '5px',
          background: 'rgba(255,255,255,0.1)',
          outline: 'none',
          cursor: 'pointer',
          WebkitAppearance: 'none'
        }}
        className={isCompact ? '' : 'deck-audio-slider'}
      />

      <span style={{
        fontSize: isCompact ? '0.7rem' : '0.75rem',
        color: '#94a3b8',
        minWidth: isCompact ? '60px' : '70px',
        textAlign: 'right',
        fontFamily: 'monospace'
      }}>
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>

      <button
        onClick={changeSpeed}
        style={{
          background: 'rgba(255, 255, 255, 0.08)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: isCompact ? '6px' : '8px',
          padding: isCompact ? '2px 6px' : '4px 8px',
          fontSize: isCompact ? '0.7rem' : '0.75rem',
          color: '#38bdf8',
          fontWeight: 700,
          cursor: 'pointer',
          minWidth: isCompact ? '36px' : '42px',
          textAlign: 'center'
        }}
      >
        {playbackRate}x
      </button>
    </div>
  );

  // COMPACT variant (collapsible, used in StudyView)
  if (isCompact) {
    return (
      <div className="glass" style={{
        margin: '0 15px 12px 15px',
        borderRadius: '14px',
        border: '1px solid rgba(56, 189, 248, 0.3)',
        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 41, 59, 0.8) 100%)',
        overflow: 'hidden',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: '0 6px 20px rgba(56, 189, 248, 0.15)'
      }}>
        <audio
          ref={audioRef}
          src={url}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={() => setIsPlaying(false)}
        />

        <div
          onClick={() => setIsExpanded(!isExpanded)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            cursor: 'pointer',
            userSelect: 'none'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
            <Music size={16} className={isPlaying ? "pulse-animation" : ""} style={{ color: '#38bdf8', flexShrink: 0 }} />
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {title || 'Аудио колоды'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {!isExpanded && (
              <button
                onClick={togglePlay}
                style={{
                  background: 'rgba(56, 189, 248, 0.15)',
                  border: 'none',
                  color: '#38bdf8',
                  width: '26px',
                  height: '26px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer'
                }}
              >
                {isPlaying ? <Pause size={12} fill="currentColor" /> : <PlayIcon size={12} fill="currentColor" style={{ marginLeft: '1px' }} />}
              </button>
            )}
            {isExpanded ? <ChevronUp size={16} color="#94a3b8" /> : <ChevronDown size={16} color="#94a3b8" />}
          </div>
        </div>

        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{ overflow: 'hidden' }}
            >
              <div style={{
                padding: '0 14px 12px 14px',
                borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                marginTop: '4px'
              }}>
                {renderControls()}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // FULL variant (always expanded, used in CardList)
  return (
    <div className="deck-audio-player glass" style={{
      padding: '12px 16px',
      borderRadius: '16px',
      background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.08) 0%, rgba(99, 102, 241, 0.04) 100%)',
      border: '1px solid rgba(56, 189, 248, 0.25)',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      margin: '0 15px 15px 15px'
    }} onClick={e => e.stopPropagation()}>
      <audio
        ref={audioRef}
        src={url}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => setIsPlaying(false)}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
        <span style={{ fontSize: '0.75rem', color: '#38bdf8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Аудиоматериал
        </span>
        <span style={{ fontSize: '0.8rem', color: '#e2e8f0', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>
          {title || 'Запись'}
        </span>
      </div>
      {renderControls()}
    </div>
  );
});

export default DeckAudioPlayer;
