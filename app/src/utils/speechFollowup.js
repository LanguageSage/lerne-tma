import { stripMarkdown } from './text.js';
import { studyContent, studySideText, studyTrainer } from './structuredStudyCard.js';

/** Only a short, single-line, unambiguous learner sentence can become a spoken target. */
const asShortPhrase = source => {
  if (!source || /[\r\n]/.test(source)) return null;
  const cleaned = stripMarkdown(source).replace(/\s+/g, ' ').trim();
  if (cleaned.length < 5 || cleaned.length > 180 || cleaned.split(/\s+/).length < 2) return null;
  return cleaned;
};

/** Resolve the answer text; never read a quiz question, instructions or a translation aloud. */
export function getSpeechFollowupTarget(card) {
  if (!card) return null;
  const structured = studyContent(card);
  if (!structured || !['trainer', 'word_bank', 'puzzle'].includes(structured.type)) return null;
  if (structured.type === 'trainer' && studyTrainer(structured.data).gaps.some(gap => gap.answers.length !== 1)) return null;
  return asShortPhrase(studySideText(structured));
}
