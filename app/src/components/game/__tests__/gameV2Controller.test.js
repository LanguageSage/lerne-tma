import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GamePhase,
  GameAction,
  initialGameState,
  gameReducer,
} from '../gameV2Controller.js';

test('GameMode V2 Controller: start -> greeting -> user answer -> Frau Müller reply', () => {
  // 1. Initial
  let state = initialGameState;
  assert.equal(state.phase, GamePhase.IDLE);

  // 2. Start
  state = gameReducer(state, { type: GameAction.START });
  assert.equal(state.phase, GamePhase.STARTING);

  // 3. Start success with Frau Müller greeting
  const greeting = 'Guten Tag! Ich bin Frau Müller, Ihre Nachbarin. Sind Sie gerade eingezogen?';
  state = gameReducer(state, {
    type: GameAction.START_SUCCESS,
    payload: {
      sessionId: 'test-session-123',
      greeting,
      history: [{ role: 'assistant', text: greeting }],
    },
  });
  assert.equal(state.phase, GamePhase.NPC_SPEAKING);
  assert.equal(state.sessionId, 'test-session-123');
  assert.equal(state.history.length, 1);

  // 4. TTS finishes playing Frau Müller's greeting -> user microphone turns on
  state = gameReducer(state, { type: GameAction.TTS_FINISHED });
  assert.equal(state.phase, GamePhase.USER_LISTENING);

  // 5. STT captures incoming transcript
  state = gameReducer(state, {
    type: GameAction.STT_TRANSCRIPT,
    payload: 'Ja, guten Tag! Ich heiße Alex.',
  });
  assert.equal(state.draft, 'Ja, guten Tag! Ich heiße Alex.');

  // 6. User manually finishes utterance (separating finish from send)
  state = gameReducer(state, { type: GameAction.FINISH_UTTERANCE });
  assert.equal(state.phase, GamePhase.USER_EDITING);
  assert.equal(state.draft, 'Ja, guten Tag! Ich heiße Alex.');

  // 7. Send message to AI
  state = gameReducer(state, {
    type: GameAction.SEND_MESSAGE,
    payload: { message: 'Ja, guten Tag! Ich heiße Alex.' },
  });
  assert.equal(state.phase, GamePhase.AI_THINKING);
  assert.equal(state.history.length, 2);
  assert.equal(state.history[1].text, 'Ja, guten Tag! Ich heiße Alex.');

  // 8. Frau Müller AI responds -> triggers NPC_SPEAKING
  const reply = { role: 'assistant', text: 'Freut mich, Alex! Willkommen im Haus.' };
  state = gameReducer(state, {
    type: GameAction.AI_SUCCESS,
    payload: { reply },
  });
  assert.equal(state.phase, GamePhase.NPC_SPEAKING);
  assert.equal(state.history.length, 3);
  assert.equal(state.history[2].text, reply.text);
});

test('GameMode V2 Controller: Start -> End stops all cycles and blocks sends', () => {
  let state = gameReducer(initialGameState, { type: GameAction.START });
  state = gameReducer(state, {
    type: GameAction.START_SUCCESS,
    payload: { sessionId: 'sess-1', greeting: 'Hallo', history: [] },
  });
  assert.equal(state.phase, GamePhase.NPC_SPEAKING);

  // End clicked
  state = gameReducer(state, { type: GameAction.END });
  assert.equal(state.phase, GamePhase.ENDED);

  // Late TTS_FINISHED or STT_STARTED must NOT re-activate microphone
  state = gameReducer(state, { type: GameAction.TTS_FINISHED });
  assert.equal(state.phase, GamePhase.ENDED);

  state = gameReducer(state, { type: GameAction.STT_STARTED });
  assert.equal(state.phase, GamePhase.ENDED);

  // Late SEND_MESSAGE must be ignored
  state = gameReducer(state, {
    type: GameAction.SEND_MESSAGE,
    payload: { message: 'ignored' },
  });
  assert.equal(state.phase, GamePhase.ENDED);
});

