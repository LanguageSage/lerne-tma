import { useCallback, useEffect, useRef, useState } from 'react';

export function useLocalAudioPlayer() {
  const audioRef = useRef(null);
  const [audioState, setAudioState] = useState('idle');
  const [currentUrl, setCurrentUrl] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRateState] = useState(1.0);
  const [isAudioLoading, setIsAudioLoading] = useState(false);

  const ensureAudio = useCallback(() => {
    if (!audioRef.current && typeof Audio !== 'undefined') {
      const audio = new Audio();
      audio.addEventListener('timeupdate', () => setCurrentTime(audio.currentTime || 0));
      audio.addEventListener('loadedmetadata', () => setDuration(audio.duration || 0));
      audio.addEventListener('durationchange', () => setDuration(audio.duration || 0));
      audio.addEventListener('playing', () => {
        setIsAudioLoading(false);
        setAudioState('playing');
      });
      audio.addEventListener('pause', () => {
        setIsAudioLoading(false);
        setAudioState(prev => (prev === 'idle' ? 'idle' : 'paused'));
      });
      audio.addEventListener('ended', () => {
        setIsAudioLoading(false);
        setAudioState('idle');
        setCurrentTime(0);
      });
      audio.addEventListener('error', () => {
        setIsAudioLoading(false);
        setAudioState('idle');
      });
      audioRef.current = audio;
    }
    return audioRef.current;
  }, []);

  useEffect(() => () => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = '';
    }
  }, []);

  const stopAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setIsAudioLoading(false);
    setAudioState('idle');
    setCurrentTime(0);
  }, []);

  const pauseAudio = useCallback(() => {
    audioRef.current?.pause();
    setAudioState('paused');
  }, []);

  const playAudio = useCallback((url, _ignored, onError) => {
    if (!url) return;
    const audio = ensureAudio();
    if (!audio) return;
    if (audio.src !== new URL(url, window.location.href).href) {
      audio.src = url;
      setCurrentTime(0);
      setDuration(0);
    }
    audio.playbackRate = playbackRate;
    setCurrentUrl(url);
    setIsAudioLoading(true);
    setAudioState('loading');
    const result = audio.play();
    if (result && typeof result.catch === 'function') {
      result.catch(err => {
        setIsAudioLoading(false);
        setAudioState('idle');
        onError?.(err);
      });
    }
  }, [ensureAudio, playbackRate]);

  const togglePlayPause = useCallback((url, _ignored, onError) => {
    const audio = audioRef.current;
    if (url && currentUrl === url && audioState === 'playing') {
      pauseAudio();
      return;
    }
    if (url && currentUrl === url && audioState === 'paused' && audio?.src) {
      audio.playbackRate = playbackRate;
      const result = audio.play();
      if (result && typeof result.catch === 'function') {
        result.catch(err => onError?.(err));
      }
      return;
    }
    playAudio(url, undefined, onError);
  }, [audioState, currentUrl, pauseAudio, playAudio, playbackRate]);

  const seekAudio = useCallback((time) => {
    if (audioRef.current && Number.isFinite(time)) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  }, []);

  const setPlaybackSpeed = useCallback((rate) => {
    setPlaybackRateState(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  }, []);

  return {
    playAudio,
    pauseAudio,
    resumeAudio: () => audioRef.current?.play?.(),
    togglePlayPause,
    stopAudio,
    seekAudio,
    setPlaybackSpeed,
    audioState,
    currentUrl,
    currentTime,
    duration,
    playbackRate,
    isAudioLoading,
  };
}
