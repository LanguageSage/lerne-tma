const BLOCK_TYPES = new Set(['task', 'options', 'context', 'example']);
const MARKER_TO_BLOCK_TYPE = Object.freeze({
  task: 'task',
  options: 'options',
  source: 'context',
  example: 'example'
});

const normalizeLineEndings = (value) => String(value ?? '').replace(/\r\n?/g, '\n');

const isExerciseMarker = (line) => /^\s*::exercise\s*$/i.test(line || '');

const getBlockType = (line) => {
  const match = /^\s*::(task|options|source|example)\s*$/i.exec(line || '');
  const type = MARKER_TO_BLOCK_TYPE[match?.[1]?.toLowerCase()];
  return BLOCK_TYPES.has(type) ? type : null;
};

const markerForBlockType = (type) => `::${type === 'context' ? 'source' : type}`;

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
 * Supported markers:
 * - ::task -> task instructions
 * - ::source / ::context -> background text / context
 * - ::options -> answer choices
 * - ::example -> examples (can appear multiple times)
 * - ::exercise -> explicit start of the exercise body (optional)
 *
 * When ::exercise is present, all lines up to ::exercise belong to preamble blocks,
 * allowing multi-paragraph sources with blank lines. When ::exercise is omitted,
 * a blank line followed by non-marker text marks the boundary.
 */
export const parseExerciseContent = (rawText) => {
  const raw = normalizeLineEndings(rawText);
  if (!raw.trim()) return emptyResult(raw);

  const lines = raw.split('\n');
  let firstNonEmpty = 0;
  while (firstNonEmpty < lines.length && !lines[firstNonEmpty].trim()) firstNonEmpty += 1;
  if (firstNonEmpty >= lines.length || !getBlockType(lines[firstNonEmpty])) {
    return emptyResult(raw);
  }

  const explicitExerciseIdx = lines.findIndex(isExerciseMarker);
  const blocks = [];
  let exerciseStart = lines.length;
  let index = firstNonEmpty;

  if (explicitExerciseIdx !== -1 && explicitExerciseIdx >= firstNonEmpty) {
    // Mode A: Explicit ::exercise marker present
    while (index < explicitExerciseIdx) {
      if (!lines[index].trim()) {
        index += 1;
        continue;
      }

      const type = getBlockType(lines[index]);
      if (!type) {
        index += 1;
        continue;
      }

      const marker = markerForBlockType(type);
      index += 1;
      const contentLines = [];

      while (index < explicitExerciseIdx) {
        if (getBlockType(lines[index])) break;
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

    exerciseStart = explicitExerciseIdx + 1;
  } else {
    // Mode B: Implicit boundary (no ::exercise marker)
    let finishedPreamble = false;

    while (index < lines.length && !finishedPreamble) {
      const type = getBlockType(lines[index]);
      if (!type) {
        exerciseStart = index;
        break;
      }

      const marker = markerForBlockType(type);
      index += 1;
      const contentLines = [];

      while (index < lines.length) {
        if (isExerciseMarker(lines[index])) {
          exerciseStart = index + 1;
          finishedPreamble = true;
          break;
        }

        const nextType = getBlockType(lines[index]);
        if (nextType) break;

        if (!lines[index].trim()) {
          let nextIndex = index;
          while (nextIndex < lines.length && !lines[nextIndex].trim()) nextIndex += 1;
          if (nextIndex < lines.length && isExerciseMarker(lines[nextIndex])) {
            exerciseStart = nextIndex + 1;
            finishedPreamble = true;
            break;
          }
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
  }

  // Slice exercise and ensure any accidental leading ::exercise marker is removed
  let rawExerciseLines = lines.slice(exerciseStart);
  while (rawExerciseLines.length > 0 && isExerciseMarker(rawExerciseLines[0])) {
    rawExerciseLines = rawExerciseLines.slice(1);
  }
  const exercise = rawExerciseLines.join('\n').trim();
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
  const hasSource = Boolean(parsedContent?.context);
  const hasExerciseMarker = /^\s*::exercise\s*$/im.test(preamble);
  if (hasSource && !hasExerciseMarker) {
    return exercise ? `${preamble}\n\n::exercise\n${exercise}` : `${preamble}\n\n::exercise`;
  }
  return exercise ? `${preamble}\n\n${exercise}` : preamble;
};
