/** Preserve the saved array and partial-save evidence, including older server envelopes. */
export function normalizeBatchAiResult(data, saving) {
  const saveResult = data?.save_result || (!Array.isArray(data?.saved_cards) ? data?.saved_cards : null);
  const cards = saving
    ? (Array.isArray(data?.saved_cards) ? data.saved_cards : saveResult?.cards)
    : data?.cards;
  if (!Array.isArray(cards)) throw new Error('Invalid AI batch response');
  return { cards, failedCount: saveResult?.failed_count ?? saveResult?.failed?.length ?? 0 };
}
