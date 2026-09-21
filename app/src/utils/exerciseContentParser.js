const BLOCK_TYPES = new Set(['task', 'options', 'source', 'example']);
const MARKER_TO_BLOCK_TYPE = Object.freeze({
  task: 'task',
  options: 'options',
  source: 'source',
  example: 'example'
});

const normalizeLineEndings = (value) => String(value ?? '').replace(/\r\n?/g, '\n');

const isExerciseMarker = (line) => /^\s*::exercise\s*$/i.test(line || '');

const getBlockType = (line) => {
  const match = /^\s*::(task|options|source|example)\s*$/i.exec(line || '');
  const type = MARKER_TO_BLOCK_TYPE[match?.[1]?.toLowerCase()];
  return BLOCK_TYPES.has(type) ? type : null;
};

const markerForBlockType = (type) => `::${type}`;

const cleanRawExercise = (text) => {
  const lines = normalizeLineEndings(text).split('\n');
  let idx = 0;
  while (idx < lines.length && (!lines[idx].trim() || isExerciseMarker(lines[idx]))) {
    if (isExerciseMarker(lines[idx])) {
      return lines.slice(idx + 1).join('\n').trim();
    }
    idx += 1;
  }
  return text.trim();
};

const emptyResult = (raw) => ({
  task: '',
  options: [],
  source: '',
  examples: [],
  blocks: [],
  exercise: cleanRawExercise(raw),
  rawPreamble: '',
  hasBlocks: false
});

/**
 * Parse leading visual information blocks without touching the stored card text.
 *
 * ARCHITECTURAL PRINCIPLE:
 * 1. front_text — хранение полной карточки в БД.
 * 2. parseExerciseContent(front_text) — единственная граница между визуальной структурой карточки и синтаксисом упражнения.
 * 3. parsed.exercise — единственный текст лицевой стороны, который разрешено передавать специализированным exercise-анализаторам.
 * 4. parsed.source — текст блока ::source (не путать с card.context!).
 *
 * Supported markers:
 * - ::task -> task instructions
 * - ::source -> background text / context source
 * - ::options -> answer choices
 * - ::example -> examples (can appear multiple times)
 * - ::exercise -> explicit start of the exercise body (optional)
 */
export const parseExerciseContent = (rawText) => {
  const raw = normalizeLineEndings(rawText);
  if (!raw.trim()) return emptyResult(raw);

  const lines = raw.split('\n');
  const hasExplicitExerciseMarker = lines.some(isExerciseMarker);
  const blocks = [];
  
  let currentType = null;
  let currentLines = [];
  
  const saveBlock = () => {
    const content = currentLines.join('\n').trim();
    if (currentType || content) {
      blocks.push({
        type: currentType || 'exercise',
        marker: currentType ? markerForBlockType(currentType) : null,
        content,
        ...(currentType === 'options' ? {
          options: content.split(/\s*\|\s*|\n+/).map(v => v.trim()).filter(Boolean)
        } : {})
      });
    }
    currentType = null;
    currentLines = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const infoType = getBlockType(line);
    const isEx = isExerciseMarker(line);
    
    if (infoType || isEx) {
      saveBlock();
      currentType = infoType || (isEx ? 'exercise' : null);
      i++;
      continue;
    }
    
    // Mode B Implicit Boundary Detection:
    // If we are inside an info block, we hit an empty line, AND there is NO explicit ::exercise marker in the file,
    // we look ahead. If the next non-blank line is NOT a marker, then the current info block ends.
    if (!hasExplicitExerciseMarker && currentType && currentType !== 'exercise' && !line.trim()) {
      let nextIndex = i;
      while (nextIndex < lines.length && !lines[nextIndex].trim()) {
        nextIndex++;
      }
      if (nextIndex < lines.length) {
        const nextInfoType = getBlockType(lines[nextIndex]);
        
        if (!nextInfoType) {
           saveBlock();
           currentType = 'exercise';
        }
      }
    }
    
    currentLines.push(line);
    i++;
  }
  saveBlock();

  const firstContent = (type) => blocks.find(block => block.type === type && block.content)?.content || '';
  const exercise = blocks.filter(b => b.type === 'exercise').map(b => b.content).join('\n\n').trim();

  // For backward compatibility (not strictly used anymore but kept for safety)
  const exerciseIndex = blocks.findIndex(b => b.type === 'exercise');
  const rawPreamble = exerciseIndex > 0 ? blocks.slice(0, exerciseIndex).map(b => (b.marker ? b.marker + '\n' : '') + b.content).join('\n\n') : '';

  return {
    task: firstContent('task'),
    options: blocks.filter(block => block.type === 'options').flatMap(block => block.options || []),
    source: firstContent('source'),
    examples: blocks.filter(block => block.type === 'example' && block.content).map(block => block.content),
    blocks,
    exercise,
    rawPreamble,
    hasBlocks: blocks.length > 0 && blocks.some(b => b.type !== 'exercise')
  };
};

/** Restore the original information preamble around AI-generated exercise text. */
export const restoreExerciseContent = (parsedContent, generatedExercise) => {
  const generated = parseExerciseContent(generatedExercise);
  const exerciseText = (generated.hasBlocks ? generated.exercise : normalizeLineEndings(generatedExercise)).trim();
  
  const { blocks } = parsedContent;
  if (!blocks || blocks.length === 0) return exerciseText;

  let result = [];
  let exerciseInserted = false;
  
  const hasInfoBlocks = blocks.some(b => b.type !== 'exercise');
  const hasExplicitExerciseMarker = blocks.some(b => b.type === 'exercise' && b.marker);
  const hasSource = blocks.some(b => b.type === 'source');
  
  for (const block of blocks) {
    if (block.type === 'exercise') {
      if (!exerciseInserted) {
        let exText = exerciseText;
        if (block.marker || (hasSource && hasInfoBlocks && !hasExplicitExerciseMarker)) {
           exText = exText ? `::exercise\n${exText}` : '::exercise';
        }
        if (exText) result.push(exText);
        exerciseInserted = true;
      }
    } else {
      let blockText = '';
      if (block.marker) blockText += block.marker;
      if (block.content) blockText += (blockText ? '\n' : '') + block.content;
      if (blockText) result.push(blockText);
    }
  }
  
  if (!exerciseInserted) {
    let exText = exerciseText;
    if (hasSource && hasInfoBlocks && !hasExplicitExerciseMarker) {
      exText = exText ? `::exercise\n${exText}` : '::exercise';
    }
    if (exText) result.push(exText);
  }
  
  return result.join('\n\n').trim();
};
