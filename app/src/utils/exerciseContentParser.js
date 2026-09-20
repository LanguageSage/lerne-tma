const BLOCK_TYPES = new Set(['task', 'options', 'context', 'example']);

const normalizeLineEndings = (value) => String(value ?? '').replace(/\r\n?/g, '\n');

const getBlockType = (line) => {
  const match = /^\s*::(task|options|context|example)\s*$/i.exec(line || '');
  const type = match?.[1]?.toLowerCase();
  return BLOCK_TYPES.has(type) ? type : null;
};

const emptyResult = (raw) => ({
  task: '',
  options: [],
  context: '',
  examples: [],
  blocks: [],
  exercise: raw.trim(),
  rawPreamble: '',
  hasBlocks: false
});

/**
 * Parse leading visual information blocks without touching the stored card text.
 *
 * Each marker owns the following non-empty lines. A blank line ends that block:
 * another known marker continues the preamble, while any other line starts the
 * exercise. This keeps the last block boundary deterministic without guessing
 * from cloze, quiz, or puzzle syntax.
 */
export const parseExerciseContent = (rawText) => {
  const raw = normalizeLineEndings(rawText);
  if (!raw.trim()) return emptyResult(raw);

  const lines = raw.split('\n');
  let index = 0;
  while (index < lines.length && !lines[index].trim()) index += 1;
  if (!getBlockType(lines[index])) return emptyResult(raw);

  const blocks = [];
  let exerciseStart = lines.length;
  let finishedPreamble = false;

  while (index < lines.length && !finishedPreamble) {
    const type = getBlockType(lines[index]);
    if (!type) {
      exerciseStart = index;
      break;
    }

    const marker = `::${type}`;
    index += 1;
    const contentLines = [];

    while (index < lines.length) {
      const nextType = getBlockType(lines[index]);
      if (nextType) break;

      if (!lines[index].trim()) {
        let nextIndex = index;
        while (nextIndex < lines.length && !lines[nextIndex].trim()) nextIndex += 1;
        if (nextIndex < lines.length && getBlockType(lines[nextIndex])) {
          index = nextIndex;
        } else {
          exerciseStart = nextIndex;
          finishedPreamble = true;
        }
        break;
      }

      contentLines.push(lines[index]);
      index += 1;
    }

    const content = contentLines.join('\n').trim();
    const block = { type, marker, content };
    if (type === 'options') {
      block.options = content
        .split(/\s*\|\s*|\n+/)
        .map(value => value.trim())
        .filter(Boolean);
    }
    blocks.push(block);
  }

  const exercise = lines.slice(exerciseStart).join('\n').trim();
  const rawPreamble = lines.slice(0, exerciseStart).join('\n').trim();
  const firstContent = (type) => blocks.find(block => block.type === type && block.content)?.content || '';

  return {
    task: firstContent('task'),
    options: blocks.filter(block => block.type === 'options').flatMap(block => block.options || []),
    context: firstContent('context'),
    examples: blocks.filter(block => block.type === 'example' && block.content).map(block => block.content),
    blocks,
    exercise,
    rawPreamble,
    hasBlocks: blocks.length > 0
  };
};

/** Restore the original information preamble around AI-generated exercise text. */
export const restoreExerciseContent = (parsedContent, generatedExercise) => {
  const generated = parseExerciseContent(generatedExercise);
  const exercise = (generated.hasBlocks ? generated.exercise : normalizeLineEndings(generatedExercise)).trim();
  const preamble = parsedContent?.rawPreamble?.trim() || '';
  if (!preamble) return exercise;
  return exercise ? `${preamble}\n\n${exercise}` : preamble;
};

