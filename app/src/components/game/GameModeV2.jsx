import React, { useReducer, useEffect, useRef, useCallback, useState } from 'react';
import { Play, Pause, Square, Send, Mic, AlertCircle, Volume2, User, RotateCcw } from 'lucide-react';
import { tr } from '../../i18n/locale.js';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale.js';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition.js';
import { stopGlobalAudio } from '../../hooks/useAudio.js';
import { getAudioUrl } from '../../utils/media.js';
import api from '../../services/api.js';
import { FrauMuellerAvatar } from './FrauMuellerAvatar.jsx';
import {
  GamePhase,
  GameAction,
  initialGameState,
  gameReducer,
} from './gameV2Controller.js';
import './GameModeV2.css';

export function GameModeV2() {
  useInterfaceLocale();

  const [state, dispatch] = useReducer(gameReducer, initialGameState);

  const isMountedRef = useRef(true);
  const activeSessionRef = useRef(null);
  const sendingSessionRef = useRef(null);
  const isPausedRef = useRef(false);
  const isEndedRef = useRef(false);
  const dialogueEndRef = useRef(null);
  const lastAssistantTextRef = useRef('');

  // Assistant audio element and precise playback state for lip sync
  const audioElementRef = useRef(null);
  const speechRequestRef = useRef(0);
  const cancelPlaybackRef = useRef(null);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [activeReplayingText, setActiveReplayingText] = useState(null);

  // User voice recording refs & playback state
  const mediaStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordingRequestRef = useRef(null);
  const recordingStopRef = useRef(null);
  const audioChunksRef = useRef([]);
  const pendingUserAudioUrlRef = useRef(null);
  const createdAudioUrlsRef = useRef([]);
  const userAudioElementRef = useRef(null);
  const [activePlayingUserAudioUrl, setActivePlayingUserAudioUrl] = useState(null);

  isPausedRef.current = state.isPaused;
  isEndedRef.current = state.phase === GamePhase.ENDED;

  // Initialize and clean up audio instances and object URLs
  useEffect(() => {
    isMountedRef.current = true;
    if (typeof Audio !== 'undefined') {
      const audio = new Audio();
      audio.playsInline = true;
      audioElementRef.current = audio;
    }
    return () => {
      isMountedRef.current = false;
      if (audioElementRef.current) {
        try {
          audioElementRef.current.pause();
          audioElementRef.current.src = '';
        } catch { /* The media element may already be detached. */ }
      }
      if (userAudioElementRef.current) {
        try {
          userAudioElementRef.current.pause();
          userAudioElementRef.current.src = '';
        } catch { /* The media element may already be detached. */ }
      }
      if (mediaStreamRef.current) {
        try {
          mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        } catch { /* Continue cleanup if the stream is unavailable. */ }
      }
      createdAudioUrlsRef.current.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch { /* Continue releasing the other recording URLs. */ }
      });
      createdAudioUrlsRef.current = [];
    };
  }, []);

  // Synchronously unlock browser audio pipeline on user interaction
  const unlockAudio = useCallback(() => {
    try {
      const audio = audioElementRef.current;
      if (audio) {
        audio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
        audio.play().catch(() => {});
      }
    } catch { /* Text remains available if the browser blocks audio. */ }
  }, []);

  // Stop active speech audio immediately and reset avatar speech animation
  const stopSpeechAudio = useCallback(() => {
    speechRequestRef.current += 1;
    cancelPlaybackRef.current?.();
    setIsAssistantSpeaking(false);
    if (audioElementRef.current) {
      try {
        audioElementRef.current.pause();
        audioElementRef.current.currentTime = 0;
      } catch { /* The element may not be seekable yet. */ }
    }
    stopGlobalAudio();
    return speechRequestRef.current;
  }, []);

  // Play audio URL via dedicated HTML5 Audio element with exact event synchronization
  const playEdgeAudio = useCallback((audioUrl) => {
    return new Promise((resolve) => {
      let audio = audioElementRef.current;
      if (!audio && typeof Audio !== 'undefined') {
        audio = new Audio();
        audio.playsInline = true;
        audioElementRef.current = audio;
      }
      if (!audio) {
        resolve(false);
        return;
      }

      let finished = false;
      const playbackTimer = setTimeout(() => { audio.pause(); done(false); }, 60000);
      const cleanup = () => {
        clearTimeout(playbackTimer);
        audio.removeEventListener('playing', onPlaying);
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
        cancelPlaybackRef.current = null;
        setIsAssistantSpeaking(false);
      };

      const done = (success) => {
        if (finished) return;
        finished = true;
        cleanup();
        resolve(success);
      };

      const onPlaying = () => {
        if (!finished) setIsAssistantSpeaking(true);
      };
      const onEnded = () => done(true);
      const onError = (e) => {
        console.warn('Audio playback error on url:', audioUrl, e);
        done(false);
      };

      audio.addEventListener('playing', onPlaying);
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);
      cancelPlaybackRef.current = () => done(false);

      audio.src = audioUrl;
      audio.currentTime = 0;

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            if (!finished) {
              setIsAssistantSpeaking(true);
            }
          })
          .catch((err) => {
            console.warn('Audio play() rejected by browser:', err);
            done(false);
          });
      }
    });
  }, []);

  // Start recording user's microphone audio via MediaRecorder
  const startUserRecording = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
    if (typeof MediaRecorder === 'undefined') return;
    if (recordingRequestRef.current || recordingStopRef.current || mediaRecorderRef.current?.state === 'recording') return;

    const request = {};
    recordingRequestRef.current = request;
    try {
      let stream = mediaStreamRef.current;
      if (!stream || !stream.active) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (recordingRequestRef.current !== request || !isMountedRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        mediaStreamRef.current = stream;
      }

      let mimeType = '';
      const types = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
        'audio/aac',
      ];
      for (const t of types) {
        if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) {
          mimeType = t;
          break;
        }
      }

      const options = mimeType ? { mimeType } : undefined;
      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.start(100);
    } catch (err) {
      if (recordingRequestRef.current !== request) return;
      console.warn('Failed to start MediaRecorder:', err);
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    } finally {
      if (recordingRequestRef.current === request) recordingRequestRef.current = null;
    }
  }, []);

  // Stop recording user's microphone audio and resolve with object URL
  const stopUserRecording = useCallback(() => {
    recordingRequestRef.current = null;
    if (recordingStopRef.current) return recordingStopRef.current;
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return Promise.resolve(pendingUserAudioUrlRef.current);

    recordingStopRef.current = new Promise((resolve) => {
      recorder.onstop = () => {
        try {
          if (isMountedRef.current && audioChunksRef.current.length > 0) {
            const mimeType = recorder.mimeType || 'audio/webm';
            const blob = new Blob(audioChunksRef.current, { type: mimeType });
            const url = URL.createObjectURL(blob);
            createdAudioUrlsRef.current.push(url);
            pendingUserAudioUrlRef.current = url;
            resolve(url);
          } else {
            resolve(pendingUserAudioUrlRef.current || null);
          }
        } catch (e) {
          console.warn('Error creating recorded audio blob:', e);
          resolve(null);
        } finally {
          audioChunksRef.current = [];
          mediaRecorderRef.current = null;
          if (mediaStreamRef.current) {
            try {
              mediaStreamRef.current.getTracks().forEach((track) => track.stop());
            } catch { /* The stream may already have ended. */ }
            mediaStreamRef.current = null;
          }
        }
      };

      try {
        recorder.stop();
      } catch (err) {
        console.warn('Error stopping MediaRecorder:', err);
        resolve(pendingUserAudioUrlRef.current || null);
      }
    }).finally(() => { recordingStopRef.current = null; });
    return recordingStopRef.current;
  }, []);

  // Playback user's own recorded voice clip
  const handlePlayUserVoice = useCallback((url) => {
    if (!url) return;
    // If currently playing this clip, toggle pause
    if (activePlayingUserAudioUrl === url && userAudioElementRef.current && !userAudioElementRef.current.paused) {
      userAudioElementRef.current.pause();
      setActivePlayingUserAudioUrl(null);
      return;
    }

    // Stop assistant speech
    stopSpeechAudio();
    setActiveReplayingText(null);

    if (userAudioElementRef.current) {
      try {
        userAudioElementRef.current.pause();
        userAudioElementRef.current.src = '';
      } catch { /* Replacing the element also stops the old clip. */ }
    }

    const audio = new Audio(url);
    userAudioElementRef.current = audio;
    setActivePlayingUserAudioUrl(url);

    audio.onended = () => {
      setActivePlayingUserAudioUrl(null);
    };
    audio.onerror = () => {
      setActivePlayingUserAudioUrl(null);
    };

    audio.play().catch((err) => {
      console.warn('Error playing user voice recording:', err);
      setActivePlayingUserAudioUrl(null);
    });
  }, [activePlayingUserAudioUrl, stopSpeechAudio]);

  useEffect(() => {
    const history = dialogueEndRef.current?.parentElement;
    if (history) history.scrollTop = history.scrollHeight;
  }, [state.history, state.phase]);

  const autoSendRef = useRef(null);

  // STT Hook integration
  const handleTranscript = useCallback((text) => {
    if (isEndedRef.current || isPausedRef.current) return;
    dispatch({ type: GameAction.STT_TRANSCRIPT, payload: text });
  }, []);

  const {
    isListening,
    speechError,
    start: startSTT,
    stop: stopSTT,
    cancel: cancelSTT,
  } = useSpeechRecognition({
    resetKey: state.sessionId || 'gamemode-v2',
    language: 'de',
    silenceTimeoutMs: null,
    autoRestart: true,
    onTranscript: handleTranscript,
  });

  // Dedicated Microsoft Edge TTS execution for main dialogue turn progression
  const speakText = useCallback(async (text, voice = 'de-DE-KatjaNeural') => {
    if (isEndedRef.current || isPausedRef.current) return;

    lastAssistantTextRef.current = text;
    cancelSTT();
    const speechRequest = stopSpeechAudio();
    stopUserRecording();
    setActiveReplayingText(null);
    if (userAudioElementRef.current) {
      try {
        userAudioElementRef.current.pause();
      } catch { /* Assistant playback can continue without this clip. */ }
      setActivePlayingUserAudioUrl(null);
    }

    dispatch({ type: GameAction.TTS_STARTED });

    try {
      const res = await api.post('/media/generate-audio', {
        text,
        lang: 'de',
        voice,
        rate: '+0%',
      });

      if (speechRequest !== speechRequestRef.current) return;

      const rawPath = res.data?.path || res.data?.url;
      const audioUrl = getAudioUrl(rawPath);
      if (!audioUrl) throw new Error('No audio URL returned from TTS endpoint');

      if (!await playEdgeAudio(audioUrl)) throw new Error('Audio playback failed');
    } catch (err) {
      if (speechRequest !== speechRequestRef.current) return;
      console.error('Microsoft Edge TTS generation/playback failed:', err);
      dispatch({
        type: GameAction.ERROR,
        payload: tr('Не удалось синтезировать речь через Microsoft Edge TTS.'),
      });
    }

    if (speechRequest !== speechRequestRef.current) return;

    dispatch({ type: GameAction.TTS_FINISHED });

    // After Frau Müller finishes speaking, automatically open microphone and start user recording
    try {
      startSTT();
      startUserRecording();
      dispatch({ type: GameAction.STT_STARTED });
    } catch {
      dispatch({ type: GameAction.ERROR, payload: tr('Ошибка запуска микрофона.') });
    }
  }, [cancelSTT, playEdgeAudio, startSTT, startUserRecording, stopSpeechAudio, stopUserRecording]);

  // Replay assistant speech anytime (Active, Paused, or Ended) without changing conversation flow
  const replayAssistantMessage = useCallback(async (text, voice = 'de-DE-KatjaNeural') => {
    if (!text) return;
    const wasListening = state.phase === GamePhase.USER_LISTENING;
    // Toggle pause if clicking the currently replaying text
    if (activeReplayingText === text) {
      stopSpeechAudio();
      setActiveReplayingText(null);
      if (wasListening) {
        startSTT();
        startUserRecording();
      }
      return;
    }

    // Stop any active user voice playback
    if (userAudioElementRef.current) {
      try {
        userAudioElementRef.current.pause();
      } catch { /* Replay can continue without the user's clip. */ }
      setActivePlayingUserAudioUrl(null);
    }

    const speechRequest = stopSpeechAudio();
    unlockAudio();

    if (wasListening) {
      cancelSTT();
    }

    setActiveReplayingText(text);

    try {
      const res = await api.post('/media/generate-audio', {
        text,
        lang: 'de',
        voice,
        rate: '+0%',
      });

      if (speechRequest !== speechRequestRef.current) return;

      const rawPath = res.data?.path || res.data?.url;
      const audioUrl = getAudioUrl(rawPath);
      if (!audioUrl) throw new Error('No audio URL returned');

      await playEdgeAudio(audioUrl);
    } catch (err) {
      console.warn('Replay error:', err);
    } finally {
      if (speechRequest === speechRequestRef.current) {
        setActiveReplayingText(null);
        if (wasListening && !isEndedRef.current && !isPausedRef.current) {
          try {
            startSTT();
            startUserRecording();
          } catch { /* A manual microphone retry remains available. */ }
        }
      }
    }
  }, [activeReplayingText, cancelSTT, playEdgeAudio, startSTT, startUserRecording, state.phase, stopSpeechAudio, unlockAudio]);

  // 1. Start / Restart session
  const handleStart = async () => {
    unlockAudio();
    dispatch({ type: GameAction.START });
    try {
      const { data } = await api.post('/game/v2/session/start');
      if (!isMountedRef.current) return;

      activeSessionRef.current = data.session_id;
      pendingUserAudioUrlRef.current = null;
      lastAssistantTextRef.current = data.greeting;
      dispatch({
        type: GameAction.START_SUCCESS,
        payload: {
          sessionId: data.session_id,
          greeting: data.greeting,
          history: data.history,
        },
      });

      // Frau Müller speaks greeting
      await speakText(data.greeting, data.character?.tts_voice);
    } catch (err) {
      if (!isMountedRef.current) return;
      const msg = err.response?.data?.detail || tr('Не удалось начать сессию.');
      dispatch({ type: GameAction.ERROR, payload: msg });
    }
  };

  // 2. Pause
  const handlePause = () => {
    isPausedRef.current = true;
    dispatch({ type: GameAction.PAUSE });
    cancelSTT();
    stopSpeechAudio();
    setActiveReplayingText(null);
    stopUserRecording();
    if (userAudioElementRef.current) {
      try {
        userAudioElementRef.current.pause();
      } catch { /* The clip may already have stopped. */ }
      setActivePlayingUserAudioUrl(null);
    }
  };

  // 3. Resume
  const handleResume = () => {
    stopSpeechAudio();
    setActiveReplayingText(null);
    unlockAudio();
    dispatch({ type: GameAction.RESUME });
    if (!state.draft.trim() && state.phase !== GamePhase.AI_THINKING) {
      try {
        startSTT();
        startUserRecording();
        dispatch({ type: GameAction.STT_STARTED });
      } catch {
        dispatch({ type: GameAction.ERROR, payload: tr('Ошибка запуска микрофона.') });
      }
    }
  };

  // 4. End session
  const handleEnd = async () => {
    const sessionId = activeSessionRef.current;
    activeSessionRef.current = null;
    isEndedRef.current = true;
    dispatch({ type: GameAction.END });
    cancelSTT();
    stopSpeechAudio();
    setActiveReplayingText(null);
    stopUserRecording();
    if (userAudioElementRef.current) {
      try {
        userAudioElementRef.current.pause();
      } catch { /* The clip may already have stopped. */ }
      setActivePlayingUserAudioUrl(null);
    }

    if (sessionId) {
      try {
        await api.post(`/game/v2/session/${sessionId}/end`);
      } catch (err) {
        console.warn('Error ending session:', err);
      }
    }
  };

  // 5. Reset to start a new conversation
  const handleReset = () => {
    stopSpeechAudio();
    stopUserRecording();
    pendingUserAudioUrlRef.current = null;
    if (userAudioElementRef.current) {
      try {
        userAudioElementRef.current.pause();
        userAudioElementRef.current.src = '';
      } catch { /* The clip may already have stopped. */ }
      setActivePlayingUserAudioUrl(null);
    }
    setActiveReplayingText(null);
    dispatch({ type: GameAction.RESET });
    handleStart();
  };

  // 6. User finishes speaking
  const handleFinishUtterance = async () => {
    stopSTT();
    await stopUserRecording();
    if (isPausedRef.current || isEndedRef.current) return;
    dispatch({ type: GameAction.FINISH_UTTERANCE });
  };

  // 7. Manual trigger to toggle microphone if user wants to speak again
  const handleToggleMic = async () => {
    if (inputBlocked) return;
    if (microphoneActive) {
      stopSTT();
      await stopUserRecording();
      if (isPausedRef.current || isEndedRef.current) return;
      dispatch({ type: GameAction.FINISH_UTTERANCE });
    } else {
      stopSpeechAudio();
      setActiveReplayingText(null);
      startSTT();
      startUserRecording();
      dispatch({ type: GameAction.STT_STARTED });
    }
  };

  // 8. Send user message to Frau Müller
  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    const message = state.draft.trim();
    const sessionId = state.sessionId;
    if (!message || !sessionId || inputBlocked || sendingSessionRef.current === sessionId) return;
    sendingSessionRef.current = sessionId;
    stopSpeechAudio();
    setActiveReplayingText(null);
    unlockAudio();

    try {
      cancelSTT();
      const recordedAudioUrl = await stopUserRecording();
      if (!isMountedRef.current || activeSessionRef.current !== sessionId || isPausedRef.current) return;
      dispatch({ type: GameAction.SEND_MESSAGE, payload: { message, audioUrl: recordedAudioUrl } });

      const { data } = await api.post(`/game/v2/session/${sessionId}/message`, {
        message,
      });
      if (!isMountedRef.current || activeSessionRef.current !== sessionId) return;
      pendingUserAudioUrlRef.current = null;

      lastAssistantTextRef.current = data.reply.text;
      dispatch({
        type: GameAction.AI_SUCCESS,
        payload: { reply: data.reply },
      });

      await speakText(data.reply.text);
    } catch (err) {
      if (!isMountedRef.current || activeSessionRef.current !== sessionId) return;
      const detail = err.response?.data?.detail || tr('Ошибка связи с ИИ. Попробуйте отправить снова.');
      dispatch({ type: GameAction.AI_FAILURE, payload: detail });
    } finally {
      if (sendingSessionRef.current === sessionId) sendingSessionRef.current = null;
    }
  };

  useEffect(() => { autoSendRef.current = handleSendMessage; });
  useEffect(() => {
    if (state.phase !== GamePhase.USER_LISTENING || state.isPaused || !state.draft.trim()) return;
    const timer = setTimeout(() => autoSendRef.current?.(), 1500);
    return () => clearTimeout(timer);
  }, [state.draft, state.phase, state.isPaused]);

  // Replay Frau Müller's last phrase
  const handleReplayLast = () => {
    if (lastAssistantTextRef.current) {
      replayAssistantMessage(lastAssistantTextRef.current);
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      cancelSTT();
      stopSpeechAudio();
      stopUserRecording();
    };
  }, [cancelSTT, stopSpeechAudio, stopUserRecording]);

  const isSessionStarted = state.phase !== GamePhase.IDLE && state.phase !== GamePhase.STARTING;
  const turnInProgress = state.phase === GamePhase.AI_THINKING || state.phase === GamePhase.NPC_SPEAKING;
  const inputBlocked = state.isPaused || turnInProgress || state.phase === GamePhase.ENDED;
  const microphoneActive = state.phase === GamePhase.USER_LISTENING && isListening && !speechError;

  // Status subtitle helper
  const getStatusSubtitle = () => {
    if (state.isPaused) return tr('Разговор на паузе');
    if (isAssistantSpeaking) return tr('Frau Müller говорит…');
    switch (state.phase) {
      case GamePhase.NPC_SPEAKING:
        return tr('Frau Müller готовит ответ…');
      case GamePhase.USER_LISTENING:
        return tr(microphoneActive ? 'Слушает вас: говорите по-немецки' : 'Проверьте реплику и отправьте');
      case GamePhase.USER_EDITING:
        return tr('Проверьте реплику и отправьте');
      case GamePhase.AI_THINKING:
        return tr('Frau Müller обдумывает ответ…');
      case GamePhase.ENDED:
        return tr('Разговор завершён');
      default:
        return tr('Ваша соседка · Говорит по-немецки');
    }
  };

  return (
    <div className="gamemode-v2-container">
      {/* Header */}
      <header className="gamemode-header">
        <div className="gamemode-character-info">
          <FrauMuellerAvatar
            size="small"
            isSpeaking={isAssistantSpeaking}
            phase={state.phase}
          />
          <div>
            <h2 className="character-name">Frau Müller</h2>
            <p className="character-subtitle">{getStatusSubtitle()}</p>
          </div>
        </div>

        {/* Global Controls */}
        <div className="gamemode-top-controls">
          {!isSessionStarted ? (
            <button
              type="button"
              className="btn-primary gamemode-btn"
              onClick={handleStart}
              disabled={state.phase === GamePhase.STARTING}
            >
              <Play size={18} />
              <span>{tr('Старт')}</span>
            </button>
          ) : state.phase === GamePhase.ENDED ? (
            <button
              type="button"
              className="btn-primary gamemode-btn"
              onClick={handleReset}
            >
              <RotateCcw size={18} />
              <span>{tr('Старт')}</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn-secondary gamemode-btn"
                onClick={state.isPaused ? handleResume : handlePause}
              >
                {state.isPaused ? <Play size={18} /> : <Pause size={18} />}
                <span>{tr(state.isPaused ? 'Продолжить' : 'Пауза')}</span>
              </button>

              <button
                type="button"
                className="btn-danger gamemode-btn"
                onClick={handleEnd}
              >
                <Square size={18} />
                <span>{tr('Закончить')}</span>
              </button>
            </>
          )}
        </div>
      </header>

      {/* Error / Diagnostic message */}
      {(state.error || speechError) && (
        <div className="gamemode-diagnostic-banner" role="alert">
          <AlertCircle size={18} className="diagnostic-icon" />
          <span>{state.error || speechError}</span>
        </div>
      )}

      {/* Prominent Frau Müller Character Stage (Visible during active dialogue and ended review) */}
      {isSessionStarted && (
        <section className="gamemode-character-stage" aria-label="Frau Müller Stage">
          <div className="stage-avatar-wrapper">
            <FrauMuellerAvatar
              size="large"
              isSpeaking={isAssistantSpeaking}
              phase={state.phase}
            />
          </div>
          <div className="stage-character-details">
            <div className="stage-title-row">
              <span className="stage-name">Frau Müller</span>
              {isAssistantSpeaking && (
                <span className="stage-badge speaking">
                  <Volume2 size={14} className="pulse-icon" />
                  {tr('Говорит…')}
                </span>
              )}
              {state.phase === GamePhase.NPC_SPEAKING && !isAssistantSpeaking && (
                <span className="stage-badge thinking">
                  <span className="dots-pulse" />
                  {tr('Подготовка речи…')}
                </span>
              )}
              {microphoneActive && !isAssistantSpeaking && (
                <span className="stage-badge listening">
                  <Mic size={14} className="pulse-icon" />
                  {tr('Слушает вас')}
                </span>
              )}
              {state.phase === GamePhase.AI_THINKING && (
                <span className="stage-badge thinking">
                  <span className="dots-pulse" />
                  {tr('Отвечает…')}
                </span>
              )}
              {state.isPaused && !isAssistantSpeaking && (
                <span className="stage-badge paused">
                  {tr('Пауза')}
                </span>
              )}
              {state.phase === GamePhase.ENDED && !isAssistantSpeaking && (
                <span className="stage-badge ended">
                  {tr('Завершено')}
                </span>
              )}

              {lastAssistantTextRef.current && (
                <button
                  type="button"
                  className={`stage-replay-btn ${activeReplayingText === lastAssistantTextRef.current ? 'is-playing' : ''}`}
                  onClick={handleReplayLast}
                  disabled={turnInProgress}
                  title={tr('Повторить озвучку')}
                >
                  <Volume2 size={15} />
                  <span>{activeReplayingText === lastAssistantTextRef.current ? tr('Остановить') : tr('Озвучить')}</span>
                </button>
              )}
            </div>
            <p className="stage-prompt-cue">
              {isAssistantSpeaking
                ? tr('Слушайте немецкую речь фрау Мюллер…')
                : microphoneActive
                ? tr('Говорите в микрофон: реплика отправится после паузы. «Завершить реплику» — проверить текст.')
                : state.phase === GamePhase.USER_EDITING || state.phase === GamePhase.USER_LISTENING
                ? tr('Отредактируйте текст при необходимости и нажмите «Отправить»')
                : state.phase === GamePhase.AI_THINKING
                ? tr('Фрау Мюллер формулирует мысль…')
                : state.phase === GamePhase.ENDED
                ? tr('Беседа окончена. Вы можете прослушать записи реплик или нажать «Старт», чтобы поговорить снова.')
                : tr('Доброжелательная соседка из Мюнхена')}
            </p>
          </div>
        </section>
      )}

      {/* Dialogue history scroll view */}
      <main className="gamemode-chat-history">
        {!isSessionStarted && (
          <div className="gamemode-empty-state">
            <FrauMuellerAvatar
              size="hero"
              isSpeaking={false}
              phase={state.phase}
            />
            <h3 className="empty-title">Frau Müller</h3>
            <p className="empty-description">
              {tr('Доброжелательная соседка, готовая поговорить с вами о жизни, новостях дома и повседневных делах на естественном немецком языке.')}
            </p>
            <button
              type="button"
              className="btn-primary gamemode-start-hero-btn"
              onClick={handleStart}
              disabled={state.phase === GamePhase.STARTING}
            >
              <Play size={20} />
              <span>{tr('Начать разговор')}</span>
            </button>
          </div>
        )}

        {state.history.map((msg, index) => (
          <div
            key={index}
            className={`gamemode-message ${msg.role === 'assistant' ? 'assistant' : 'user'}`}
          >
            {msg.role === 'assistant' ? (
              <FrauMuellerAvatar
                size="small"
                isSpeaking={isAssistantSpeaking && (activeReplayingText === msg.text || (state.phase === GamePhase.NPC_SPEAKING && index === state.history.length - 1))}
                phase={state.phase}
              />
            ) : (
              <div className="message-sender-icon">
                <User size={18} />
              </div>
            )}
            <div className="message-bubble">
              <div className="message-content">
                <p className="message-text">{msg.text}</p>
                {msg.role === 'user' && msg.audioUrl && (
                  <div className="message-audio-row">
                    <button
                      type="button"
                      className={`message-user-voice-btn ${activePlayingUserAudioUrl === msg.audioUrl ? 'is-playing' : ''}`}
                      onClick={() => handlePlayUserVoice(msg.audioUrl)}
                      disabled={turnInProgress}
                      title={tr('Прослушать мою запись')}
                    >
                      <Volume2 size={13} className={activePlayingUserAudioUrl === msg.audioUrl ? 'pulse-icon' : ''} />
                      <span>{activePlayingUserAudioUrl === msg.audioUrl ? tr('Остановить') : tr('Мой голос')}</span>
                    </button>
                  </div>
                )}
              </div>
              {msg.role === 'assistant' && (
                <button
                  type="button"
                  className={`message-replay-btn ${activeReplayingText === msg.text ? 'is-playing' : ''}`}
                  onClick={() => replayAssistantMessage(msg.text)}
                  disabled={turnInProgress}
                  title={tr('Прослушать эту фразу')}
                >
                  <Volume2 size={15} />
                </button>
              )}
            </div>
          </div>
        ))}

        {state.phase === GamePhase.NPC_SPEAKING && (
          <div className="gamemode-status-indicator npc-speaking">
            <Volume2 size={18} className="pulse-icon" />
            <span>{isAssistantSpeaking ? tr('Frau Müller говорит…') : tr('Frau Müller готовит ответ…')}</span>
          </div>
        )}

        {state.phase === GamePhase.AI_THINKING && (
          <div className="gamemode-status-indicator ai-thinking">
            <div className="dots-loader" />
            <span>{tr('Frau Müller отвечает…')}</span>
          </div>
        )}

        {microphoneActive && (
          <div className="gamemode-status-indicator user-listening">
            <Mic size={18} className="recording-icon" />
            <span>{tr('Микрофон активен: говорите по-немецки…')}</span>
          </div>
        )}

        <div ref={dialogueEndRef} />
      </main>

      {/* Input & Voice Interaction Area */}
      {isSessionStarted && state.phase !== GamePhase.ENDED && (
        <footer className="gamemode-footer">
          {/* Active Utterance Controls */}
          {microphoneActive && (
            <div className="gamemode-utterance-bar">
              <button
                type="button"
                className="btn-primary gamemode-finish-utterance-btn"
                onClick={handleFinishUtterance}
              >
                <span>{tr('Завершить реплику')}</span>
              </button>
            </div>
          )}

          {/* Real-time draft and editing form */}
          <form className="gamemode-input-form" onSubmit={handleSendMessage}>
            <button
              type="button"
              className={`gamemode-mic-toggle-btn ${microphoneActive ? 'listening' : ''}`}
              onClick={handleToggleMic}
              disabled={inputBlocked}
              title={tr('Включить / остановить микрофон')}
              aria-label={tr('Микрофон')}
            >
              <Mic size={20} />
            </button>

            <textarea
              className="gamemode-textarea"
              rows={2}
              value={state.draft}
              onChange={(e) => dispatch({ type: GameAction.STT_TRANSCRIPT, payload: e.target.value })}
              placeholder={tr('Ваш ответ (распознаётся голосом или вводится текстом)…')}
              disabled={state.phase === GamePhase.AI_THINKING || state.phase === GamePhase.ENDED}
            />

            <button
              type="submit"
              className="btn-primary gamemode-send-btn"
              disabled={!state.draft.trim() || inputBlocked}
              aria-label={tr('Отправить')}
            >
              <Send size={18} />
            </button>
          </form>
        </footer>
      )}

      {/* Session Ended Banner with Prominent Restart Button */}
      {state.phase === GamePhase.ENDED && (
        <div className="gamemode-ended-banner">
          <p className="ended-text">{tr('Разговор завершён.')}</p>
          <button
            type="button"
            className="btn-primary gamemode-restart-btn"
            onClick={handleReset}
          >
            <RotateCcw size={18} />
            <span>{tr('Начать заново')}</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default GameModeV2;
