import { tr } from '../i18n/locale.js';
import { classifySentenceFast } from '../services/classifier/index.js';
import { buildCefrMetaFromClassifierResult } from './levelUtils.js';
import { detectExerciseType } from './exerciseDetector.js';
import { parseQuizData } from './quizParser.js';

/**
 * Automatically detects the card type based on content markers and syntax.
 */
export function detectCardTypeByContent(front = '') {
  if (!front) return 'standard';
  return detectExerciseType({ front }) || 'standard';
}

/**
 * Parses batch text into structured cards.
 * Supports:
 * 1. Dedicated Exercise Blocks:
 *    @@CARD [trainer|quiz|puzzle|match|free_text|word_bank|standard]
 *    FRONT: ...
 *    BACK: ...
 *    CONTEXT: ...
 *    TAGS: ...
 *    @@END
 * 2. Delimiter-separated cards ('---') with auto-detection:
 *    - @match -> matching pairs
 *    - @free -> free text writing
 *    - @puzzle -> word/sentence puzzle
 *    - {...} or [[...]] -> trainer cloze
 *    - Multiple choice with * -> quiz
 *    - Front / Back lines -> standard
 */
export function parseBatchCardsText(rawText) {
  if (!rawText || !rawText.trim()) return [];

  const parsedCards = [];

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Dedicated @@CARD ... @@END format
  // ─────────────────────────────────────────────────────────────────────────────
  if (rawText.includes('@@CARD')) {
    const cardBlockRegex = /@@CARD(?:[ \t]+([a-zA-Z0-9_-]+))?(?:[ \t]*\r?\n)([\s\S]*?)(?:@@END|(?=@@CARD)|$)/gi;
    const matches = Array.from(rawText.matchAll(cardBlockRegex));

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const explicitType = (match[1] || '').trim().toLowerCase();
      const body = (match[2] || '').trim();

      if (!body) continue;

      let front = '';
      let back = '';
      let context = '';
      let tags = '';

      // Parse FRONT:, BACK:, CONTEXT:, TAGS: sections
      const sectionRegex = /(?:^|\n)\s*(FRONT|BACK|CONTEXT|TAGS)\s*:\s*([\s\S]*?)(?=(?:\n\s*(?:FRONT|BACK|CONTEXT|TAGS)\s*:)|$)/gi;
      const sectionMatches = Array.from(body.matchAll(sectionRegex));

      if (sectionMatches.length > 0) {
        for (const sm of sectionMatches) {
          const sName = sm[1].toUpperCase();
          const sVal = sm[2].trim();
          if (sName === 'FRONT') front = sVal;
          else if (sName === 'BACK') back = sVal;
          else if (sName === 'CONTEXT') context = sVal;
          else if (sName === 'TAGS') tags = sVal;
        }
      } else {
        // If no labels, first line/paragraph is front, rest is back
        const parts = body.split(/\n\s*\n/);
        front = parts[0]?.trim() || '';
        back = parts.slice(1).join('\n\n').trim();
      }

      if (!front) continue;

      const validTypes = ['trainer', 'quiz', 'puzzle', 'match', 'free_text', 'word_bank', 'standard'];
      const card_type = validTypes.includes(explicitType)
        ? explicitType
        : detectCardTypeByContent(front);

      // Auto-extract back for trainer if empty
      if (!back && card_type === 'trainer') {
        const clozeRegex = /(?:\[\[([^\]]+)\]\]|\{([^}]+)\})/g;
        const answers = Array.from(front.matchAll(clozeRegex)).map(m => {
          const inner = (m[1] || m[2] || '').trim();
          if (m[1]) return inner; // [[input]]
          const opts = inner.split(/[|;,/]/).map(o => o.trim()).filter(Boolean);
          const stars = opts.filter(o => o.startsWith('*'));
          if (stars.length > 0) {
            return stars.map(s => s.replace(/^\*/, '').trim()).join(' / ');
          }
          return opts[0] ? opts[0].replace(/^\*/, '').trim() : '';
        });
        if (answers.length > 0) {
          back = answers.join(', ');
        }
      }

      const res = classifySentenceFast(front, 'de');
      const level = res.level || 'A1';

      parsedCards.push({
        id: `temp_${Date.now()}_${i}`,
        front,
        front_text: front,
        back,
        back_text: back,
        context,
        tags: tags || level,
        card_type,
        level,
        reason: res.reason,
        reason_short: res.reason_short,
        cefr: buildCefrMetaFromClassifierResult({ ...res, level }, 'local')
      });
    }

    if (parsedCards.length > 0) {
      return parsedCards;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Legacy / Quick '---' format with unified central auto-detection
  // ─────────────────────────────────────────────────────────────────────────────
  let blocks = rawText
    .split(/\n\s*[-—_]{3,}\s*(?:\n|$)/)
    .map(b => b.trim())
    .filter(Boolean);

  if (blocks.length <= 1 && !rawText.includes('---')) {
    const candidateBlocks = rawText.split(/\n{3,}/).map(b => b.trim()).filter(Boolean);
    if (candidateBlocks.length > 1) {
      blocks = candidateBlocks;
    }
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].trim();
    if (!block) continue;

    const detectedType = detectCardTypeByContent(block);

    // A. Match exercise (@match)
    if (detectedType === 'match') {
      const res = classifySentenceFast(block, 'de');
      const level = res.level || 'B1';
      parsedCards.push({
        id: `temp_${Date.now()}_${i}`,
        front: block,
        front_text: block,
        back: tr("Сопоставление пар"),
        back_text: tr("Сопоставление пар"),
        context: '',
        card_type: 'match',
        level,
        reason: res.reason,
        reason_short: res.reason_short,
        cefr: buildCefrMetaFromClassifierResult({ ...res, level }, 'local'),
        tags: level
      });
      continue;
    }

    // B. Free text exercise (@free)
    if (detectedType === 'free_text') {
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
      const front = lines[0] === '@free' ? lines.slice(0, 2).join('\n') : lines[0];
      const back = lines.slice(lines[0] === '@free' ? 2 : 1).join('\n');
      const res = classifySentenceFast(front, 'de');
      const level = res.level || 'B1';
      parsedCards.push({
        id: `temp_${Date.now()}_${i}`,
        front,
        front_text: front,
        back,
        back_text: back,
        context: '',
        card_type: 'free_text',
        level,
        reason: res.reason,
        reason_short: res.reason_short,
        cefr: buildCefrMetaFromClassifierResult({ ...res, level }, 'local'),
        tags: level
      });
      continue;
    }

    // C. Puzzle exercise (@puzzle)
    if (detectedType === 'puzzle') {
      // The marker is the content-level source of truth and must survive import.
      const front = block;
      const res = classifySentenceFast(front, 'de');
      const level = res.level || 'A1';
      parsedCards.push({
        id: `temp_${Date.now()}_${i}`,
        front,
        front_text: front,
        back: tr("Конструктор фразы"),
        back_text: tr("Конструктор фразы"),
        context: '',
        card_type: 'puzzle',
        level,
        reason: res.reason,
        reason_short: res.reason_short,
        cefr: buildCefrMetaFromClassifierResult({ ...res, level }, 'local'),
        tags: level
      });
      continue;
    }

    // D. Trainer Card: Cloze braces {...} or brackets [[...]]
    if (detectedType === 'trainer') {
      const clozeRegex = /(?:\[\[([^\]]+)\]\]|\{([^}]+)\})/g;
      const clozeMatches = Array.from(block.matchAll(clozeRegex));
      let extractedAnswer = '';
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
        extractedAnswer = answers.join(', ');
      }

      const res = classifySentenceFast(block, 'de');
      const level = res.level || 'A1';
      parsedCards.push({
        id: `temp_${Date.now()}_${i}`,
        front: block,
        front_text: block,
        back: extractedAnswer,
        back_text: extractedAnswer,
        context: '',
        card_type: 'trainer',
        level,
        reason: res.reason,
        reason_short: res.reason_short,
        cefr: buildCefrMetaFromClassifierResult({ ...res, level }, 'local'),
        tags: level
      });
      continue;
    }

    // E. Quiz Card: Multiple choices with * marker
    if (detectedType === 'quiz') {
      const quizData = parseQuizData({ front: block });
      const questionText = quizData?.question || block.split('\n')[0];
      const cleanCorrectAnswer = quizData?.correctAnswerText || tr("Правильный ответ");

      const res = classifySentenceFast(questionText, 'de');
      const level = res.level || 'B1';

      parsedCards.push({
        id: `temp_${Date.now()}_${i}`,
        front: block,
        front_text: block,
        back: cleanCorrectAnswer,
        back_text: cleanCorrectAnswer,
        context: '',
        card_type: 'quiz',
        level,
        reason: res.reason,
        reason_short: res.reason_short,
        cefr: buildCefrMetaFromClassifierResult({ ...res, level }, 'local'),
        tags: level
      });
      continue;
    }

    // F. Standard Card: Front / Back
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length >= 2) {
      const front = lines[0];
      const back = lines.slice(1).join('\n');
      const res = classifySentenceFast(front, 'de');
      const level = res.level || 'A1';
      parsedCards.push({
        id: `temp_${Date.now()}_${i}`,
        front,
        front_text: front,
        back,
        back_text: back,
        context: '',
        card_type: 'standard',
        level,
        reason: res.reason,
        reason_short: res.reason_short,
        cefr: buildCefrMetaFromClassifierResult({ ...res, level }, 'local'),
        tags: level
      });
    } else if (lines.length === 1) {
      const line = lines[0];
      let front = line;
      let back = '';
      if (line.includes(' = ')) {
        [front, back] = line.split(' = ');
      } else if (line.includes(' — ')) {
        [front, back] = line.split(' — ');
      } else if (line.includes('\t')) {
        [front, back] = line.split('\t');
      } else if (line.includes(';') && !line.includes('&')) {
        [front, back] = line.split(';');
      }
      const res = classifySentenceFast(front, 'de');
      const level = res.level || 'A1';
      parsedCards.push({
        id: `temp_${Date.now()}_${i}`,
        front: front.trim(),
        front_text: front.trim(),
        back: back.trim(),
        back_text: back.trim(),
        context: '',
        card_type: 'standard',
        level,
        reason: res.reason,
        reason_short: res.reason_short,
        cefr: buildCefrMetaFromClassifierResult({ ...res, level }, 'local'),
        tags: level
      });
    }
  }

  return parsedCards;
}
