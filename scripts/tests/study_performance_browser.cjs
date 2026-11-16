const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fixture = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

(async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.addInitScript(token => {
      localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ access_token: token }));
      localStorage.setItem('lerne_user_id', '1');
      localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
      localStorage.setItem('native_language', 'en');
    }, fixture.token);
    const page = await context.newPage();
    page.on('pageerror', error => console.error(error));
    await page.goto(fixture.web + '/knowledge-harness.html');
    await page.evaluate(async () => {
      await import('/src/index.css');
      const React = (await import('/node_modules/.vite/deps/react.js')).default;
      const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
      const { LanguageProvider } = await import('/src/i18n/i18nContext.jsx');
      const { StudyView } = await import('/src/components/study/StudyView.jsx');
      const { useStudyNavigation } = await import('/src/hooks/useStudyNavigation.js');
      const { useStudySession } = await import('/src/hooks/useStudySession.js');
      window.decks = (await import('/src/store/useDeckStore.js')).useDeckStore;
      window.session = (await import('/src/store/useSessionStore.js')).useSessionStore;
      window.ui = (await import('/src/store/useUiStore.js')).useUiStore;
      (await import('/src/store/useSettingsStore.js')).useSettingsStore.setState({ autoPlay: false, gradeSoundEnabled: false });
      const database = (await import('/src/services/localDb.js')).getLocalDb();
      const api = (await import('/src/services/api.js')).default;
      const { data } = await api.get('/sync/v2/status');
      await database.syncState.put({ key: 'serverGeneration', generation: data.server_generation });
      createRoot(document.getElementById('harness')).render(React.createElement(LanguageProvider, null,
        React.createElement(function Harness() {
          window.navigation = useStudyNavigation();
          window.study = useStudySession();
          const view = ui(state => state.view);
          return view === 'study' ? React.createElement(StudyView) : null;
        })));
    });
    await page.waitForFunction(() => window.navigation);
    const results = [];
    let responses = [];
    page.on('response', response => {
      if (!response.url().includes('/api/') || response.url().includes('/__study_phase/')) return;
      responses.push((async () => ({ path: new URL(response.url()).pathname, status: response.status(),
        sql: Number((await response.allHeaders())['x-study-sql'] || 0), bytes: (await response.body()).length }))());
    });
    for (const run of ['cold', 'repeat']) {
      responses = [];
      await page.evaluate(run => fetch(`/api/__study_phase/${run}`), run);
      await page.evaluate(deck => { window.started = performance.now(); window.opening = navigation.startStudy(deck); }, fixture.deck);
      await page.waitForFunction(() => session.getState().card !== null);
      await page.getByText('Synthetischer deutscher Beispielsatz.', { exact: true }).first().waitFor();
      const ms = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - started)))));
      await page.evaluate(() => opening);
      await page.waitForFunction(() => decks.getState().deckCards.length === 1000 && !decks.getState().cardsLoading);
      await page.evaluate(async () => {
        const { prepareDeckKnowledge } = await import('/src/services/knowledgeContentService.js');
        // Join a pending load if any, otherwise only flush already queued work.
        const { waitForDeckKnowledge } = await import('/src/services/knowledgeContentService.js');
        if (waitForDeckKnowledge) await waitForDeckKnowledge((await import('/src/services/localDb.js')).getLocalDb(), decks.getState().currentDeck.id);
        void prepareDeckKnowledge;
      }).catch(() => {}); // Baseline exports no wait helper.
      await page.waitForLoadState('networkidle');
      results.push({ run, firstCardMs: Math.round(ms), requests: await Promise.all(responses) });
    }
    responses = [];
    await page.evaluate(() => fetch('/api/__study_phase/10-grades-back-next'));
    const started = Date.now();
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => study.submitGrade(2));
      await page.waitForFunction(() => Object.keys(session.getState().pendingGrades).length === 0);
      await page.evaluate(() => study.goBack());
      await page.evaluate(() => study.goNext());
    }
    await page.waitForFunction(async () => (await import('/src/hooks/useStudySession.js')).studyRefreshCount() === 0);
    await page.waitForLoadState('networkidle');
    const attempts = await page.evaluate(async () => (await import('/src/services/localDb.js')).getLocalDb().knowledge_attempt_outbox.count());
    assert.equal(attempts, 10);
    results.push({ run: '10-grades-back-next', ms: Date.now() - started, requests: await Promise.all(responses), attempts });
    fs.writeFileSync(fixture.output, JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
