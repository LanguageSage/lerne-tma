export function mapPoint(item) {
  const state = item.recomputed_state;
  if (state.diagnostic_status === 'unobserved') return null;
  return { x: 48 + 420 * state.proficiency, y: 278 - 230 * state.confidence };
}
