import { parseExerciseContent } from './exerciseContentParser.js';
import { detectExerciseType } from './exerciseDetector.js';
import { normalizeWordBankValue } from './wordBankParser.js';

// Templates for the advanced markup toolbar grouped by category:
// - exercise: card types and interactive gaps (directives & inputs)
// - marker: structural information blocks (::task, ::source, ::example, etc.)
export const editorCommandGroups = [
  {
    id: 'exercise',
    label: 'Тип карточки и элементы',
    commands: [
      { id: 'puzzle', label: 'Собрать предложение', template: '@puzzle\nIch lerne Deutsch.', directive: true, group: 'exercise' },
      { id: 'match', label: 'Соединение пар', template: '@match\nBerlin => Deutschland\nWien => Österreich', directive: true, group: 'exercise' },
      { id: 'free', label: 'Свободный ответ', template: '@free\n', directive: true, group: 'exercise' },
      { id: 'wordbank', label: 'Банк слов', template: '@wordbank\nIch lerne <<1>>.\n@options\nDeutsch | Englisch', directive: true, group: 'exercise' },
      { id: 'choice', label: 'Варианты ответа', template: '{*Berlin|Hamburg|München}', group: 'exercise' },
      { id: 'input', label: 'Поле для ввода', template: '[[Berlin]]', group: 'exercise' },
      { id: 'ending', label: 'Окончание с выбором', template: '{en}', group: 'exercise' },
    ]
  },
  {
    id: 'marker',
    label: 'Маркеры структуры',
    commands: [
      { id: 'task', label: 'Задание', template: '::task\n', info: true, group: 'marker' },
      { id: 'hint', label: 'Подсказка', template: '::source\n', info: true, group: 'marker' },
      { id: 'example', label: 'Пример', template: '::example\n', info: true, group: 'marker' },
      { id: 'source', label: 'Исходный текст', template: '::source\n', info: true, group: 'marker' },
      { id: 'exercise', label: 'Содержимое упражнения', template: '::exercise\n', info: true, group: 'marker' },
      { id: 'options', label: 'Список вариантов', template: '::options\n', info: true, group: 'marker' },
      { id: 'topic', label: 'Тема', template: '::topic\n', info: true, group: 'marker' },
      { id: 'level', label: 'Уровень сложности', template: '::level\n', info: true, group: 'marker' },
    ]
  }
];

export const editorCommands = editorCommandGroups.flatMap(group => group.commands);

function editorMarkers(raw) {
  return [...raw.matchAll(/^[ \t]*::(\w+)[ \t]*\r?$/gm)].map(match => {
    const type = match[1].toLowerCase();
    const end = match.index + match[0].length;
    return { index: match.index, type, end: end + (raw[end] === '\n' ? 1 : 0) };
  });
}

/** Textareas count CRLF as one character; stored source ranges count both. */
export function editorSourceOffset(raw, offset) {
  let at = 0;
  for (let count = 0; count < offset && at < raw.length; count++, at++) {
    if (raw[at] === '\r' && raw[at + 1] === '\n') at++;
  }
  return at;
}

export function replaceEditorRange(raw, start, end, value) {
  return raw.slice(0, start) + value + raw.slice(end);
}

export function insertEditorLineAfter(raw, field, line) {
  const newline = raw.includes('\r\n') ? '\r\n' : '\n';
  return replaceEditorRange(raw, field.end, field.end, newline + line);
}

export function syncWordBankAnswer(back, oldOption, newOption, options = []) {
  const oldValue = normalizeWordBankValue(oldOption);
  if (!oldValue || oldValue === normalizeWordBankValue(newOption)
    || options.filter(option => normalizeWordBankValue(option) === oldValue).length > 1) return back;
  return back.split(/(\r?\n)/).map(line => {
    const answer = /^(\s*[a-zA-Z0-9_-]+\s*=\s*)(.*?)(\s*)$/.exec(line);
    return answer && normalizeWordBankValue(answer[2]) === oldValue
      ? answer[1] + newOption + answer[3] : line;
  }).join('');
}

/** Readable preview when legacy markup cannot be mapped to safe edit ranges. */
export function readableFrontText(raw = '') {
  return raw.split(/\r?\n/)
    .filter(line => !/^\s*(?:::\w+|@(match|free|puzzle|wordbank|options))\s*$/i.test(line))
    .join('\n')
    .replace(/\[\[(.*?)\]\]/g, '$1')
    .replace(/\{([^{}]*)\}/g, (_, choices) => choices.split(/[|;,/]/)[0].trim().replace(/^\*/, ''));
}

