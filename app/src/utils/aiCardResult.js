export const resolveAiTranslation = (currentBack, generatedBack, actionType) => {
  const existingTranslation = currentBack || '';
  if (actionType === 'explain_rule' && generatedBack) {
    return generatedBack;
  }
  if (actionType !== 'explain_rule' || String(existingTranslation).trim()) {
    return existingTranslation;
  }
  return generatedBack || existingTranslation;
};