test('GameMode V2 Controller: Pause -> Resume preserves text and state', () => {
  let state = {
    ...initialGameState,
    phase: GamePhase.USER_LISTENING,
    draft: 'Ich habe eine Frage',
    transcript: 'Ich habe eine Frage',
  };

  // User pauses during listening
  state = gameReducer(state, { type: GameAction.PAUSE });
  assert.equal(state.phase, GamePhase.PAUSED);
  assert.equal(state.isPaused, true);
  assert.equal(state.draft, 'Ich habe eine Frage');

  // Resume returns to editing since text exists
  state = gameReducer(state, { type: GameAction.RESUME });
  assert.equal(state.phase, GamePhase.USER_EDITING);
  assert.equal(state.isPaused, false);
  assert.equal(state.draft, 'Ich habe eine Frage');
});

test('GameMode V2 Controller: Pause during TTS prevents mic auto-start when TTS ends', () => {
  let state = {
    ...initialGameState,
    phase: GamePhase.NPC_SPEAKING,
  };

  // Pause pressed while Frau Müller speaks
  state = gameReducer(state, { type: GameAction.PAUSE });
  assert.equal(state.phase, GamePhase.PAUSED);
  assert.equal(state.isPaused, true);

  // TTS completes in background
  state = gameReducer(state, { type: GameAction.TTS_FINISHED });
  assert.equal(state.phase, GamePhase.PAUSED); // remains paused!
  assert.notEqual(state.phase, GamePhase.USER_LISTENING);
});

test('GameMode V2 Controller: Fallback when voice is unavailable', () => {
  let state = {
    ...initialGameState,
    voiceAvailable: false,
    phase: GamePhase.NPC_SPEAKING,
  };

  // When TTS finishes and voice is unavailable, goes directly to user_editing (text mode)
  state = gameReducer(state, { type: GameAction.TTS_FINISHED });
  assert.equal(state.phase, GamePhase.USER_EDITING);
});

test('GameMode V2 Controller: Error during AI_THINKING recovers to USER_EDITING without hanging', () => {
  let state = {
    ...initialGameState,
    phase: GamePhase.AI_THINKING,
  };
  state = gameReducer(state, {
    type: GameAction.ERROR,
    payload: 'AI response timed out.',
  });
  assert.equal(state.phase, GamePhase.USER_EDITING);
  assert.equal(state.error, 'AI response timed out.');
});

test('GameMode V2 Controller: SEND_MESSAGE attaches recorded user audioUrl if provided', () => {
  let state = {
    ...initialGameState,
    phase: GamePhase.USER_EDITING,
    draft: 'Hallo Frau Müller!',
  };
  state = gameReducer(state, {
    type: GameAction.SEND_MESSAGE,
    payload: {
      message: 'Hallo Frau Müller!',
      audioUrl: 'blob:http://localhost:5173/user-audio-uuid',
    },
  });
  assert.equal(state.phase, GamePhase.AI_THINKING);
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].text, 'Hallo Frau Müller!');
  assert.equal(state.history[0].audioUrl, 'blob:http://localhost:5173/user-audio-uuid');
});

test('GameMode V2 Controller: pause and retry preserve one copy of the user turn', () => {
  const greeting = { role: 'assistant', text: 'Guten Tag!' };
  const turn = { message: 'Hallo Frau Müller!' };
  let state = { ...initialGameState, phase: GamePhase.USER_EDITING, history: [greeting] };
  state = gameReducer(state, { type: GameAction.SEND_MESSAGE, payload: turn });
  state = gameReducer(state, { type: GameAction.PAUSE });
  state = gameReducer(state, { type: GameAction.RESUME });
  assert.equal(state.phase, GamePhase.AI_THINKING);

  state = gameReducer(state, { type: GameAction.PAUSE });
  state = gameReducer(state, { type: GameAction.AI_FAILURE, payload: 'Try again' });
  assert.equal(state.phase, GamePhase.PAUSED);
  assert.equal(state.draft, turn.message);
  assert.deepEqual(state.history, [greeting]);

  state = gameReducer(state, { type: GameAction.RESUME });
  state = gameReducer(state, { type: GameAction.SEND_MESSAGE, payload: turn });
  const reply = { role: 'assistant', text: 'Willkommen!' };
  state = gameReducer(state, { type: GameAction.AI_SUCCESS, payload: { reply } });
  assert.deepEqual(state.history, [greeting, { role: 'user', text: turn.message }, reply]);
});
