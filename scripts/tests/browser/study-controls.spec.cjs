const { test, expect } = require('./isolated-fixture.cjs');
const { devices } = require('@playwright/test');
const androidDevice = { ...devices['Pixel 7'] };
delete androidDevice.defaultBrowserType;

const deck = { id: 1, name: 'Controls', target_language: 'de', stats: { total: 3, new: 3, due: 0, learning: 0 } };
const cards = [1, 2, 3].map(id => ({ id, deck_id: 1, position: id, front: `Beispielkarte ${id}`, back: `Ответ ${id}`, queue: 'new' }));
const types = {
  theory: { front: '@theory\nWarum steht das Verb am Ende?', back: 'Weil es ein Nebensatz ist.' },
  trainer: { front: 'Ich [[lerne]] Deutsch.', back: 'Я учу немецкий.' },
  wordbank: { front: '@wordbank\nIch <<gap-1>> Deutsch.\n@options\nlerne | spreche', back: 'gap-1=lerne' },
  puzzle: { front: '@puzzle\nIch lerne heute Deutsch.', back: 'Я сегодня учу немецкий.' },
  quiz: { front: 'Wähle\n- Falsch\n* Richtig\n- Auch falsch', back: 'Richtig' },
  match: { front: '@match\nA => eins\nB => zwei', back: 'Paare' },
  free: { front: '@free\nSchreibe einen Satz.', back: 'Ich lerne Deutsch.' },
};

async function setup(page, context, first = {}, locale = 'ru') {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(locale => {
    localStorage.setItem('native_language', locale);
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ access_token: 'test', refresh_token: 'test' }));
    window.gradeTones = 0;
    window.AudioContext = class {
      state = 'running'; currentTime = 0; destination = {};
      createOscillator() { return { frequency: { setValueAtTime() {} }, connect() {}, disconnect() {}, start() { window.gradeTones++; }, stop() {} }; }
      createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
      resume() { return Promise.resolve(); }
    };
    HTMLMediaElement.prototype.play = () => Promise.resolve();
  }, locale);
  const sample = [{ ...cards[0], ...first }, ...cards.slice(1)];
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/init') return route.fulfill({ json: { decks: [deck], folders: [], settings: {}, prompts: {}, user_settings: {}, user_info: { user_id: 1, is_guest: false } } });
    if (pathname === '/api/cards/duplicates') return route.fulfill({ json: [] });
    if (pathname.endsWith('/cards')) return route.fulfill({ json: sample });
    if (pathname.startsWith('/api/study/card/')) return route.fulfill({ json: sample.find(card => card.id === Number(pathname.split('/').pop())) });
    return route.fulfill({ json: {} });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?user_id=1');
  await expect(page.locator('.view-decks')).toBeVisible();
  await page.addStyleTag({ content: '.nav-arrow-btn { animation: none !important; }' });
  await page.evaluate(async ({ deck, sample }) => {
    window.sessionStore = (await import('/src/store/useSessionStore.js')).useSessionStore;
    window.settingsStore = (await import('/src/store/useSettingsStore.js')).useSettingsStore;
    window.uiStore = (await import('/src/store/useUiStore.js')).useUiStore;
    window.deckStore = (await import('/src/store/useDeckStore.js')).useDeckStore;
    deckStore.setState({ currentDeck: deck, deckCards: sample });
    sessionStore.getState().resetSession();
    sessionStore.getState().addToHistory(sample[0]);
    settingsStore.setState({ autoPlay: false, autoShow: false, studyMode: 'classic', speechFollowupEnabled: false });
    uiStore.getState().setView('study');
  }, { deck, sample });
  await expect(page.locator('.card-front')).toBeVisible();
  return errors;
}

