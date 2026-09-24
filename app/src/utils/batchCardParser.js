import { tr } from '../i18n/locale.js';
import { classifySentenceFast } from '../services/classifier/index.js';
import { buildCefrMetaFromClassifierResult } from './levelUtils.js';
import { detectExerciseType } from './exerciseDetector.js';
import { parseQuizData } from './quizParser.js';
import { parseExerciseContent } from './exerciseContentParser.js';

export const LERNE_CARD_SEPARATOR = '<<<LERNE_CARD>>>';

const isCardSeparatorLine = (line) => {
  return String(line || '').trim() === LERNE_CARD_SEPARATOR;
};

export function hasCardSeparatorLine(rawText) {
  return String(rawText || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .some(isCardSeparatorLine);
}

/**
 * Splits quick-import text into non-empty card blocks using LERNE_CARD_SEPARATOR.
 * The separator is accepted only when it occupies a complete line.
 */
export function splitImportedCards(rawText) {
  const normalizedText = String(rawText || '').replace(/\r\n?/g, '\n');
  const blocks = [];
  let lines = [];

  const addBlock = () => {
    const block = lines.join('\n').trim();
    if (block) blocks.push(block);
    lines = [];
  };

  for (const line of normalizedText.split('\n')) {
    if (isCardSeparatorLine(line)) {
      addBlock();
    } else {
      lines.push(line);
    }
  }
  addBlock();

  return blocks;
}

/**
 * Parses a single imported card block into FRONT, BACK, CONTEXT sections.
 * All three section markers (FRONT:, BACK:, CONTEXT:) must be present.
 * BACK: and CONTEXT: may be empty, but their markers are mandatory.
 * Returns { front, back, context } or null if invalid.
 */
export function parseImportedCardSections(block) {
  if (!block || typeof block !== 'string') return null;

  const normalized = block.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');

  const MARKER_REGEX = /^\s*(FRONT|BACK|CONTEXT)\s*:(.*)$/i;

  const sections = {
    FRONT: [],
    BACK: [],
    CONTEXT: []
  };
  const seenMarkers = new Set();
  let currentSection = null;

  for (const line of lines) {
    const match = MARKER_REGEX.exec(line);
    if (match) {
      const sectionName = match[1].toUpperCase();
      seenMarkers.add(sectionName);
      currentSection = sectionName;
      const inlineContent = match[2];
      if (inlineContent.trim()) {
        sections[currentSection].push(inlineContent.trim());
      }
    } else if (currentSection) {
      sections[currentSection].push(line);
    }
  }

  // The FRONT: marker is strictly required
  if (!seenMarkers.has('FRONT')) {
    return null;
  }

  const front = sections.FRONT.join('\n').trim();
  
  // FRONT cannot be empty
  if (!front) {
    return null;
  }

  const back = seenMarkers.has('BACK') ? sections.BACK.join('\n').trim() : '';
  const context = seenMarkers.has('CONTEXT') ? sections.CONTEXT.join('\n').trim() : '';

  return {
    front,
    back,
    context
  };
}

/**
 * Automatically detects the card type based on content markers and syntax.
 */
export function detectCardTypeByContent(front = '') {
  if (!front) return 'standard';
  return detectExerciseType({ front }) || 'standard';
}

/**
 * Parses batch cards text using strict 3-level architecture:
 * Level 1: parseImportedCardSections(block) -> front, back, context
 * Level 2: parseExerciseContent(front) -> information blocks (task, options, source, example) + exercise
 * Level 3: detectExerciseType(front) -> determines card_type strictly from front
 */
export function parseBatchCardsText(rawText) {
  if (!rawText || !rawText.trim()) return [];

  const blocks = splitImportedCards(rawText);
  const parsedCards = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].trim();
    if (!block) continue;

    // Level 1: Structure of the card
    const sections = parseImportedCardSections(block);
    if (!sections) continue;

    const { front, back, context } = sections;

    // Level 2: Structure of FRONT
    const parsedExercise = parseExerciseContent(front);
    const cleanSentenceForLevel = parsedExercise.exercise || front;

    // Level 3: Exercise syntax & type detection (strictly from front)
    const detectedType = detectExerciseType(front) || 'standard';

    let finalBack = back;

    if (detectedType === 'match') {
      if (!finalBack) finalBack = tr("Сопоставление пар");
    } else if (detectedType === 'puzzle') {
      if (!finalBack) finalBack = tr("Конструктор фразы");
    } else if (detectedType === 'trainer') {
      // Auto-extract back from cloze gaps if back is left empty
      if (!finalBack) {
        const clozeRegex = /(?:\[\[([^\]]+)\]\]|\{([^}]+)\})/g;
        const exerciseText = parsedExercise.exercise || front;
        const clozeMatches = Array.from(exerciseText.matchAll(clozeRegex));
        if (clozeMatches.length > 0) {
          const answers = clozeMatches.map(m => {
            if (m[1]) return m[1].trim(); // [[input]]
            const opts = (m[2] || '').split(/[|;,/]/).map(o => o.trim()).filter(Boolean);
            const stars = opts.filter(o => o.startsWith('*'));
            if (stars.length > 0) {
              return stars.map(s => s.replace(/^\*/, '').trim()).join(' / ');
            }
            return opts[0] ? opts[0].replace(/^\*/, '').trim() : '';
          });
          finalBack = answers.join(', ');
        }
      }
    } else if (detectedType === 'quiz') {
      // Auto-extract correct answer if back is left empty
      if (!finalBack) {
        const quizData = parseQuizData({ front });
        finalBack = quizData?.correctAnswerText || tr("Правильный ответ");
      }
    }

    const res = classifySentenceFast(cleanSentenceForLevel, 'de');
    const defaultLevel = (detectedType === 'match' || detectedType === 'free_text' || detectedType === 'quiz' || detectedType === 'word_bank')
      ? 'B1'
      : 'A1';
    const level = res.level || defaultLevel;

    parsedCards.push({
      id: `temp_${Date.now()}_${i}`,
      front,
      front_text: front,
      back: finalBack,
      back_text: finalBack,
      context,
      card_type: detectedType,
      level,
      reason: res.reason,
      reason_short: res.reason_short,
      cefr: buildCefrMetaFromClassifierResult({ ...res, level }, 'local'),
      tags: level
    });
  }

  return parsedCards;
}
