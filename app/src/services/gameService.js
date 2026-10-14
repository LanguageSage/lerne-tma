import api from './api.js';

export const gameService = {
  scene: () => api.get('/game/scene').then(({ data }) => data),
  start: id => api.post('/game/attempts', { attempt_id: id }).then(({ data }) => data),
  load: id => api.get(`/game/attempts/${id}`).then(({ data }) => data),
  turn: (id, request) => api.post(`/game/attempts/${id}/turns`, request, { timeout: 35000 }).then(({ data }) => data),
};
