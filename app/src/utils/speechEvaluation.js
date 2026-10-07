import { normalizeSpeechText } from './text.js';

/** Existing word-overlap evaluator, independent of study mode and React/microphone state. */
export function evaluateStudySpeech({ transcript, targetText, language = 'de', threshold = 75 }) {
  const cleanTranscript = normalizeSpeechText(transcript, language);
  const cleanOriginal = normalizeSpeechText(targetText, language);
  if (!cleanTranscript || !cleanOriginal) return { success: false, matchRatio: 0 };
  const originalWords = cleanOriginal.split(/\s+/).filter(Boolean);
  const transcriptWords = cleanTranscript.split(/\s+/).filter(Boolean);
  const matchCount = originalWords.filter(word => transcriptWords.includes(word)).length;
  const matchRatio = matchCount / originalWords.length;
  const ratioMatched = matchRatio * 100 >= threshold;
  const exactMatched = cleanTranscript === cleanOriginal;
  const extraSpokenMatched = cleanTranscript.includes(cleanOriginal) && originalWords.length / transcriptWords.length >= 0.6;
  const fragmentMatched = cleanOriginal.includes(cleanTranscript) && ratioMatched;
  return { success: ratioMatched || exactMatched || extraSpokenMatched || fragmentMatched, matchRatio };
}