async function stroke(page, dx, dy, selector = '.card-inner', extra = {}) {
  await page.locator(selector).first().scrollIntoViewIfNeeded();
  const box = await page.locator(selector).first().boundingBox();
  const start = selector === '.card-inner'
    ? { x: dx < 0 ? box.x + box.width - 6 : box.x + 6, y: dy ? box.y + (dy < 0 ? 180 : 35) : box.y + box.height - 6 }
    : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const timestamp = Date.now() / 1000;
  const duration = extra.duration ?? 0.2;
  if (await page.evaluate(() => navigator.maxTouchPoints > 0)) {
    const client = await page.context().newCDPSession(page);
    const point = (x, y, id = 1) => ({ x, y, id, radiusX: 2, radiusY: 2 });
    // Supply the device event clock so a slow driver/trace cannot turn a short
    // physical stroke into a long press. These remain native browser touch events.
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', timestamp, touchPoints: [point(start.x, start.y)] });
    if (extra.multitouch) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', timestamp: timestamp + 0.03, touchPoints: [point(start.x, start.y), point(start.x + 30, start.y + 30, 2)] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', timestamp: timestamp + 0.15, touchPoints: [] });
      await client.detach();
      return;
    }
    for (let step = 1; step <= 3; step++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', timestamp: timestamp + step * duration / 4, touchPoints: [point(start.x + dx * step / 3, start.y + dy * step / 3)] });
    }
    await client.send('Input.dispatchTouchEvent', { type: extra.cancel ? 'touchCancel' : 'touchEnd', timestamp: timestamp + duration, touchPoints: [] });
    await client.detach();
  } else {
    const client = await page.context().newCDPSession(page);
    const button = extra.button || 'left';
    const buttons = button === 'left' ? 1 : 2;
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start, timestamp });
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, timestamp, button, buttons, clickCount: 1 });
    for (let step = 1; step <= 3; step++) await client.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: start.x + dx * step / 3, y: start.y + dy * step / 3, button, buttons, timestamp: timestamp + step * duration / 4,
    });
    if (extra.cancel) await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: start.x + dx, y: start.y + dy, button, buttons: 0, clickCount: 1, timestamp: timestamp + duration });
    await client.detach();
  }
}

async function assertCard(page, id, flipped = false) {
  await expect.poll(() => page.evaluate(() => [sessionStore.getState().card?.id, sessionStore.getState().isFlipped])).toEqual([id, flipped]);
  await expect(page.locator(flipped ? '.card-back' : '.card-front')).toBeVisible();
}

async function reorderPuzzle(page) {
  await page.locator('.btn-puzzle-chip:enabled').first().click();
  await page.locator('.btn-puzzle-chip:enabled').first().click();
  const chips = page.locator('.puzzle-slot-chip');
  const before = await chips.evaluateAll(nodes => nodes.map(node => node.dataset.id));
  const from = await chips.nth(0).boundingBox();
  const to = await chips.nth(1).boundingBox();
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const end = { x: to.x + to.width - 3, y: to.y + to.height / 2 };
  if (await page.evaluate(() => navigator.maxTouchPoints > 0)) {
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    for (let step = 1; step <= 5; step++) await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: start.x + (end.x - start.x) * step / 5, y: start.y + (end.y - start.y) * step / 5 }],
    });
    await expect(chips.first()).toHaveClass(/dragging/);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await client.detach();
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await expect(chips.first()).toHaveClass(/dragging/);
    await page.mouse.up();
  }
  await expect.poll(() => chips.evaluateAll(nodes => nodes.map(node => node.dataset.id))).toEqual(before.reverse());
  await assertCard(page, 1);
}

