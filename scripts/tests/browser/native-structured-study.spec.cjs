const { test, expect } = require('./isolated-fixture.cjs');

const deck = { id: 1, name: 'Structured practice', target_language: 'de', role: 'owner',
  stats: { total: 9, new: 9, due: 0, learning: 0 } };
const info = [{ type: 'task', text: 'Read the authored task.' }, { type: 'source', text: 'Source hint' },
  { type: 'example', text: 'Example block' }, { type: 'options', items: ['Information option'] }];
const cases = [
  ['theory', { text: 'Theory shows [[literal]] and @quiz', summary: '**Theory summary**' }, info],
  ['standard', { prompt: 'Standard prompt', answer: 'Standard translation' }],
  ['trainer', { parts: [{ type: 'text', text: 'Ich habe einen klein' }, { type: 'input', answers: ['en', 'en|literal'] },
    { type: 'text', text: ' Hund und ich ' }, { type: 'choice', options: [
      { text: 'bleibe', correct: true }, { text: 'bleibst', correct: false }] }, { type: 'text', text: '.' }],
  back_note: 'Trainer translation' }],
  ['quiz', { prompt: 'Quiz [[prompt]]', options: [
    { text: 'Answer one', correct: true }, { text: 'Answer two', correct: true }, { text: 'Wrong option', correct: false }] }],
  ['match', { pairs: [{ left: 'Left one', right: 'Right one => literal' }, { left: 'Left two', right: 'Right two' }] }],
  ['puzzle', { tokens: ['Am Montag', 'lerne', 'ich.'], translation: 'Puzzle translation' }],
  ['word_bank', { options: ['gehe', 'geht'], parts: [{ type: 'text', text: 'Ich ' },
    { type: 'gap', option: 0 }, { type: 'text', text: ' nach Hause.' }] }],
  ['free_text', { prompt: 'Free response', sample_answer: 'Sample answer' }],
  ['editable_text', { source_text: 'Ich gehen.', correct_text: 'Ich gehe.' }],
];
const cards = cases.map(([type, data, blocks], index) => ({
  id: index + 1, deck_id: 1, position: index + 1, queue: 'new', revision: `fixture-${index}`,
  ...(type === 'theory' ? { image_url: '/api/media/images/theory.svg', audio_url: 'http://127.0.0.1:5199/api/media/audio/theory.mp3' } : {}),
  ...(!['theory', 'standard'].includes(type) ? { requiredActions: ['answer'] } : {}),
  content_v2: { schema_version: 2, card: { type, data, info: blocks || [], level: 'B1', explanation: `Explanation for ${type}` } },
}));

