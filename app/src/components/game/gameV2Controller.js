/**
 * Pure state machine transitions for GameMode V2.
 * Decoupled from React and external browser APIs for reliable testing and deterministic flow.
 */

export const GamePhase = {
  IDLE: 'idle',                     // Not started yet
  STARTING: 'starting',             // Initializing session
  NPC_SPEAKING: 'npc_speaking',     // Frau Müller is talking (TTS playing)
  USER_LISTENING: 'user_listening', // User microphone active (STT listening)
  USER_EDITING: 'user_editing',     // User paused or completed speech, reviewing/editing transcript
  AI_THINKING: 'ai_thinking',       // User message sent, awaiting AI response
  PAUSED: 'paused',                 // User clicked "Pause"
  ENDED: 'ended',                   // Session concluded
};

export const GameAction = {
  START: 'START',
  START_SUCCESS: 'START_SUCCESS',
  TTS_STARTED: 'TTS_STARTED',
  TTS_FINISHED: 'TTS_FINISHED',
  STT_STARTED: 'STT_STARTED',
  STT_TRANSCRIPT: 'STT_TRANSCRIPT',
  FINISH_UTTERANCE: 'FINISH_UTTERANCE', // User manually finished speech, moves to editing/ready to send
  SEND_MESSAGE: 'SEND_MESSAGE',
  AI_SUCCESS: 'AI_SUCCESS',
  AI_FAILURE: 'AI_FAILURE',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  END: 'END',
  RESET: 'RESET',
  ERROR: 'ERROR',
};

export const initialGameState = {
  phase: GamePhase.IDLE,
  sessionId: null,
  history: [],
  transcript: '',
  draft: '',
  error: '',
  voiceAvailable: true,
  isPaused: false,
};

export function gameReducer(state, action) {
  switch (action.type) {
    case GameAction.START:
      return {
        ...state,
        phase: GamePhase.STARTING,
        error: '',
        isPaused: false,
        transcript: '',
        draft: '',
      };

    case GameAction.START_SUCCESS: {
      const { sessionId, greeting, history } = action.payload;
      return {
        ...state,
        sessionId,
        phase: GamePhase.NPC_SPEAKING,
        history: history || [{ role: 'assistant', text: greeting }],
        isPaused: false,
        error: '',
      };
    }

    case GameAction.TTS_STARTED:
      if (state.isPaused || state.phase === GamePhase.ENDED) return state;
      return {
        ...state,
        phase: GamePhase.NPC_SPEAKING,
      };

    case GameAction.TTS_FINISHED:
      // If paused or ended while TTS was running, do not start listening
      if (state.isPaused || state.phase === GamePhase.ENDED) {
        return state;
      }
      return {
        ...state,
        phase: state.voiceAvailable ? GamePhase.USER_LISTENING : GamePhase.USER_EDITING,
      };

    case GameAction.STT_STARTED:
      if (state.isPaused || state.phase === GamePhase.ENDED) return state;
      return {
        ...state,
        phase: GamePhase.USER_LISTENING,
      };

    case GameAction.STT_TRANSCRIPT: {
      const text = action.payload;
      return {
        ...state,
        transcript: text,
        draft: text,
      };
    }

    case GameAction.FINISH_UTTERANCE:
      return {
        ...state,
        phase: GamePhase.USER_EDITING,
      };

    case GameAction.SEND_MESSAGE:
      if (state.phase === GamePhase.ENDED) return state;
      return {
        ...state,
        phase: GamePhase.AI_THINKING,
        error: '',
        transcript: '',
        draft: '',
        history: [
          ...state.history,
          {
            role: 'user',
            text: action.payload.message,
            ...(action.payload.audioUrl ? { audioUrl: action.payload.audioUrl } : {}),
          },
        ],
      };

    case GameAction.AI_SUCCESS: {
      if (state.phase !== GamePhase.AI_THINKING) return state;
      const { reply } = action.payload;
      const nextHistory = [...state.history, reply];
      return {
        ...state,
        phase: state.isPaused ? GamePhase.PAUSED : GamePhase.NPC_SPEAKING,
        history: nextHistory,
      };
    }

    case GameAction.AI_FAILURE:
      if (state.phase !== GamePhase.AI_THINKING) return state;
      return {
        ...state,
        phase: state.isPaused ? GamePhase.PAUSED : GamePhase.USER_EDITING,
        history: state.history.slice(0, -1),
        draft: state.history[state.history.length - 1].text,
        error: action.payload,
      };

    case GameAction.PAUSE:
      return {
        ...state,
        isPaused: true,
        phase: state.phase === GamePhase.AI_THINKING ? GamePhase.AI_THINKING : GamePhase.PAUSED,
      };

    case GameAction.RESUME: {
      // Restore appropriate active phase based on context
      const resumePhase = state.phase === GamePhase.AI_THINKING
        ? GamePhase.AI_THINKING
        : state.draft.trim()
        ? GamePhase.USER_EDITING
        : state.voiceAvailable
          ? GamePhase.USER_LISTENING
          : GamePhase.USER_EDITING;
      return {
        ...state,
        isPaused: false,
        phase: resumePhase,
        error: '',
      };
    }

    case GameAction.END:
      return {
        ...state,
        phase: GamePhase.ENDED,
        isPaused: false,
        sessionId: null,
        history: state.phase === GamePhase.AI_THINKING ? state.history.slice(0, -1) : state.history,
      };

    case GameAction.RESET:
      return {
        ...initialGameState,
      };

    case GameAction.ERROR:
      return {
        ...state,
        error: action.payload,
        phase:
          state.phase === GamePhase.STARTING
            ? GamePhase.IDLE
            : state.phase === GamePhase.AI_THINKING
              ? GamePhase.USER_EDITING
              : state.phase,
      };

    default:
      return state;
  }
}
