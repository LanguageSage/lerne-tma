import { detectExerciseType } from './exerciseDetector.js';
import { parseExerciseContent } from './exerciseContentParser.js';
import { parseWordBankData } from './wordBankParser.js';
import { parseClozeData } from './clozeParser.js';
import { stripMarkdown } from './text.js';
import { studyContent, studySideText, studyTrainer } from './structuredStudyCard.js';

/** Only a short, single-line, unambiguous learner sentence can become a spoken target. */
const asShortPhrase = (source, legacy = true) => {
  if (!source || /[\r\n]/.test(source)) return null;
  const cleaned = stripMarkdown(source).replace(/\s+/g, ' ').trim();
  if (cleaned.length < 5 || cleaned.length > 180 || cleaned.split(/\s+/).length < 2) return null;
  if (legacy && /@(?:puzzle|wordbank|options|match|free)\b|<<|>>|\[\[|\]\]|\{[^}]*\}/i.test(cleaned)) return null;
  return cleaned;
};

/** Resolve the answer text; never read a quiz question, instructions or a translation aloud. */
export function getSpeechFollowupTarget(card, studyMode = 'classic') {
  if (!card) return null;
  const structured = studyContent(card);
  if (structured) {
    if (structured.type === 'trainer' && studyTrainer(structured.data).gaps.some(gap => gap.answers.length !== 1)) return null;
    if (!['trainer', 'word_bank', 'puzzle'].includes(structured.type)) return null;
    return asShortPhrase(studySideText(structured), false);
  }
  const exercise = parseExerciseContent(card.front || card.front_text || '').exercise.trim();
  const type = detectExerciseType(card, studyMode);
  if (type === 'puzzle') {
    // Only authored puzzles: synthetic puzzle mode is not a guaranteed correct sentence.
    if (!/^@puzzle[ \t]*\n/i.test(exercise)) return null;
    return asShortPhrase(exercise.replace(/^@puzzle[ \t]*\n/i, '').trim());
  }
  if (type === 'trainer') {
    if (!/\[\[[^\]]+\]\]|\{[^}]+\}/.test(exercise)) return null;
    const data = parseClozeData(card, studyMode);
    if (!data?.gaps?.length || data.gaps.some(gap => !gap.correctAnswer || /[|;,/]/.test(gap.correctAnswer))) return null;
    const complete = data.maskedText.replace(/___GAP_(\d+)___/g,
      (match, id) => data.gaps[Number(id)]?.correctAnswer ?? match);
    return asShortPhrase(complete);
  }
  if (type === 'word_bank') {
    const data = parseWordBankData(card);
    if (!data) return null;
    const gapById = new Map(data.gaps.map(gap => [gap.id, gap.correctAnswer]));
    const complete = data.text.replace(/<<([a-zA-Z0-9_-]+)>>/g, (match, id) => gapById.get(id) ?? match);
    return asShortPhrase(complete);
  }
  // match, free-text and quiz require authored speech targets or semantic evaluation.
  return null;
}