for (const device of ['desktop', 'Android']) {
  test.describe(device, () => {
    if (device === 'Android') test.use(androidDevice);
    const activate = locator => device === 'Android' ? locator.tap() : locator.click();

    test('tap/click, four swipe directions, buttons and deliberate-stroke guards', async ({ page, context }) => {
      const errors = await setup(page, context);
      await activate(page.locator('.text-front'));
      await assertCard(page, 1);
      await stroke(page, 0, -110);
      await assertCard(page, 1, true);
      await activate(page.locator('.text-back'));
      await assertCard(page, 1, true);
      await stroke(page, 0, 110);
      await assertCard(page, 1);
      await stroke(page, -130, 0);
      await assertCard(page, 2);
      await stroke(page, 130, 0);
      await assertCard(page, 1);
      await stroke(page, -25, 0);
      await stroke(page, -90, -90);
      await stroke(page, -130, 0, '.card-inner', { duration: 1 });
      await stroke(page, -130, 0, '.card-inner', { duration: 0.02 });
      await stroke(page, -130, 0, '.card-inner', { cancel: true });
      if (device === 'Android') await stroke(page, -130, 0, '.card-inner', { multitouch: true });
      await assertCard(page, 1);
      if (device === 'desktop') {
        await stroke(page, -130, 0, '.card-inner', { button: 'right' });
        await assertCard(page, 1);
      }
      await activate(page.getByTitle('Следующая карточка', { exact: true }));
      await assertCard(page, 2);
      await activate(page.getByTitle('Предыдущая карточка', { exact: true }));
      await assertCard(page, 1);
      await activate(page.getByRole('button', { name: 'Перевернуть карточку', exact: true }));
      await assertCard(page, 1, true);
      expect(errors).toEqual([]);
    });

    for (const [type, card] of Object.entries(types)) {
      test(`${type}: common navigation preserves exercise controls`, async ({ page, context }) => {
        await setup(page, context, card);
        const interactive = page.locator('.interactive-mode-container button:enabled, .interactive-mode-container input, .interactive-mode-container textarea').first();
        if (await interactive.count()) {
          await stroke(page, -100, 0, '.interactive-mode-container');
          await assertCard(page, 1);
          if (type === 'trainer' || type === 'free') {
            const input = page.locator(type === 'free' ? 'textarea' : '.trainer-input-gap input').first();
            await input.fill('Ich lerne');
            await input.press('Space');
            await input.press('ArrowLeft');
            await input.press('ArrowRight');
            await assertCard(page, 1);
            await expect(input).toHaveValue('Ich lerne ');
          } else if (type === 'wordbank') {
            await page.locator('.word-bank-option').filter({ hasText: 'lerne' }).click();
            await expect(page.locator('.word-bank-gap')).toContainText('lerne');
            await assertCard(page, 1);
          } else if (type === 'puzzle') {
            const chip = page.locator('.btn-puzzle-chip').first();
            await stroke(page, -100, 0, '.btn-puzzle-chip');
            await assertCard(page, 1);
            await chip.click();
            await expect(page.locator('.puzzle-slot-chip')).toHaveCount(1);
            await page.locator('.puzzle-slot-chip').click();
            await reorderPuzzle(page);
          } else {
            await interactive.click();
            await assertCard(page, 1);
          }
        }
        await page.locator('.card-inner').click({ position: { x: 12, y: 20 } });
        if (type === 'free') {
          await page.keyboard.press('Space');
          await stroke(page, 0, -110);
          await assertCard(page, 1); // Preserve the existing answer-reveal policy.
        } else {
          await page.keyboard.press('Space');
          await assertCard(page, 1, true);
          await page.keyboard.press('Space');
          await assertCard(page, 1);
        }
        await stroke(page, -130, 0);
        await assertCard(page, 2);
      });
    }

    test('grade confirmation waits for success, rejects double activation, respects mute', async ({ page, context }, testInfo) => {
      await setup(page, context);
      const pending = [];
      await page.route('**/api/study/grade', route => pending.push(route));
      await activate(page.locator('.btn-grade.grade-2'));
      await page.locator('.btn-grade.grade-2').dispatchEvent('click', { detail: 1 });
      await assertCard(page, 2);
      await expect.poll(() => pending.length).toBe(1);
      await expect(page.locator('.study-grade-confirmation')).toHaveCount(0);
      expect(await page.evaluate(() => gradeTones)).toBe(0);
      await pending[0].fulfill({ json: { status: 'success' } });
      await expect(page.locator('.study-grade-confirmation')).toContainText('№1 сохранена');
      expect(await page.evaluate(() => gradeTones)).toBe(1);
      await page.screenshot({ path: testInfo.outputPath(`grade-saved-${device}.png`), fullPage: true });
      await expect(page.locator('.study-grade-confirmation')).toBeEmpty();
      await page.evaluate(() => settingsStore.getState().setGradeSoundEnabled(false));
      await page.locator('.btn-grade.grade-2').click();
      await expect.poll(() => pending.length).toBe(2);
      await pending[1].fulfill({ json: { status: 'success' } });
      await expect(page.locator('.study-grade-confirmation')).toContainText('№2 сохранена');
      expect(await page.evaluate(() => gradeTones)).toBe(1);
    });

    test('text retains native scrolling and no card command is issued', async ({ page, context }) => {
      await setup(page, context, { front: 'Lange deutsche Sätze über Erfahrungen und Meinungen.\n'.repeat(50) });
      await page.locator('.text-front').evaluate(node => {
        Object.assign(node.style, { maxHeight: '160px', overflow: 'auto', fontSize: '20px' });
      });
      if (device === 'Android') await stroke(page, 0, -100, '.text-front');
      else {
        await page.locator('.text-front').hover();
        await page.mouse.wheel(0, 170);
      }
      await expect.poll(() => page.locator('.text-front').evaluate(node => node.scrollTop)).toBeGreaterThan(0);
      await assertCard(page, 1);
    });
  });
}

