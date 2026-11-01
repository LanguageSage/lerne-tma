const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const synthetic = { id: 1, front: '::options\nA | B\n::source\nSynthetic source\n::exercise\nVisible {*A|B} [[form]].',
  back: 'Synthetic translation' };

async function setup(page, context, card = synthetic, { assessmentMode = false, supportHistoryUnknown = false } = {}) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(() => { localStorage.setItem('native_language', 'ru'); });
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/trainer-support-harness', route => route.fulfill({ contentType: 'text/html', body: `
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body>
    <div id="trainer-root" style="max-width:650px;margin:20px auto;padding:12px"></div>
    <script type="module">
      import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
    </script><script type="module" src="/trainer-support-harness.js"></script></body></html>` }));
  await page.route('**/trainer-support-harness.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { ExerciseRenderer } from '/src/components/study/ExerciseRenderer.jsx';
    import { useSettingsStore } from '/src/store/useSettingsStore.js';
    import { DEFAULT_DESIGN_CONFIG_V2 } from '/src/design/designConfig.js';
    import '/src/index.css'; import '/src/App.css'; import '/src/components/study/StudyCard.css';
    useSettingsStore.getState().setPublishedDesignV2({config:DEFAULT_DESIGN_CONFIG_V2,revision:1});
    useSettingsStore.setState({gradeSoundEnabled:false});
    const root = ReactDOM.createRoot(document.getElementById('trainer-root'));
    window.trainerSaved = JSON.parse(sessionStorage.getItem('trainer-test-saved') || '{}');
    window.trainerAnswers = [];
    window.renderTrainer = (key = 'review-1', mounted = true, legacy = false) => {
      const savedState = window.trainerSaved[key];
      root.render(mounted ? React.createElement(React.StrictMode, null, React.createElement(ExerciseRenderer, {
        key, reviewKey:key, card:${JSON.stringify(card)}, assessmentMode:${assessmentMode},
        supportHistoryUnknown:${supportHistoryUnknown},
        savedState:legacy ? {selectedOptions:{},evaluationState:{attemptCount:0}} : savedState,
        onSaveState: state => {window.trainerSaved[key]=state;sessionStorage.setItem('trainer-test-saved',JSON.stringify(window.trainerSaved));},
        onTrainerAnswer: (_id,evidence) => window.trainerAnswers.push(evidence),
      })) : null);
    }; window.renderTrainer();
  ` }));
  await page.goto('/trainer-support-harness');
  await expect(page.locator('.trainer-exercise')).toBeVisible();
  return errors;
}

async function choose(page, value) {
  await page.locator('.trainer-choice-gap').click();
  await page.getByRole('dialog').getByRole('button', { name: value, exact: true }).click();
}
const saved = page => page.evaluate(() => window.trainerSaved['review-1'].evaluationState);

test('Trainer actual translation, per-gap hints, choice options, retry, saved reload and immutable completion', async ({ page, context }, testInfo) => {
  const errors = await setup(page, context);
  await choose(page, 'B'); // Opening options is static scaffolding, not an extra hint.
  expect((await saved(page)).supportState.hint_count).toBe(0);
  await page.getByRole('button', { name: 'Показать перевод', exact: true }).click();
  await expect(page.locator('.trainer-line-trans')).toBeVisible();
  await page.getByRole('button', { name: 'Скрыть перевод', exact: true }).click();
  await page.locator('input[type=text]').fill('wrong');
  await page.getByRole('button', { name: 'Проверить ответы', exact: true }).click();
  await expect(page.locator('.exercise-part-hint')).toHaveCount(2);
  await expect.poll(async () => (await saved(page)).supportState.hint_count).toBe(2);
  expect(await page.evaluate(() => window.trainerAnswers)).toEqual([]);
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`trainer-support-${width}.png`), fullPage: true });
  }
  await page.reload(); // Test harness restores the real serialized evaluationState.
  await expect.poll(async () => (await saved(page)).supportState.hint_count).toBe(2);
  await page.getByRole('button', { name: 'Показать перевод', exact: true }).click();
  await choose(page, 'A');
  await page.locator('input[type=text]').fill('form');
  await page.locator('input[type=text]').press('Enter');
  await expect.poll(() => page.evaluate(() => window.trainerAnswers.length)).toBe(1);
  const evidence = await page.evaluate(() => window.trainerAnswers[0]);
  expect(evidence.supportEvidence).toEqual({ tracking_complete: false, hint_count: 2, translation_view_count: 2,
    answer_reveal_count: null, other_help_count: null, capture_point: 'exercise_completion', answer_attempt_count: 2 });
  expect(evidence.taskSupport.sentence_frame_present).toBe(true);
  expect(evidence.taskSupport.source_vocabulary_present).toBe(true);
  await page.getByRole('button', { name: 'Скрыть перевод', exact: true }).click();
  await page.getByRole('button', { name: 'Показать перевод', exact: true }).click();
  expect((await saved(page)).supportState.translation_view_count).toBe(3);
  expect((await saved(page)).answerSupportEvidence).toEqual(evidence.supportEvidence);
  await page.evaluate(() => window.renderTrainer('review-1', false));
  await expect(page.locator('.trainer-exercise')).toHaveCount(0);
  await page.evaluate(() => window.renderTrainer('review-1'));
  await expect(page.getByRole('button', { name: 'Выполнено', exact: true })).toBeDisabled();
  expect((await saved(page)).answerSupportEvidence).toEqual(evidence.supportEvidence);
  await page.evaluate(() => window.renderTrainer('review-2'));
  await expect(page.locator('input[type=text]')).toHaveValue('');
  expect(await page.evaluate(() => window.trainerSaved['review-2'].evaluationState.supportState.translation_view_count)).toBe(0);
  expect(errors).toEqual([]);
});

