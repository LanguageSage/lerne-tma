import { tr } from '../i18n/locale.js';
import { classifySentenceFast } from '../services/classifier/index.js';
import { buildCefrMetaFromClassifierResult } from './levelUtils.js';
import { detectExerciseType } from './exerciseDetector.js';

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
 *    @@CARD [trainer|quiz|puzzle|match|free_text|standard]
 *    FRONT: ...
 *    BACK: ...
 *    CONTEXT: ...
 *    TAGS: ...
 *    @@END
 * 2. Delimiter-separated cards ('---') with auto-detection:
 *    - @match -> matching pairs
 *    - @free -> free text writing
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

      const validTypes = ['trainer', 'quiz', 'puzzle', 'match', 'free_text', 'standard'];
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
          const star = opts.find(o => o.startsWith('*'));
          return star ? star.substring(1).trim() : (opts[0] || '');
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
  // 2. Legacy / Quick '---' format with advanced auto-detection
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

    // A. Match exercise (@match)
    if (/^@match\b/i.test(block) || /\n@match\b/i.test(block)) {
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
    if (/^@free\b/i.test(block) || /\n@free\b/i.test(block)) {
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

    // C. Trainer Card: Cloze braces {...} or brackets [[...]] or [...]
    const clozeRegex = /(?:\[\[([^\]]+)\]\]|\{([^}]+)\}|\[([^\]]+)\](?!\())/g;
    if (clozeRegex.test(block)) {
      const clozeMatches = Array.from(block.matchAll(clozeRegex));
      let extractedAnswer = '';
      if (clozeMatches.length > 0) {
        const answers = clozeMatches.map(m => {
          if (m[1]) return m[1].trim(); // [[input]]
          const opts = (m[2] || m[3] || '').split(/[|;,/]/).map(o => o.trim()).filter(Boolean);
          const star = opts.find(o => o.startsWith('*'));
          return star ? star.substring(1).trim() : (opts[0] || '');
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

    // D. Quiz Card: Multiple choices with * marker
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    const starLine = lines.find(l => /^\*|\s*\*|\*$/i.test(l) || /^\[\*\]/i.test(l));

    if (lines.length >= 2 && starLine) {
      let questionText = '';
      let optionLines = [];

      if (block.includes('\n\n')) {
        const parts = block.split(/\n\s*\n/);
        questionText = parts[0].trim();
        optionLines = parts.slice(1).join('\n\n').split('\n').map(l => l.trim()).filter(Boolean);
      } else {
        let firstOptionIdx = -1;
        for (let j = 0; j < lines.length; j++) {
          const l = lines[j];
          if (/^[-*○•]/u.test(l) || /^\[[*xX ]\]/i.test(l) || /^[a-zA-Z0-9]+[).]\s/.test(l)) {
            firstOptionIdx = j;
            break;
          }
        }

        if (firstOptionIdx > 0) {
          questionText = lines.slice(0, firstOptionIdx).join('\n').trim();
          optionLines = lines.slice(firstOptionIdx);
        } else {
          questionText = lines[0];
          optionLines = lines.slice(1);
        }
      }

      // Clean correct answer text
      const cleanCorrectAnswer = (starLine || '')
        .replace(/^\[[*xX ]\]\s*/i, '')
        .replace(/^[-*○•\s]+/u, '')
        .replace(/^([a-zA-Z0-9]+[).])\s*/, '')
        .replace(/^[-*○•\s]+/u, '')
        .replace(/\*$/, '')
        .trim();

      const formattedFront = `${questionText}\n\n${optionLines.join('\n')}`;
      const res = classifySentenceFast(questionText, 'de');
      const level = res.level || 'B1';

      parsedCards.push({
        id: `temp_${Date.now()}_${i}`,
        front: formattedFront,
        front_text: formattedFront,
        back: cleanCorrectAnswer || tr("Правильный ответ"),
        back_text: cleanCorrectAnswer || tr("Правильный ответ"),
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

    // E. Standard Card: Front / Back
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