test('keyboard, real text selection/copy, held keys and modal retain native behavior', async ({ page, context }) => {
  await setup(page, context);
  await page.keyboard.press('Space');
  await assertCard(page, 1, true);
  await page.keyboard.down('Space');
  await page.keyboard.down('Space'); // repeat must not flip again
  await assertCard(page, 1);
  await page.keyboard.up('Space');
  await page.keyboard.press('ArrowLeft');
  await assertCard(page, 1); // Same disabled boundary as the Previous button.
  await page.keyboard.press('ArrowRight');
  await assertCard(page, 2);
  await page.keyboard.press('ArrowLeft');
  await assertCard(page, 1);
  await page.evaluate(() => {
    document.addEventListener('copy', event => { window.copiedText = !event.defaultPrevented && getSelection().toString(); });
  });
  const text = await page.locator('.karaoke-text').boundingBox();
  await page.mouse.move(text.x + 1, text.y + text.height / 2);
  await page.mouse.down();
  await page.mouse.move(text.x + text.width - 1, text.y + text.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press('Control+c');
  expect(await page.evaluate(() => window.copiedText)).toContain('Beispielkarte');
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => getSelection().toString())).toBe('Beispielkarte 1');
  await assertCard(page, 1);
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.evaluate(() => uiStore.getState().openSettings('general'));
  await expect(page.locator('.settings-overlay')).toBeVisible();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  await assertCard(page, 1);
});

for (const response of ['failure', 'invalid', 'reset', 'deck', 'view', 'user']) {
  test(`${response} grade never signals success`, async ({ page, context }) => {
    await setup(page, context);
    let pending;
    await page.route('**/api/study/grade', route => { pending = route; });
    await page.locator('.btn-grade.grade-2').click();
    await expect.poll(() => Boolean(pending)).toBe(true);
    await page.evaluate(response => {
      if (response === 'reset') sessionStore.getState().resetSession();
      if (response === 'deck') deckStore.setState({ currentDeck: { id: 99 } });
      if (response === 'view') uiStore.getState().setView('cards');
      if (response === 'user') localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 2, is_guest: false }));
    }, response);
    await pending.fulfill(response === 'failure'
      ? { status: 500, json: { detail: 'Save failed' } }
      : { json: response === 'invalid' ? {} : { status: 'success' } });
    await expect.poll(() => page.evaluate(() => Object.keys(sessionStore.getState().pendingGrades).length)).toBe(0);
    await expect(page.locator('.study-grade-confirmation')).toHaveCount(0);
    expect(await page.evaluate(() => gradeTones)).toBe(0);
    if (['failure', 'invalid'].includes(response)) await expect(page.locator('.study-grade-error')).toBeVisible();
  });
}

