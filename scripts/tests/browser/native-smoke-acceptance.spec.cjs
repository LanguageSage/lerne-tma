const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

const fixture = process.env.LERNE_SMOKE_FIXTURE
  ? JSON.parse(fs.readFileSync(process.env.LERNE_SMOKE_FIXTURE, 'utf8')) : null;

test.skip(!fixture, 'Explicit smoke fixture required');
if (fixture && [fixture.tma_origin, fixture.admin_origin].some(url => !/^http:\/\/127\.0\.0\.1:\d+$/.test(url))) {
  throw new Error('Loopback applications only');
}

test('real Chromium smoke test: creation, editing, study, SRS progress, media, and offline cycle', async ({ browser }, info) => {
  test.setTimeout(180000);

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  try {
    // 1. Strict loopback firewall: block any external network request
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === 'http://127.0.0.1:5199' || url.origin === fixture.admin_origin || url.origin === fixture.tma_origin) {
        return route.continue();
      }
      console.log('BLOCKED BY CLIENT:', route.request().url());
      return route.abort('blockedbyclient');
    });
    await context.routeWebSocket('**/*', () => {});

    // 2. Set up authenticated session in localStorage
    await context.addInitScript(fix => {
      const setBoth = (k, v) => {
        localStorage.setItem(k, v);
        localStorage.setItem('lerne_local:' + k, v);
      };
      setBoth('native_language', 'ru');
      setBoth('native_language_selected', 'true');
      setBoth('lerne_has_selected_language', 'true');
      setBoth('lerne_target_language', 'de');
      setBoth('lerne_user_profile', JSON.stringify({ user_id: fix.user_id, is_guest: false }));
      setBoth('lerne_user_id', String(fix.user_id));
      setBoth('lerne_auth_v2_session', JSON.stringify({
        account_id: fix.user_id,
        access_token: fix.token,
        refresh_token: 'dummy_refresh',
        client_session_id: 'smoke-test-session-1'
      }));
    }, fixture);

    // 3. Proxy /api requests to isolated TMA server
    let isOffline = false;
    await context.route('**/api/**', async route => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.origin === fixture.admin_origin) {
        return route.continue();
      }
      console.log('API ROUTE:', req.method(), req.url(), 'isOffline=' + isOffline);
      if (isOffline) {
        return route.abort('internetdisconnected');
      }
      try {
        const response = await route.fetch({ url: fixture.tma_origin + url.pathname + url.search });
        console.log('API ROUTE RESPONSE:', req.method(), url.pathname, response.status());
        return route.fulfill({ response });
      } catch (err) {
        console.log('API ROUTE FETCH ERROR:', req.method(), url.pathname, err.message);
        return route.abort('failed');
      }
    });

    const page = await context.newPage();
    page.on('console', msg => console.log('PAGE:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
    await page.goto('http://127.0.0.1:5199/');
    await expect.poll(() => page.evaluate(async () =>
      (await import('/src/store/useAuthStore.js')).useAuthStore.getState().isRestoring)).toBe(false);

    // Stop background knowledge sync to avoid background network noise
    await page.evaluate(async () => {
      (await import('/src/services/knowledgeSyncOrchestrator.js')).stopKnowledgeSync();
    });

    // Wait for initial background sync to settle
    await expect.poll(async () => {
      return await page.evaluate(async () => {
        const { syncService } = await import('/src/services/syncService.js');
        const res = await syncService.sync({ pendingNativeOnly: true });
        return res?.reason !== 'Already syncing';
      });
    }, { timeout: 30000, intervals: [1000] }).toBe(true);

    // --- STEP A: Card Creation (Создание) ---
    const createdCard = await page.evaluate(async ({ deck_id }) => {
      const { networkApi } = await import('/src/services/networkApi.js');
      const payload = {
        request_id: crypto.randomUUID(),
        deck_id,
        content_v2: {
          schema_version: 2,
          card: {
            id: null,
            type: 'standard',
            data: { prompt: 'Smoke Test Front', answer: 'Smoke Test Back' },
            explanation: 'Smoke test creation explanation',
            level: 'A1',
            topics: ['Smoke'],
            info: [],
            layout: null,
            image: null,
            metadata: {}
          }
        }
      };
      const res = await networkApi.post('/cards/save', payload);
      return res.data;
    }, { deck_id: fixture.deck_id });

    expect(createdCard).toBeTruthy();
    expect(createdCard.id).toBeGreaterThan(0);
    expect(createdCard.content_v2.card.data.prompt).toBe('Smoke Test Front');
    const createdId = createdCard.id;

    // --- STEP B: Card Editing (Редактирование) ---
    const editedCard = await page.evaluate(async ({ card }) => {
      const { networkApi } = await import('/src/services/networkApi.js');
      const updatedContent = JSON.parse(JSON.stringify(card.content_v2));
      updatedContent.card.explanation = 'Smoke edited explanation';
      updatedContent.card.data.prompt = 'Smoke Test Front (Edited)';
      const payload = {
        request_id: crypto.randomUUID(),
        revision: card.revision,
        content_v2: updatedContent
      };
      const res = await networkApi.patch('/cards/' + card.id, payload);
      return res.data;
    }, { card: createdCard });

    expect(editedCard.id).toBe(createdId);
    expect(editedCard.content_v2.card.explanation).toBe('Smoke edited explanation');
    expect(editedCard.content_v2.card.data.prompt).toBe('Smoke Test Front (Edited)');

    // --- STEP C: Learning & SRS Progress (Обучение и сохранение прогресса) ---
    const studyResult = await page.evaluate(async ({ card_id, deck_id }) => {
      const { networkApi } = await import('/src/services/networkApi.js');
      const studyCard = (await networkApi.get(`/study/card/${card_id}`)).data;
      const gradePayload = {
        action_id: crypto.randomUUID(),
        card_id,
        deck_id,
        grade: 3,
        return_next: false
      };
      const gradeRes = (await networkApi.post('/study/grade', gradePayload)).data;
      return { studyCard, gradeRes };
    }, { card_id: createdId, deck_id: fixture.deck_id });

    expect(studyResult.studyCard.id).toBe(createdId);
    expect(studyResult.gradeRes.status).toBe('success');

    // --- STEP D: Media Verification (Медиа) ---
    const mediaCheck = await page.evaluate(async sampleImg => {
      const { networkApi } = await import('/src/services/networkApi.js');
      try {
        if (sampleImg) {
          const res = await networkApi.get('/media/images/' + encodeURIComponent(sampleImg));
          return { status: 200, hasData: Boolean(res.data) };
        }
        const bgRes = await networkApi.get('/media/backgrounds');
        return { status: 200, hasData: true };
      } catch (err) {
        return { status: err.response?.status || 500, error: err.message };
      }
    }, fixture.sample_image);
    expect(mediaCheck.status).toBe(200);

    // --- STEP E: One Offline Cycle (Один офлайн-цикл) ---
    // 1. Go offline
    isOffline = true;
    await context.setOffline(true);
    await page.evaluate(() => {
      sessionStorage.setItem('offline-fixture', 'true');
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    });

    // 2. Save card offline using api proxy
    const offlineSaved = await page.evaluate(async ({ deck_id }) => {
      const api = (await import('/src/services/api.js')).default;
      const payload = {
        request_id: crypto.randomUUID(),
        deck_id,
        content_v2: {
          schema_version: 2,
          card: {
            id: null,
            type: 'quiz',
            data: {
              prompt: 'Offline Smoke Quiz?',
              back_note: 'Note',
              options: [
                { text: 'Correct Option', correct: true },
                { text: 'Wrong Option', correct: false }
              ]
            },
            explanation: 'Offline explanation',
            level: 'A2',
            topics: ['Offline'],
            info: [],
            layout: null,
            image: null,
            metadata: {}
          }
        }
      };
      const res = await api.post('/cards/save', payload);
      return res.data;
    }, { deck_id: fixture.deck_id });

    expect(offlineSaved.id).toBeLessThan(0); // temporary negative ID in offline mode
    const offlineTempId = offlineSaved.id;

    // Verify stored locally in Dexie
    const localState = await page.evaluate(async tempId => {
      const { prepareLocalDb } = await import('/src/services/localDb.js');
      const db = await prepareLocalDb();
      const localCard = await db.cards.get(tempId);
      const pendingOps = await db.syncState.where('key').startsWith('card-create-v2:').toArray();
      return { localCardExists: Boolean(localCard), pendingOpsCount: pendingOps.length };
    }, offlineTempId);
    expect(localState.localCardExists).toBe(true);
    expect(localState.pendingOpsCount).toBeGreaterThanOrEqual(1);

    // 3. Go online
    isOffline = false;
    await context.setOffline(false);
    await page.evaluate(() => {
      sessionStorage.removeItem('offline-fixture');
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    });

    // 4. Synchronize & wait for alias resolution (handles background sync or manual sync)
    let resolvedRealId = null;
    await expect.poll(async () => {
      const res = await page.evaluate(async tempId => {
        const { prepareLocalDb } = await import('/src/services/localDb.js');
        const db = await prepareLocalDb();
        const aliases = (await db.syncState.get('aliases'))?.mappings?.cards;
        if (aliases && aliases[tempId] > 0) {
          return { done: true, realId: aliases[tempId] };
        }
        const { syncService } = await import('/src/services/syncService.js');
        const syncRes = await syncService.sync({ pendingNativeOnly: true });
        const aliasesAfter = (await db.syncState.get('aliases'))?.mappings?.cards;
        if (aliasesAfter && aliasesAfter[tempId] > 0) {
          return { done: true, realId: aliasesAfter[tempId] };
        }
        return { done: false, syncRes, aliasesAfter };
      }, offlineTempId);
      if (res?.done) {
        resolvedRealId = res.realId;
        return true;
      }
      console.log('Poll waiting for sync...', JSON.stringify(res));
      return false;
    }, { timeout: 45000, intervals: [1000] }).toBe(true);

    expect(resolvedRealId).toBeTruthy();
    expect(resolvedRealId).toBeGreaterThan(0);

    // Take screenshot of TMA success
    await page.screenshot({ path: info.outputPath('smoke-tma-complete.png'), fullPage: true });

    // --- STEP F: Admin Console UI Verification ---
    const adminPage = await context.newPage();
    await adminPage.goto(fixture.admin_origin);
    await expect(adminPage.locator('body')).toContainText(/Lerne/i);

    // 1. Open Card Edit Modal through Admin UI
    await adminPage.evaluate(({ id, deck_id }) => {
      previewDeckId = String(deck_id);
      return openCardEditModal(id);
    }, { id: createdId, deck_id: fixture.deck_id });

    const modal = adminPage.locator('#modal-edit-card');
    await expect(modal).toBeVisible();
    await expect(adminPage.locator('#edit-card-prompt')).toHaveValue('Smoke Test Front (Edited)');
    await expect(adminPage.locator('#edit-card-explanation')).toHaveValue('Smoke edited explanation');

    // 2. Perform edit via Admin UI controls
    await adminPage.locator('#edit-card-prompt').fill('Smoke Test Front (Admin UI Saved)');
    await adminPage.locator('#edit-card-explanation').fill('Smoke explanation (Admin UI Saved)');
    await adminPage.locator('#edit-card-prompt').dispatchEvent('input');

    // 3. Save card through Admin UI button
    await modal.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(adminPage.locator('#edit-card-error')).toHaveText('');
    await expect(modal).toBeHidden();

    // Verify offline-created card through Admin API
    const adminOfflineCard = await adminPage.evaluate(async ({ id, deck_id }) => {
      const res = await fetch(`/api/admin/cards/${id}?deck_id=${deck_id}`);
      if (!res.ok) throw new Error('Admin fetch failed: ' + res.status);
      return res.json();
    }, { id: resolvedRealId, deck_id: fixture.deck_id });
    expect(adminOfflineCard.content_v2.card.data.prompt).toBe('Offline Smoke Quiz?');
    expect(adminOfflineCard.content_v2.card.type).toBe('quiz');

    await adminPage.screenshot({ path: info.outputPath('smoke-admin-ui-complete.png'), fullPage: true });
    await expect(adminPage.locator('#bulk-sync-copies, #regen-sync-copies')).toHaveCount(0);
    const listedUsers = await adminPage.evaluate(async () => (await fetch('/api/admin/users?limit=200')).json());
    expect(listedUsers.users.every(user => user.id !== null)).toBe(true);
    await expect(adminPage.getByText('User None', { exact: true })).toHaveCount(0);

    // Save outputs to file for python harness to assert in PostgreSQL
    fs.writeFileSync(fixture.output_results, JSON.stringify({
      createdId,
      resolvedRealId,
      success: true
    }));
  } finally {
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
  }
});
