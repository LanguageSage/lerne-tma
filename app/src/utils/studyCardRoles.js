export const PHYSICAL_SIDE = Object.freeze({ FRONT: 'front', BACK: 'back' });
export const PEDAGOGICAL_ROLE = Object.freeze({
  PROMPT: 'prompt', ANSWER: 'answer', TRANSLATION: 'translation', EXAMPLE: 'example', DIALOGUE: 'dialogue',
});
export const AUDIO_ROLE = Object.freeze({ ...PEDAGOGICAL_ROLE });

/** Reverse changes role bindings, never the meaning of stored front/back fields. */
export function getStudyRolePhysicalSide(role, studyMode = 'classic') {
  if (role === PEDAGOGICAL_ROLE.PROMPT) return studyMode === 'reverse' ? PHYSICAL_SIDE.BACK : PHYSICAL_SIDE.FRONT;
  if (role === PEDAGOGICAL_ROLE.ANSWER) return studyMode === 'reverse' ? PHYSICAL_SIDE.FRONT : PHYSICAL_SIDE.BACK;
  if (role === PEDAGOGICAL_ROLE.TRANSLATION) return PHYSICAL_SIDE.BACK;
  return null;
}

export function getPhysicalSideText(card, physicalSide) {
  if (physicalSide === PHYSICAL_SIDE.FRONT) return card?.front || card?.front_text || '';
  if (physicalSide === PHYSICAL_SIDE.BACK) return card?.back || card?.back_text || '';
  return '';
}

export function getPhysicalSideAudioSource(card, physicalSide) {
  if (physicalSide === PHYSICAL_SIDE.FRONT) return card?.audio_url || card?.audio_path || '';
  if (physicalSide === PHYSICAL_SIDE.BACK) return card?.audio_back_url || card?.audio_back_path || '';
  return '';
}

/** Role bindings may address a legacy side OR an independent recording (e.g. dialogue). */
export function resolveStudyAudio(card, audioRole, { studyMode = 'classic', roleBindings = {} } = {}) {
  const explicit = Object.hasOwn(roleBindings, audioRole);
  const binding = explicit ? roleBindings[audioRole] : null;
  const physicalSide = explicit ? binding?.physicalSide ?? null : getStudyRolePhysicalSide(audioRole, studyMode);
  const source = explicit && !physicalSide
    ? binding?.url || binding?.path || ''
    : getPhysicalSideAudioSource(card, physicalSide);
  return { audioRole, physicalSide, source };
}