export function insertEditorCommand(raw, id, start = raw.length, end = start) {
  const command = editorCommands.find(item => item.id === id);
  if (!command) return { text: raw, cursor: start };
  start = Math.max(0, Math.min(start, raw.length));
  end = Math.max(start, Math.min(end, raw.length));
  const before = raw.slice(0, start);
  const after = raw.slice(end);
  const newline = raw.includes('\r\n') ? '\r\n' : '\n';
  const template = (id === 'ending' && /^(?:e|en|em|er|es)$/.test(raw.slice(start, end))
    ? `{${raw.slice(start, end)}}` : command.template).replace(/\n/g, newline);
  const line = command.info || command.directive;
  const prefix = line && before && !before.endsWith('\n') ? newline : '';
  const suffix = line && after && !template.endsWith('\n') && !/^[\r\n]/.test(after) ? newline : '';
  const addition = prefix + template + suffix;
  const result = { text: before + addition + after, cursor: before.length + addition.length };
  if (id === 'puzzle') {
    result.selectionStart = before.length + prefix.length + '@puzzle'.length + newline.length;
    result.selectionEnd = result.selectionStart + 'Ich lerne Deutsch.'.length;
  }
  return result;
}

function quizOptionParts(line) {
  const correct = /^\s*(?:\*(?!\*)|\[\*\]|[-○•]\s*\*|(?:[a-zA-Z]|[0-9]{1,2})[).]\s*\*)/u.test(line);
  let rest = line;
  let prefix = '';
  for (const pattern of [/^\s*/, /^\*(?!\*)\s*/, /^\[[*xX ]\]\s*/, /^[-○•]\s*/u,
    /^(?:[a-zA-Z]|[0-9]{1,2})[).]\s*/, /^\*\s*/]) {
    const match = pattern.exec(rest);
    if (match?.[0]) {
      prefix += match[0];
      rest = rest.slice(match[0].length);
    }
  }
  return { prefix, display: rest, correct };
}

export function setQuizOptionCorrect(field, checked) {
  let prefix = field.prefix;
  if (/\[[*xX ]\]/.test(prefix)) {
    prefix = prefix.replace(/\[[*xX ]\]/, checked ? '[*]' : '[ ]');
  } else if (checked && !field.correct) {
    prefix = prefix ? `${prefix}*` : '*';
  } else if (!checked && field.correct) {
    prefix = prefix.replace(/\*(?!\*)/, '');
    if (!prefix.trim()) prefix = '- ';
  }
  return prefix + field.display;
}

function projectQuizSection(raw, start, end, add) {
  const text = raw.slice(start, end);
  const lines = [...text.matchAll(/[^\r\n]+/g)];
  const optionStart = lines.findIndex(line => /^\s*(?:\*(?!\*)|\[[*xX ]\]|[-○•]|(?:[a-zA-Z]|[0-9]{1,2})[).]\s)/u.test(line[0]));
  if (optionStart < 1 || lines.length - optionStart < 2) return false;
  let questionEnd = start + lines[optionStart].index;
  while (questionEnd > start && /[\r\n]/.test(raw[questionEnd - 1])) questionEnd--;
  add('text', start, questionEnd, 'Вопрос / лицевая сторона', { sectionType: 'quiz' });
  for (const line of lines.slice(optionStart)) {
    const parts = quizOptionParts(line[0]);
    add('quiz-option', start + line.index, start + line.index + line[0].length,
      'Варианты ответа', parts);
  }
  return true;
}

function projectWordBankSection(raw, start, end, add, sectionIndex) {
  const text = raw.slice(start, end);
  const directive = /^[ \t]*@wordbank[ \t]*\r?\n/i.exec(text);
  const options = /^@options[ \t]*\r?$/im.exec(text);
  if (!directive || !options || options.index <= directive[0].length) return false;
  const bodyStart = start + directive[0].length;
  let bodyEnd = start + options.index;
  while (bodyEnd > bodyStart && /[\r\n]/.test(raw[bodyEnd - 1])) bodyEnd--;
  const body = raw.slice(bodyStart, bodyEnd);
  let cursor = bodyStart;
  for (const gap of body.matchAll(/<<([a-zA-Z0-9_-]+)>>/g)) {
    const at = bodyStart + gap.index;
    if (at > cursor) add('text', cursor, at, 'Вопрос / лицевая сторона', { sectionType: 'word_bank', sectionIndex });
    add('wordbank-gap', at, at + gap[0].length, 'Пропуск', { sectionType: 'word_bank', sectionIndex });
    cursor = at + gap[0].length;
  }
  if (cursor < bodyEnd) add('text', cursor, bodyEnd, 'Вопрос / лицевая сторона', { sectionType: 'word_bank', sectionIndex });
  const optionsStart = start + options.index + options[0].length + (raw[start + options.index + options[0].length] === '\n' ? 1 : 0);
  for (const option of raw.slice(optionsStart, end).matchAll(/[^|\r\n]+/g)) {
    add('wordbank-option', optionsStart + option.index, optionsStart + option.index + option[0].length, 'Варианты ответа');
  }
  return cursor > bodyStart && optionsStart < end;
}

