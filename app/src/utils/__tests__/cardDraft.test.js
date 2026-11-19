import test from 'node:test';
import assert from 'node:assert/strict';
import { attachDraftImage, cardTypes, changeDraft, changeDraftSource, draftSourceError,
  newCardContent, parseCardSource, patchGradingPolicy, puzzleDraftTokens, validateStandardDraft } from '../cardDraft.js';

test('uploads wait for valid JSON and attach once to the corrected card in completion order', () => {
  let draft = { id: 1, content_v2: newCardContent() };
  const set = update => { draft = update(draft); };
  changeDraftSource(set, JSON.stringify(draft.content_v2, null, 4) + '\n');
  attachDraftImage(set, 1, 'images/upload.webp');
  assert.deepEqual(JSON.parse(draft.content_v2_source), draft.content_v2);
  assert.equal(draft.content_v2.card.layout.at(-1).path, 'images/upload.webp');
  changeDraftSource(set, '{unfinished');
  const before = draft;
  changeDraft(set, card => ({ ...card, explanation: 'Would overwrite unfinished JSON' }));
  attachDraftImage(set, 2, 'images/foreign.webp');
  assert.equal(draft, before);
  attachDraftImage(set, 1, 'images/other.webp');
  attachDraftImage(set, 1, 'images/third.webp');
  assert.equal(draft.content_v2_source, '{unfinished');
  assert.ok(draftSourceError(draft));
  const edited = structuredClone(draft.content_v2);
  edited.card.data.prompt = 'Latest text';
  changeDraftSource(set, JSON.stringify(edited));
  assert.equal(draftSourceError(draft), null);
  assert.equal(draft.pendingLayoutImages, undefined);
  assert.deepEqual(JSON.parse(draft.content_v2_source), draft.content_v2);
  assert.equal(draft.content_v2.card.data.prompt, 'Latest text');
  assert.deepEqual(draft.content_v2.card.layout.filter(item => item.type === 'image').map(item => item.path),
    ['images/upload.webp', 'images/other.webp', 'images/third.webp']);
});

test('source JSON preserves all nine typed drafts and arbitrary nested metadata literally', () => {
  for (const kind of cardTypes) {
    const content = newCardContent(kind);
    content.card.metadata = { literal: '{"quoted": "Grüße [[literal]] @quiz"}\nКонтекст',
      ordered: [null, true, { values: [3, 1, 2] }] };
    const source = JSON.stringify(content, null, 4) + '\n';
    assert.deepEqual(parseCardSource(source), content);
  }
});

test('source JSON rejects incomplete syntax and envelopes unsafe to open in the typed form', () => {
  for (const source of ['{"card":', 'null', '[]', '{}', '{"schema_version":1}',
    JSON.stringify({ schema_version: 2, card: { type: 'standard', data: [] } }),
    JSON.stringify({ schema_version: 2, card: { type: 'standard', data: { prompt: 'Haus' }, info: [null] } }),
    JSON.stringify({ schema_version: 2, card: { type: 'standard', data: { prompt: 'Haus' }, layout: [
      { id: 'exercise', type: 'exercise' }, { id: 'image', type: 'image', path: 'images/example.webp', caption: { ru: 'Подпись' } },
    ] } }),
    JSON.stringify({ schema_version: 2, card: { type: 'theory', data: { text: '## Theorie' }, info: [null] } }),
    JSON.stringify({ schema_version: 2, card: { type: 'match', data: { pairs: [{ left: 'Haus', right: null }] } } }),
    JSON.stringify({ schema_version: 2, card: { type: 'free_text', data: { prompt: 'Q', accepted_answers: [null] } } }),
    JSON.stringify({ schema_version: 2, card: { type: 'free_text', data: { prompt: 'Q', grading_policy: [] } } }),
    JSON.stringify({ schema_version: 2, card: { type: 'editable_text', data: { source_text: 'Q', accepted_answers: [false] } } }),
    JSON.stringify({ schema_version: 2, card: { type: 'trainer', data: { parts: null } } }),
    JSON.stringify({ schema_version: 2, card: { type: 'trainer', data: { parts: [{ type: 'input', answers: [null] }] } } }),
    JSON.stringify({ schema_version: 2, card: { type: 'trainer', data: { parts: [{ type: 'choice', options: [null] }] } } }),
    JSON.stringify({ schema_version: 2, card: { type: 'trainer', data: { parts: [{ type: 'unknown' }] } } }),
    JSON.stringify({ schema_version: 2, card: { type: 'word_bank', data: { options: [], parts: [] }, info: [null] } }),
    JSON.stringify({ schema_version: 2, card: { type: 'word_bank', data: { options: [], parts: [{ type: 'gap', option: 0 }] } } }),
    JSON.stringify({ schema_version: 2, card: { type: 'puzzle', data: { tokens: 'Nur Text' } } }),
    JSON.stringify({ schema_version: 2, card: { type: 'puzzle', data: { tokens: ['Hallo!', null] } } }),
    JSON.stringify({ schema_version: 2, card: { type: 'quiz', data: { prompt: 'Q', options: [null] } } })]) {
    assert.throws(() => parseCardSource(source));
  }
});