async function open(page, context, { legacy = null, locale = 'ru' } = {}) {
  page.setDefaultTimeout(8000);
  const grades = [];
  const answers = [];
  await context.addInitScript(locale => {
    localStorage.setItem('native_language', locale);
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ account_id: 1, access_token: 'fixture', refresh_token: 'fixture' }));
    HTMLMediaElement.prototype.play = function () {
      window.lastPlayed = this.src;
      return Promise.resolve();
    };
  }, locale);
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/auth/v2/me') return route.fulfill({ json: { user_id: 1, is_guest: false } });
    if (pathname === '/api/init') return route.fulfill({ json: { decks: [deck], folders: [], settings: {},
      prompts: {}, user_settings: {}, user_info: { user_id: 1, is_guest: false } } });
    if (pathname === '/api/decks/1/cards') {
      const listing = legacy === 'deck' ? []
        : legacy === 'card' ? [{ id: 99, deck_id: 1, front: 'Legacy pending', back: 'V1' }] : cards;
      return route.fulfill({ json: listing });
    }
    if (pathname === '/api/decks/1/next') {
      if (legacy === 'deck') return route.fulfill({ status: 409, json: { detail: { code: 'deck_requires_migration' } } });
      return route.fulfill({ json: cards[0] });
    }
    if (pathname === '/api/study/card/99') return route.fulfill({ status: 409, json: { detail: { code: 'card_requires_migration' } } });
    if (pathname.startsWith('/api/study/card/')) return route.fulfill({ json: cards[Number(pathname.split('/').pop()) - 1] });
    if (pathname === '/api/study/grade') {
      const request = route.request().postDataJSON();
      grades.push(request);
      return route.fulfill({ json: request.return_next ? { finished: true } : { status: 'success' } });
    }
    if (pathname === '/api/ai/evaluate-answer') {
      const request = route.request().postDataJSON();
      answers.push(request);
      return route.fulfill({ json: { result: { schema_version: 1, verdict: 'correct', accepted: true,
        error_type: null, severity: 'none', evaluator: 'exact' }, grading_policy: { mode: 'exact', max_retries: 3 } } });
    }
    if (pathname === '/api/media/images/theory.svg') return route.fulfill({ contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="90"><rect width="180" height="90" fill="#5e81ac"/></svg>' });
    if (pathname === '/api/media/audio/theory.mp3') return route.fulfill({ contentType: 'audio/mpeg', body: 'fixture audio' });
    if (pathname === '/api/knowledge/decks/1') return route.fulfill({ json: { card_ids: [], knowledge_items: [], card_knowledge_items: [] } });
    if (pathname === '/api/messages' || pathname === '/api/cards/duplicates') return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });
  await page.goto('/?user_id=1');
  await expect(page.getByText(deck.name, { exact: true }).first()).toBeVisible();
  await page.addStyleTag({ content: '.nav-arrow-btn { animation: none !important; }' });
  await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    useSettingsStore.setState({ autoPlay: false, studyMode: 'classic', gradingCollapsed: false });
  });
  await page.getByRole('heading', { name: deck.name }).click();
  if (legacy === 'card') {
    await page.getByRole('button', { name: /Показать список|Show list/ }).click();
    await page.getByText('Legacy pending', { exact: true }).click();
  } else {
    await page.getByRole('button', { name: /Начать занятие|Start study/ }).click();
  }
  return { grades, answers };
}