/** An ephemeral view of exact source ranges, never a second card model.
 * The existing parser defines information blocks. Ambiguous legacy syntax stays raw.
 * No serialization takes place on mount, mode switch, or save.
 */
export function projectEditorFields(raw = '') {
  const parsed = parseExerciseContent(raw);
  const exerciseType = detectExerciseType(raw);
  const explicitExercise = /^\s*::exercise\s*$/im.test(raw);
  if (parsed.hasBlocks && !explicitExercise && !['quiz', 'word_bank'].includes(exerciseType)) return null;
  const markers = editorMarkers(raw);
  if (markers.some(m => !editorCommands.some(c => c.info && c.template.trim() === `::${m.type}`))) return null;
  if (parsed.hasBlocks && !explicitExercise) {
    const exercise = parsed.exercise;
    const pattern = new RegExp(exercise.split('\n').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\r?\\n'), 'g');
    const matches = [...raw.matchAll(pattern)];
    if (matches.length !== 1) return null;
    markers.push({ index: matches[0].index, type: 'exercise', end: matches[0].index });
    markers.sort((a, b) => a.index - b.index);
  }
  const sections = [];
  let cursor = 0;
  let type = 'exercise';
  for (const marker of markers) {
    if (marker.index > cursor) sections.push({ type, start: cursor, end: marker.index });
    type = marker.type;
    cursor = marker.end;
  }
  sections.push({ type, start: cursor, end: raw.length });
  const fields = [];
  const add = (kind, start, end, label, extra = {}) => fields.push({ kind, start, end, value: raw.slice(start, end), label, ...extra });
  for (const [sectionIndex, section] of sections.entries()) {
    let { start, end } = section;
    // Reserve only the line boundary before the next marker. Never trim typed spaces.
    if (end < raw.length && end > start && raw[end - 1] === '\n') {
      end -= raw[end - 2] === '\r' ? 2 : 1;
    }
    const text = raw.slice(start, end);
    if (section.type !== 'exercise') {
      if (/::|^\s*@/m.test(text)) return null;
      add('text', start, end, editorCommands.find(c => c.id === section.type).label);
      continue;
    }
    if (exerciseType === 'quiz') {
      if (!projectQuizSection(raw, start, end, add)) return null;
      continue;
    }
    if (exerciseType === 'word_bank') {
      if (!projectWordBankSection(raw, start, end, add, sectionIndex)) return null;
      continue;
    }
    const directive = /^@(match|free|puzzle)[ \t]*\r?\n?/i.exec(text);
    if (directive) {
      const kind = directive[1].toLowerCase();
      start += directive[0].length;
      const body = raw.slice(start, end);
      if (/::|^\s*@|[{}[\]]/m.test(body)) return null;
      if (kind === 'match') {
        const lines = [...body.matchAll(/[^\r\n]+/g)];
        for (const line of lines) {
          const left = start + line.index;
          const separator = /\s*(?:=>|->|—|=)\s*/.exec(line[0]);
          if (!separator) {
            if (fields.some(field => field.kind === 'pair')) return null;
            add('text', left, left + line[0].length, 'Вопрос / лицевая сторона');
            continue;
          }
          add('pair', left, left + line[0].length, 'Соединение пар',
            { separator: separator.index, separatorLength: separator[0].length });
        }
      } else add('text', start, end, kind === 'free' ? 'Свободный ответ' : 'Собрать предложение');
      continue;
    }
    let pos = start;
    for (const token of text.matchAll(/\{([^{}]*)\}|\[\[([^[\]]*)\]\]/g)) {
      const at = start + token.index;
      if (at > pos) add('text', pos, at, pos === section.start ? 'Вопрос / лицевая сторона' : 'Текст',
        { sectionType: exerciseType === 'trainer' ? 'trainer' : undefined, sectionIndex });
      add(token[1] !== undefined ? 'choice' : 'input', at, at + token[0].length,
        token[1] !== undefined ? 'Варианты ответа' : 'Правильный ответ',
        { sectionType: exerciseType === 'trainer' ? 'trainer' : undefined, sectionIndex });
      pos = at + token[0].length;
    }
    if (pos < end || !text) add('text', pos, end, 'Вопрос / лицевая сторона',
      { sectionType: exerciseType === 'trainer' ? 'trainer' : undefined, sectionIndex });
  }
  // Anything the visual controls cannot safely express is kept intact behind Raw.
  if (fields.some(f => f.kind === 'text' && /::|^\s*@|[{}[\]]|<<|>>/m.test(f.value))) return null;
  return fields.length ? fields : [{ kind: 'text', start: 0, end: raw.length, value: raw, label: 'Вопрос / лицевая сторона' }];
}
