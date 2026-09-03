import { classifySentenceFast } from '../services/classifier/index.js';
import { buildCefrMetaFromClassifierResult } from './levelUtils.js';

/**
 * Parses batch text formatted with '---' or newlines into structured cards.
 * Supports:
 * 1. Quiz / Exam multiple-choice blocks (with * on correct choice)
 * 2. Trainer cloze blocks (with {...})
 * 3. Standard text cards (front / back)
 */
export function parseBatchCardsText(rawText) {
  if (!rawText || !rawText.trim()) return [];

  // Split blocks by delimiter '---' (with optional whitespace or newlines)
  let blocks = rawText
    .split(/\n\s*[-—_]{3,}\s*(?:\n|$)/)
    .map(b => b.trim())
    .filter(Boolean);

  // If no '---' found, but text contains multiple blocks separated by 2+ empty lines
  if (blocks.length <= 1 && !rawText.includes('---')) {
    const candidateBlocks = rawText.split(/\n{3,}/).map(b => b.trim()).filter(Boolean);
    if (candidateBlocks.length > 1) {
      blocks = candidateBlocks;
    }
  }

  const parsedCards = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].trim();
    if (!block) continue;

    // ── 1. Trainer Card: Cloze braces {...} ─────────────────────────────────
    if (/\{([^}]+)\}/.test(block)) {
      const clozeMatches = Array.from(block.matchAll(/\{([^}]+)\}/g)).map(m => m[1]);
      let extractedAnswer = '';
      if (clozeMatches.length > 0) {
        const answers = clozeMatches.map(m => {
          const opts = m.split(/[|;,/]/).map(o => o.trim()).filter(Boolean);
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

    // ── 2. Quiz Card: Multiple choices with * marker ─────────────────────────
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
        back: cleanCorrectAnswer || 'Правильный ответ',
        back_text: cleanCorrectAnswer || 'Правильный ответ',
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

    // ── 3. Standard Card: Front / Back or Single line with separator ────────
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
