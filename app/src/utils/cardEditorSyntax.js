import { parseExerciseContent } from './exerciseContentParser.js';
import { detectExerciseType } from './exerciseDetector.js';

export const EDITOR_MODE_KEY = 'lerne.cardEditor.mode';
// Shared by the visual element picker and the raw insertion toolbar.
export const editorCommands = [
  { id: 'task', label: 'Задание', template: '::task\n', info: true },
  { id: 'choice', label: 'Варианты ответа', template: '{*Berlin|Hamburg|München}' },
  { id: 'input', label: 'Поле для ввода', template: '[[Berlin]]' },
  { id: 'match', label: 'Соединение пар', template: '@match\nBerlin => Deutschland\nWien => Österreich', directive: true },
  { id: 'free', label: 'Свободный ответ', template: '@free\n', directive: true },
  { id: 'puzzle', label: 'Собрать предложение', template: '@puzzle\nIch lerne Deutsch.', directive: true },
  { id: 'options', label: 'Список вариантов', template: '::options\n', info: true },
  { id: 'source', label: 'Исходный текст', template: '::source\n', info: true },
  { id: 'example', label: 'Пример', template: '::example\n', info: true },
  { id: 'exercise', label: 'Содержимое упражнения', template: '::exercise\n', info: true },
  { id: 'level', label: 'Уровень сложности', template: '::level\n', info: true },
  { id: 'topic', label: 'Тема', template: '::topic\n', info: true },
];

export function replaceEditorRange(raw, start, end, value) {
  return raw.slice(0, start) + value + raw.slice(end);
}

export function insertEditorCommand(raw, id, start = raw.length, end = start) {
  const command = editorCommands.find(item => item.id === id);
  if (!command) return { text: raw, cursor: start };
  const before = raw.slice(0, start);
  const after = raw.slice(end);
  const line = command.info || command.directive;
  const prefix = line && before && !before.endsWith('\n') ? '\n' : '';
  const suffix = line && after && !command.template.endsWith('\n') ? '\n' : '';
  const addition = prefix + command.template + suffix;
  return { text: before + addition + after, cursor: before.length + addition.length };
}

/** An ephemeral view of exact source ranges, never a second card model.
 * The existing parser defines information blocks. Ambiguous legacy syntax stays raw.
 * No serialization takes place on mount, mode switch, or save.
 */
export function projectEditorFields(raw = '') {
  const parsed = parseExerciseContent(raw);
  if (['quiz', 'word_bank'].includes(detectExerciseType(raw))) return null;
  if (parsed.hasBlocks && !/^\s*::exercise\s*$/im.test(raw)) return null;
  const markers = [...raw.matchAll(/^[ \t]*::(\w+)[ \t]*\r?$/gm)];
  if (markers.some(m => !editorCommands.some(c => c.info && c.id === m[1].toLowerCase()))) return null;
  const sections = [];
  let cursor = 0;
  let type = 'exercise';
  for (const marker of markers) {
    if (marker.index > cursor) sections.push({ type, start: cursor, end: marker.index });
    type = marker[1].toLowerCase();
    cursor = marker.index + marker[0].length + (raw[marker.index + marker[0].length] === '\n' ? 1 : 0);
  }
  sections.push({ type, start: cursor, end: raw.length });
  const fields = [];
  const add = (kind, start, end, label, extra = {}) => fields.push({ kind, start, end, value: raw.slice(start, end), label, ...extra });
  for (const section of sections) {
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
    const directive = /^@(match|free|puzzle)[ \t]*\r?\n?/i.exec(text);
    if (directive) {
      const kind = directive[1].toLowerCase();
      start += directive[0].length;
      const body = raw.slice(start, end);
      if (/::|^\s*@|[{}[\]]/m.test(body)) return null;
      if (kind === 'match') {
        const lines = [...body.matchAll(/[^\r\n]+/g)];
        for (const line of lines) {
          const separator = line[0].indexOf(' => ');
          if (separator < 0) return null;
          const left = start + line.index;
          add('pair', left, left + line[0].length, 'Соединение пар', { separator });
        }
      } else add('text', start, end, kind === 'free' ? 'Свободный ответ' : 'Собрать предложение');
      continue;
    }
    let pos = start;
    for (const token of text.matchAll(/\{([^{}]*)\}|\[\[([^[\]]*)\]\]/g)) {
      const at = start + token.index;
      if (at > pos) add('text', pos, at, pos === section.start ? 'Вопрос / лицевая сторона' : 'Текст');
      add(token[1] !== undefined ? 'choice' : 'input', at, at + token[0].length,
        token[1] !== undefined ? 'Варианты ответа' : 'Правильный ответ');
      pos = at + token[0].length;
    }
    if (pos < end || !text) add('text', pos, end, 'Вопрос / лицевая сторона');
  }
  // Anything the visual controls cannot safely express is kept intact behind Raw.
  if (fields.some(f => f.kind === 'text' && /::|^\s*@|[{}[\]]|<<|>>/m.test(f.value))) return null;
  return fields.length ? fields : [{ kind: 'text', start: 0, end: raw.length, value: raw, label: 'Вопрос / лицевая сторона' }];
}

export function addVisualElement(raw, id) {
  const command = editorCommands.find(item => item.id === id);
  if (!command) return raw;
  if (command.info && id !== 'exercise') {
    // Explicit boundary avoids the parser's legacy blank-line heuristic.
    const body = /^\s*::exercise\s*$/im.test(raw) ? raw : `::exercise\n${raw}`;
    return `${command.template}\n${body}`;
  }
  if (command.directive) {
    // Preserve existing prose as an instruction, rather than replacing it.
    return `${raw ? `::task\n${raw}\n\n` : ''}::exercise\n${command.template}`;
  }
  return insertEditorCommand(raw, id, raw.length).text;
}
