import { splitImportedCards, parseImportedCardSections, parseBatchCardsText, extractContextMetadata } from './batchCardParser.js';
import { extractCardTextMetadata } from './cardTextMetadata.js';
import { parseExerciseContent } from './exerciseContentParser.js';
import { parseMatchData } from './matchParser.js';
import { parseWordBankData } from './wordBankParser.js';
import { parseFreeTextData } from './freeTextParser.js';
import { parseClozeData } from './clozeParser.js';
import { parseQuizData } from './quizParser.js';

/** Additional strict validation for maintenance; ordinary creation remains permissive. */
export function validateUpdateExercise(card) {
  const exercise = parseExerciseContent(card.front).exercise;
  const errors = [];
  for (const [open, close] of [['[[', ']]'], ['{', '}'], ['<<', '>>']]) {
    const chunks = exercise.split(open);
    if (chunks[0].includes(close) || chunks.slice(1).some(chunk => !chunk.includes(close))
      || chunks.slice(1).some(chunk => chunk.split(close).length !== 2)) errors.push('unclosed_syntax');
  }
  const parsers = {
    match: parseMatchData, word_bank: parseWordBankData, free_text: parseFreeTextData,
    trainer: value => parseClozeData(value, 'trainer'), quiz: parseQuizData
  };
  if (parsers[card.card_type] && !parsers[card.card_type](card)) errors.push('invalid_exercise');
  if (['match', 'word_bank', 'free_text', 'puzzle'].includes(card.card_type)
    && !exercise.replace(/@(match|wordbank|free|puzzle)\b/i, '').trim()) errors.push('invalid_exercise');
  return [...new Set(errors)];
}

/** Metadata extraction + the existing Lerne parsers, with every rejected block reported. */
export function parseCardTextUpdate(rawText) {
  const blocks = splitImportedCards(rawText);
  const cards = [];
  const errors = [];
  const identifiers = new Map();
  blocks.forEach((block, index) => {
    // Export folder headings/notes for an empty deck are not cards.
    if (block.split('\n').every(line => !line.trim() || line.trim().startsWith('#'))) return;
    const metadata = extractCardTextMetadata(block);
    const blockErrors = [...metadata.errors];
    const sections = parseImportedCardSections(metadata.content);
    // Duplicate section markers are ambiguous; use the importer's own recognition.
    const sectionNames = block.split('\n').map(line => /^\s*(FRONT|BACK|CONTEXT)\s*:/i.exec(line)?.[1]?.toUpperCase()).filter(Boolean);
    if (new Set(sectionNames).size !== sectionNames.length) blockErrors.push('duplicate_section');
    if (!sections || sectionNames.join(',') !== 'FRONT,BACK,CONTEXT') blockErrors.push('invalid_sections');
    if (metadata.card_id) {
      if (identifiers.has(metadata.card_id)) {
        blockErrors.push('duplicate_card_id');
        errors.push({ number: identifiers.get(metadata.card_id), code: 'duplicate_card_id' });
      } else identifiers.set(metadata.card_id, index + 1);
    }
    if (sections) {
      const parsed = parseBatchCardsText(metadata.content)[0];
      const context = extractContextMetadata(sections.context, { preserveFormatting: true });
      const card = {
        number: index + 1, card_id: metadata.card_id, deck_id: metadata.deck_id,
        front: parsed.front,
        // Maintenance treats an explicitly empty BACK as an intentional value.
        back: sectionNames.includes('BACK') ? sections.back : parsed.back,
        context: context.cleanContext, topics: context.topic || '',
        level: context.level || (metadata.card_id ? null : parsed.level), card_type: parsed.card_type
      };
      blockErrors.push(...validateUpdateExercise(card));
      if (!blockErrors.length) cards.push(card);
    }
    for (const code of new Set(blockErrors)) errors.push({ number: index + 1, code });
  });
  if (!cards.length && !errors.length) errors.push({ number: 0, code: 'empty_file' });
  return { cards, errors, total: blocks.filter(block => !block.split('\n').every(line => !line.trim() || line.trim().startsWith('#'))).length };
}