test('native content renders and completes all nine types through study navigation', async ({ page, context }, testInfo) => {
  test.setTimeout(90000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const { grades, answers } = await open(page, context);
  const button = name => page.getByRole('button', { name, exact: true });
  const flip = () => button('Перевернуть карточку').click();
  const grade = async (id) => {
    const control = page.locator('.grade-buttons button').nth(2);
    await expect(control).toBeEnabled();
    await control.click();
    await expect.poll(() => grades.some(request => request.card_id === id)).toBe(true);
  };

  await expect(page.locator('#tut-study-front')).toHaveText('Theory shows [[literal]] and @quiz');
  await expect(page.getByText('Information option')).toBeVisible();
  await expect(page.getByText('Source hint')).toBeVisible();
  await expect(page.locator('img[src*="theory.svg"]')).toBeVisible();
  await button('Развернуть Аудио').click();
  await button('Воспроизвести').click();
  await expect.poll(() => page.evaluate(() => window.lastPlayed)).toContain('theory.mp3');
  await button('Свернуть Аудио').click();
  await flip();
  await expect(page.locator('#tut-study-answer strong')).toHaveText('Theory summary');
  await expect(page.getByText('Explanation for theory')).toBeVisible();
  await grade(1);

  await expect(page.locator('#tut-study-front')).toHaveText('Standard prompt');
  await flip();
  await expect(page.locator('#tut-study-answer')).toHaveText('Standard translation');
  await grade(2);

  const trainer = page.locator('.trainer-exercise');
  await trainer.getByRole('textbox', { name: 'Пропуск 1' }).fill('er');
  await trainer.getByRole('button', { name: 'Пропуск 2' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'bleibe', exact: true }).click();
  await button('Проверить ответы').click();
  await expect(trainer.getByText('Проверь окончание.')).toBeVisible();
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(trainer).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`native-trainer-${width}.png`), fullPage: true });
  }
  await trainer.getByRole('textbox', { name: 'Пропуск 1' }).fill('en|literal');
  await button('Проверить ответы').click();
  await expect(trainer.getByRole('textbox', { name: 'Пропуск 1' })).toBeDisabled();
  await grade(3);

  const quiz = page.locator('.quiz-container');
  await expect(quiz.locator('.quiz-question')).toHaveText('Quiz [[prompt]]');
  await quiz.getByText('Wrong option', { exact: true }).click();
  await button('Проверить').click();
  await expect(quiz.getByText('Попробуй другой вариант.')).toBeVisible();
  await quiz.getByText('Answer two', { exact: true }).click();
  await button('Проверить').click();
  await expect(quiz.locator('.quiz-option-item.correct')).toHaveCount(1);
  await grade(4);

  const match = page.locator('.match-container');
  await match.getByText('Left one', { exact: true }).click();
  await match.getByText('Right two', { exact: true }).click();
  await expect(match.getByText('Эти элементы не образуют правильную пару.')).toBeVisible();
  await match.getByText('Right one => literal', { exact: true }).click();
  await match.getByText('Left one', { exact: true }).click();
  await match.getByText('Left two', { exact: true }).click();
  await match.getByText('Right two', { exact: true }).click();
  await grade(5);

  const puzzle = page.locator('.puzzle-exercise');
  await expect(puzzle.getByText('Am Montag', { exact: true })).toHaveCount(1);
  for (const id of [1, 0, 2]) await puzzle.locator(`.btn-puzzle-chip[data-id="${id}"]`).click();
  await button('Проверить ответы').click();
  await expect(puzzle.locator('.puzzle-feedback-hint')).toBeVisible();
  for (const id of [1, 0, 2]) await puzzle.locator(`.puzzle-slot-chip[data-id="${id}"]`).click();
  for (const id of [0, 1, 2]) await puzzle.locator(`.btn-puzzle-chip[data-id="${id}"]`).click();
  await button('Проверить ответы').click();
  await expect(puzzle).toHaveClass(/is-correct/);
  await grade(6);

  const bank = page.locator('.word-bank-exercise');
  await bank.getByText('geht', { exact: true }).click();
  await button('Проверить').click();
  await expect(bank.locator('.word-bank-gap')).toHaveClass(/is-incorrect/);
  await bank.locator('.word-bank-gap').click();
  await bank.getByText('gehe', { exact: true }).click();
  await button('Проверить').click();
  await expect(bank.locator('.word-bank-gap')).toHaveClass(/is-correct/);
  await grade(7);

  const free = page.locator('.free-text-exercise');
  await expect(free.getByText('Free response')).toBeVisible();
  await free.getByRole('textbox').fill('Free answer');
  await button('Проверить ответ').click();
  await expect(free.locator('.free-text-feedback')).toHaveClass(/is-success/);
  await flip();
  await expect(page.locator('#tut-study-answer')).toHaveText('Sample answer');
  await grade(8);

  const editable = page.locator('.editable-text-exercise');
  await expect(editable.getByRole('textbox')).toHaveValue('Ich gehen.');
  await expect(editable.locator('.editable-text-reset')).toBeDisabled();
  await editable.getByRole('textbox').fill('Ich gehe.');
  await button('Проверить ответ').click();
  await expect(editable.locator('.free-text-feedback')).toHaveClass(/is-success/);
  await grade(9);
  expect(grades.map(grade => grade.card_id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  expect(answers.map(answer => [answer.card_id, answer.answer])).toEqual([[8, 'Free answer'], [9, 'Ich gehe.']]);
  expect(errors).toEqual([]);
});

for (const legacy of ['card', 'deck']) {
  test(`409 ${legacy}_requires_migration is visible in English, with safe navigation`, async ({ page, context }) => {
    await open(page, context, { legacy, locale: 'en' });
    const alert = page.getByRole('alert').filter({ hasText: 'The cards have yet to be migrated to Structured Cards V2.' });
    await expect(alert).toBeVisible();
    await expect(alert.getByRole('button', { name: 'Retry request' })).toHaveCount(0);
    await expect(page.locator('.grade-buttons')).toHaveCount(0);
    await alert.getByRole('button', { name: 'Back to decks' }).click();
    await expect(alert).toHaveCount(0);
  });
}
