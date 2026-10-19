import axios from 'axios';

// A local visitor ID groups test conversations; it is not an account or a session.
export const gameStorage = {
  get: key => { try { return localStorage.getItem(key); } catch { return null; } },
  set: (key, value) => { try { localStorage.setItem(key, value); } catch { /* this visit still works */ } },
};
const savedId = Number(gameStorage.get('lerne_game_visitor_id'));
const random = crypto.getRandomValues(new Uint32Array(2));
export const gameVisitorId = Number.isSafeInteger(savedId) && savedId < 0
  ? savedId : -(1 + (random[0] & 0xffff) * 0x100000000 + random[1]);
gameStorage.set('lerne_game_visitor_id', String(gameVisitorId));

export const gameApi = axios.create({
  baseURL: '/api', timeout: 30000,
  headers: { 'X-User-ID': String(gameVisitorId) },
});
export const gameService = {
  scene: () => gameApi.get('/game/scene').then(({ data }) => data),
  start: (id, options = {}) => gameApi.post('/game/attempts', { attempt_id: id, ...options }).then(({ data }) => data),
  load: id => gameApi.get(`/game/attempts/${id}`).then(({ data }) => data),
  examAttempts: () => gameApi.get('/game/exam-attempts').then(({ data }) => data),
  turn: (id, request) => gameApi.post(`/game/attempts/${id}/turns`, request, { timeout: 35000 }).then(({ data }) => data),
};
