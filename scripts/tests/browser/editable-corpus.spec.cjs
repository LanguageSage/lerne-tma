const { test, expect } = require('./isolated-fixture.cjs');
const { writeFileSync, rmSync } = require('node:fs');
const { resolve, basename } = require('node:path');
const cards = require('./fixtures/editable-real-cards.json');

test('real editable corpus: detection, rendering, draft navigation and reset', async ({ page, context }, testInfo) => {
  const harness = resolve(__dirname, '../../../app', `.editable-corpus-${process.pid}.jsx`);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(() => localStorage.setItem('native_language', 'ru'));
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/editable-corpus', route => route.fulfill({ contentType: 'text/html', body: `
    <html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div>
    <script type="module">import R from '/@react-refresh'; R.injectIntoGlobalHook(window);
    window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>t=>t; window.__vite_plugin_react_preamble_installed__=true;</script>
    <script type="module" src="/${basename(harness)}"></script></body></html>` }));
  writeFileSync(harness, `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {StudyCard} from '/src/components/study/StudyCard.jsx';
    import {LanguageProvider} from '/src/i18n/i18nContext.jsx';
    import {detectExerciseType} from '/src/utils/exerciseDetector.js';
    import {parseEditableTextData} from '/src/utils/editableTextParser.js';
    import '/src/index.css'; import '/src/App.css';
    const cards = ${JSON.stringify(cards)};
    window.corpusResults = cards.map(c => ({id:c.id,type:detectExerciseType(c),data:parseEditableTextData(c)}));
    function Harness() {
      const [index,setIndex]=React.useState(0); const [flipped,flip]=React.useState(false);
      window.selectCard=setIndex;
      return <div className="app-container"><StudyCard card={{...cards[index],target_language:'de'}}
        isFlipped={flipped} onFlip={flip} historyIndex={index} audioControls={{}} styles={{cardFont:'Inter'}} /></div>;
    }
    createRoot(document.getElementById('root')).render(<LanguageProvider><Harness /></LanguageProvider>);
  `);
  try {
    await page.setViewportSize({ width: 375, height: 844 });
    await page.goto('/editable-corpus');
    const field = page.getByRole('textbox', { name: 'Исправленный текст' });
    await expect(field).toBeVisible();
    for (let i = 0; i < cards.length; i++) {
      await page.evaluate(index => window.selectCard(index), i);
      await expect(field).toHaveValue(cards[i].front.split('@edit\n')[1]);
      await expect(page.locator('.card-front')).not.toContainText('@edit');
    }
    const parsed = await page.evaluate(() => window.corpusResults);
    expect(parsed.every(c => c.type === 'editable_text' && c.data?.correctText && c.data?.sourceText)).toBe(true);
    await page.evaluate(() => window.selectCard(0));
    await field.fill('Draft with changed punctuation, and words.');
    await page.evaluate(() => window.selectCard(1));
    await page.evaluate(() => window.selectCard(0));
    await expect(field).toHaveValue('Draft with changed punctuation, and words.');
    await field.focus();
    await page.screenshot({ path: testInfo.outputPath('editable-focused-mobile.png'), fullPage: true });
    await page.getByRole('button', { name: 'Сбросить изменения' }).click();
    await expect(field).toHaveValue(cards[0].front.split('@edit\n')[1]);
    expect(errors).toEqual([]);
  } finally { rmSync(harness, { force: true }); }
});