test('grading edits keep the effective FreeText default and preserve all untouched rule fields', () => {
  const fresh = newCardContent('free_text').card;
  const implicit = patchGradingPolicy(fresh, 'case_sensitive', true);
  assert.deepEqual(implicit.data.grading_policy, { mode: 'open_text', case_sensitive: true });
  assert.equal(fresh.data.grading_policy, undefined);
  assert.equal(patchGradingPolicy(fresh, 'case_sensitive', undefined), fresh);
  const partial = { ...fresh, data: { ...fresh.data, grading_policy: { max_retries: 2 } } };
  assert.deepEqual(patchGradingPolicy(partial, 'typo_tolerance', false).data.grading_policy,
    { max_retries: 2, typo_tolerance: false });
  assert.deepEqual(patchGradingPolicy(implicit, 'case_sensitive', undefined).data.grading_policy, { mode: 'open_text' });
  const editable = newCardContent('editable_text').card;
  assert.deepEqual(patchGradingPolicy(editable, 'case_sensitive', true).data.grading_policy, { case_sensitive: true });
});

test('Puzzle sentence edits keep repeated words, case and punctuation in Native V2', () => {
  const original = ['Am Montag', 'übe', 'ich.'];
  assert.equal(puzzleDraftTokens('Am Montag übe ich.', original), original);
  assert.deepEqual(puzzleDraftTokens('  „Ich“\tübe,\u00a0übe,\nund übe!  ', original), ['„Ich“', 'übe,', 'übe,', 'und', 'übe!']);
  assert.deepEqual(puzzleDraftTokens(' \n\t ', original), []);
});

test('source parsing leaves domain validation to the existing save pipeline', () => {
  const content = newCardContent('quiz');
  content.card.data.options = [];
  assert.deepEqual(parseCardSource(JSON.stringify(content)), content);
  content.card.data.options = [{ text: 'Default incorrect option' }];
  assert.deepEqual(parseCardSource(JSON.stringify(content)), content);
  content.card.info = [{ type: 'options', items: [{ text: 'Unreadable as a chip' }] }];
  assert.throws(() => parseCardSource(JSON.stringify(content)));
});

test('Trainer source preserves manual choices, automatic distractors, and exact answer text', () => {
  const content = newCardContent('trainer');
  content.card.data.parts = [
    { type: 'text', text: 'Ich ' },
    { type: 'choice', options: [{ text: 'bin', correct: true }, { text: 'habe' }] },
    { type: 'input', answers: ['gewesen|worden'] },
    { type: 'choice', distractors: 'auto', options: [{ text: 'war', correct: true }] },
  ];
  assert.deepEqual(parseCardSource(JSON.stringify(content)), content);
});

test('standard draft validation allows empty back while keeping prompt and type guards', () => {
  for (const data of [{ prompt: 'Haus', answer: '' }, { prompt: 'Haus', answer: '   ' }, { prompt: 'Haus' }]) {
    assert.doesNotThrow(() => validateStandardDraft({ type: 'standard', data, info: [] }));
  }
  for (const data of [{ prompt: '   ', answer: '' }, { prompt: '   ', answer: 'дом' }, { prompt: 'Haus', answer: null }]) {
    assert.throws(() => validateStandardDraft({ type: 'standard', data, info: [] }));
  }
});