test('sound preference is accessible, saved locally and included in settings sync', async ({ page, context }) => {
  await setup(page, context, {}, 'en');
  await page.evaluate(() => uiStore.getState().openSettings('general'));
  const toggle = page.getByRole('checkbox', { name: 'Grade confirmation sound' });
  await expect(toggle).toBeChecked();
  const saved = page.waitForRequest(request => request.url().endsWith('/user/settings') && request.method() === 'POST' && request.postDataJSON()?.gradeSoundEnabled === false);
  await toggle.locator('..').click();
  await expect(toggle).not.toBeChecked();
  expect((await saved).postDataJSON().gradeSoundEnabled).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('lerne_grade_sound_enabled'))).toBe('false');
  await page.reload();
  expect(await page.evaluate(async () => (await import('/src/store/useSettingsStore.js')).useSettingsStore.getState().gradeSoundEnabled)).toBe(false);
  await page.evaluate(async () => (await import('/src/store/useSettingsStore.js')).useSettingsStore.getState().syncUserSettingsFromServer({ gradeSoundEnabled: true }));
  expect(await page.evaluate(() => localStorage.getItem('lerne_grade_sound_enabled'))).toBe('true');
});

test('offline acknowledgement follows the atomic local review write exactly once', async ({ page, context }) => {
  await setup(page, context);
  await page.evaluate(async ({ deck, cards }) => {
    const { prepareLocalDb } = await import('/src/services/localDb.js');
    const db = await prepareLocalDb();
    await db.decks.put({ ...deck, user_id: 1 });
    await db.cards.bulkPut(cards.map(card => ({ ...card, front_text: card.front, back_text: card.back })));
    localStorage.setItem('offline_mode', 'true');
  }, { deck, cards });
  await page.locator('.btn-grade.grade-2').click();
  await expect(page.locator('.study-grade-confirmation')).toContainText('№1 сохранена');
  const saved = await page.evaluate(async () => {
    const db = (await import('/src/services/localDb.js')).getLocalDb();
    return { progress: await db.progress.get([1, 1]), reviews: (await db.syncState.toArray()).filter(item => item.key.startsWith('review:')) };
  });
  expect(saved.progress.last_reviewed).toBeTruthy();
  expect(saved.reviews).toHaveLength(1);
  expect(await page.evaluate(() => gradeTones)).toBe(1);
});

for (const width of [320, 375, 430, 768, 1280]) {
  test(`grade feedback and control hints fit ${width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page, context, {}, width === 430 ? 'uk' : 'ru');
    await page.route('**/api/study/grade', route => route.fulfill({ json: { status: 'success' } }));
    await page.locator('.btn-grade.grade-2').click();
    await expect(page.locator('.study-grade-confirmation span')).toBeVisible();
    const geometry = await page.evaluate(() => {
      const confirmation = document.querySelector('.study-grade-confirmation').getBoundingClientRect();
      const hint = document.querySelector('.study-card-controls-hint').getBoundingClientRect();
      return { fits: document.documentElement.scrollWidth <= innerWidth, confirmationFits: confirmation.left >= 0 && confirmation.right <= innerWidth, hintFits: hint.left >= 0 && hint.right <= innerWidth };
    });
    expect(geometry).toEqual({ fits: true, confirmationFits: true, hintFits: true });
    await page.screenshot({ path: testInfo.outputPath(`feedback-${width}.png`), fullPage: true });
  });
}

for (const extended of [false, true]) {
  test(`held Enter cannot grade the successor (extended=${extended})`, async ({ page, context }) => {
    await setup(page, context);
    await page.evaluate(extended => settingsStore.setState({ srsExtendedGrades: extended }), extended);
    const pending = [];
    await page.route('**/api/study/grade', route => pending.push(route));
    await page.locator('.btn-grade').first().focus();
    await page.keyboard.down('Enter');
    await assertCard(page, 2);
    await page.waitForTimeout(400); // Beyond the double-tap guard; this is a held key.
    await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    await assertCard(page, 2);
    expect(pending).toHaveLength(1);
    await pending[0].fulfill({ json: { status: 'success' } });
    await expect(page.locator('.study-grade-confirmation')).toContainText('№1 сохранена');
  });
}