test('Trainer Assessment freezes first wrong result before hints and allows no second check', async ({ page, context }) => {
  const errors = await setup(page, context, synthetic, { assessmentMode: true });
  await expect(page.getByRole('button', { name: 'Показать перевод', exact: true })).toHaveCount(0);
  await choose(page, 'B');
  await page.locator('input[type=text]').fill('wrong');
  await page.getByRole('button', { name: 'Проверить ответы', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ответ сохранён', exact: true })).toBeDisabled();
  await expect.poll(async () => (await saved(page)).supportState.hint_count).toBe(2);
  const results = await page.evaluate(() => window.trainerAnswers);
  expect(results).toHaveLength(1);
  expect(results[0].isCorrect).toBe(false);
  expect(results[0].supportEvidence.hint_count).toBe(0);
  expect(results[0].supportEvidence.capture_point).toBe('first_assessment_result');
  expect(errors).toEqual([]);
});

test('Trainer resumed Assessment and legacy saved state keep missing history unknown', async ({ page, context }) => {
  await setup(page, context, synthetic, { assessmentMode: true, supportHistoryUnknown: true });
  await choose(page, 'A');
  await page.locator('input[type=text]').fill('form');
  await page.getByRole('button', { name: 'Проверить ответы', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.trainerAnswers.length)).toBe(1);
  expect(await page.evaluate(() => window.trainerAnswers[0].supportEvidence.hint_count)).toBeNull();
  expect(await page.evaluate(() => window.trainerAnswers[0].supportEvidence.translation_view_count)).toBeNull();
  await page.evaluate(() => window.renderTrainer('legacy', true, true));
  await expect(page.locator('input[type=text]')).toHaveValue('');
  expect(await page.evaluate(() => window.trainerSaved.legacy.evaluationState.supportState.hint_count)).toBeNull();
});

test('Trainer repeated checks count displayed hints once per gap and exclude final check feedback', async ({ page, context }) => {
  const errors = await setup(page, context);
  await choose(page, 'B');
  await page.locator('input[type=text]').fill('wrong');
  for (const count of [2, 4]) {
    await page.getByRole('button', { name: 'Проверить ответы', exact: true }).click();
    await expect.poll(async () => (await saved(page)).supportState.hint_count).toBe(count);
  }
  await choose(page, 'A');
  await page.locator('input[type=text]').fill('form');
  await page.getByRole('button', { name: 'Проверить ответы', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.trainerAnswers.length)).toBe(1);
  const evidence = await page.evaluate(() => window.trainerAnswers[0]);
  expect(evidence.supportEvidence.hint_count).toBe(4);
  expect(evidence.supportEvidence.answer_attempt_count).toBe(3);
  expect(errors).toEqual([]);
});

// Explicit local pilot: real lesson material stays in ignored local/test-data.
if (process.env.LERNE_D14_SUPPORT === '1') {
  for (const id of [358365, 358375, 358385]) {
    test(`local D14 ${id}: authored slots and vocabulary remain static support`, async ({ page, context }, testInfo) => {
      const snapshot = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../local/test-data/lesson-qa/corrected.snapshot.json'), 'utf8'));
      const card = snapshot.cards.find(card => card.id === id);
      expect(card).toBeTruthy();
      await page.setViewportSize({ width: 375, height: 900 });
      const errors = await setup(page, context, card, { assessmentMode: true });
      const { parseClozeData } = await import('../../../app/src/utils/clozeParser.js');
      const { gaps } = parseClozeData(card, 'classic');
      for (const gap of gaps) {
        if (gap.mode === 'choice') await choose(page, gap.correctAnswer);
        else await page.locator('input[type=text]').fill(gap.correctAnswer);
      }
      await page.getByRole('button', { name: 'Проверить ответы', exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.trainerAnswers.length)).toBe(1);
      const evidence = await page.evaluate(() => window.trainerAnswers[0]);
      expect(evidence.isCorrect).toBe(true);
      expect(evidence.taskSupport).toMatchObject({ answer_options_present: id === 358365,
        sentence_frame_present: true, source_vocabulary_present: true, source_text_present: id === 358385 });
      expect(evidence.supportEvidence.tracking_complete).toBe(false);
      expect(evidence).not.toHaveProperty('independent');
      await page.screenshot({ path: testInfo.outputPath(`d14-${id}-375.png`), fullPage: true });
      expect(errors).toEqual([]);
    });
  }
}
