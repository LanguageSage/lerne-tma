const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, expect } = require('@playwright/test');

const fixture = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const { api, web, token, deck, deckName, ids, target, variant } = fixture;
assert.match(api, /^http:\/\/127\.0\.0\.1:\d+$/);
assert.match(web, /^http:\/\/127\.0\.0\.1:\d+$/);
const path = id => '/cards/' + id;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function device(browser, observe, onApiStart, onApiEnd) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  let offline = false;
  await context.addInitScript(token => {
    localStorage.setItem('native_language', 'en');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, first_name: 'Synthetic learner' }));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ account_id: 1, access_token: token }));
  }, token);
  await context.routeWebSocket('**/*', socket => socket.close());
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== web) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (offline) return route.abort('internetdisconnected');
    onApiStart?.();
    try {
      const response = await route.fetch({ url: api + url.pathname + url.search, maxRedirects: 0 });
      const headers = response.headers();
      const body = await response.body();
      observe?.({ path: url.pathname, method: route.request().method(), status: response.status(), bytes: body.length,
        sql: Number(headers['x-sync-sql']), decodes: Number(headers['x-sync-decodes']),
        ...(url.pathname === '/api/sync/v2/pull' && response.ok() && { snapshot: JSON.parse(body).status }) });
      await route.fulfill({ response, body });
    } finally {
      onApiEnd?.();
    }
  });
  return { context, setOffline: async value => { offline = value; await context.setOffline(value); } };
}

async function visibility(page, state) {
  await page.evaluate(state => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

async function cached(page, cardId) {
  return page.evaluate(async id => (await import('/src/services/localDb.js')).getLocalDb().cards.get(id), cardId);
}

async function request(page, method, url, body, options, server = false) {
  return page.evaluate(async ({ method, url, body, options, server }) => {
    const { default: api, networkApi } = await import('/src/services/api.js');
    const args = method === 'get' ? [options] : [body, options];
    return (await (server ? networkApi : api)[method](url, ...args)).data;
  }, { method, url, body, options, server });
}

function snapshotContent(prompt) {
  return { schema_version: 2, card: { type: 'standard', data: { prompt, answer: 'Synthetische Antwort' } } };
}

async function edit(page, current, prompt, local) {
  const content_v2 = structuredClone(current.content_v2);
  content_v2.card.data.prompt = prompt;
  return request(page, 'patch', path(current.id),
    { content_v2, revision: current.revision, request_id: crypto.randomUUID() }, local ? { offlineCardEdit: true } : undefined,
    !local);
}

(async () => {
  const browser = await chromium.launch();
  try {
    const responses = [], results = {};
    let inFlight = 0;
    const primary = await device(browser, response => responses.push(response), () => inFlight++, () => inFlight--);
    const page = await primary.context.newPage();
    await page.clock.install();
    const settle = async () => {
      let length;
      do {
        length = responses.length;
        await wait(450);
      } while (inFlight || length !== responses.length
        || await page.evaluate(async () => (await navigator.locks.query()).held.some(lock => lock.name === 'lerne-offline-sync')));
    };
    const phase = async (name, fn) => {
      const start = responses.length;
      const timings = await fn();
      await settle();
      const requests = responses.slice(start);
      results[name] = { ...timings, requests: requests.length,
        bytes: requests.reduce((sum, row) => sum + row.bytes, 0),
        sql: requests.reduce((sum, row) => sum + row.sql, 0),
        full: requests.filter(row => row.snapshot === 'success').length,
        partial: requests.filter(row => row.snapshot === 'progress_only').length,
        unchanged: requests.filter(row => row.snapshot === 'unchanged').length,
        pullDecodes: requests.filter(row => row.snapshot).reduce((sum, row) => sum + row.decodes, 0),
        paths: requests.map(row => row.method + ' ' + row.path + ' ' + row.status) };
      console.log(variant, name, JSON.stringify(results[name]));
    };
    const deckTile = page.locator('.deck-main-action').filter({ hasText: deckName });
    const intro = page.locator('.deck-intro-title');
    const listCard = page.locator('#card-item-' + ids[0]);
    const deckTitle = page.locator('.study-flow').getByText('Synthetische Frage ' + deck + '-0', { exact: true });
    const goToDecks = async () => page.evaluate(async () => (await import('/src/store/useUiStore.js')).useUiStore.getState().setView('decks'));
    const open = async (action, visible) => {
      await action.waitFor({ state: 'visible' });
      const before = performance.now();
      await action.evaluate(element => element.click());
      await visible.waitFor({ state: 'visible' });
      return Math.round(performance.now() - before);
    };

    await phase('cold', async () => {
      const start = performance.now();
      await page.goto(web);
      await deckTile.waitFor({ state: 'visible' });
      const libraryMs = Math.round(performance.now() - start);
      await expect.poll(async () => (await cached(page, ids[0]))?.id).toBe(ids[0]);
      return { libraryMs };
    });
    for (let i = 0; i < 4; i++) {
      await phase(i === 0 ? 'first-open' : 'repeat-' + i, async () => {
        await goToDecks();
        const deckMs = await open(deckTile, intro);
        const listMs = await open(page.locator('.deck-intro-btn-list'), listCard);
        const cardMs = await open(listCard, deckTitle.filter({ visible: true }).first());
        return { deckMs, listMs, cardMs };
      });
    }
    await phase('study', async () => {
      await goToDecks();
      await open(deckTile, intro);
      return { studyMs: await open(page.locator('.deck-intro-btn-start'), deckTitle.filter({ visible: true }).first()) };
    });
    for (let i = 0; i < 3; i++) {
      await phase(i === 0 ? 'trainer' : 'trainer-repeat-' + i, async () => {
        await goToDecks();
        await open(page.locator('.deck-main-action').filter({ hasText: fixture.trainer }), intro);
        return { trainerMs: await open(page.locator('.deck-intro-btn-start'), page.locator('.study-flow input').first()) };
      });
    }
    await goToDecks();
    await phase('idle-3m', async () => {
      for (let minute = 0; minute < 3; minute++) {
        await page.clock.runFor(60_000);
        await settle();
      }
    });
    await phase('resume-tab', async () => {
      await visibility(page, 'hidden');
      await page.clock.runFor(2000);
      await visibility(page, 'visible');
    });
    const tab = await primary.context.newPage();
    await phase('second-tab', async () => {
      await tab.goto(web);
      await tab.getByText(deckName, { exact: true }).first().waitFor();
    });
    await phase('two-tabs-idle-1m', async () => page.clock.runFor(60_000));
    await tab.close();
    await phase('clean-reconnect', async () => {
      await primary.setOffline(true);
      await page.waitForFunction(() => !navigator.onLine);
      await page.clock.runFor(2000);
      await primary.setOffline(false);
      await page.waitForFunction(() => navigator.onLine);
    });

    if (variant === 'after') {
      assert.equal(results['idle-3m'].full, 0);
      assert.equal(results['idle-3m'].unchanged + results['idle-3m'].partial, 3);
      assert.ok(results['idle-3m'].partial <= 1); // /next may have initialized progress on first open.
      assert.equal(results['idle-3m'].pullDecodes, 0);
      assert.equal(results['resume-tab'].full, 0);
      assert.equal(results['two-tabs-idle-1m'].full, 0);
      assert.equal(results['two-tabs-idle-1m'].unchanged, 1);
      assert.equal(results['clean-reconnect'].full, 0);
      assert.equal(results['clean-reconnect'].unchanged, 1);
      assert.equal(results['clean-reconnect'].paths.some(p => /^GET \/api\/(decks|folders) /.test(p)), false);
      console.log('PASS: three idle minutes, visibility return and shared tab without full downloads');

      const independent = await device(browser);
      const peer = await independent.context.newPage();
      await peer.goto(web);
      await peer.getByText(deckName, { exact: true }).first().waitFor();
      const fresh = id => request(peer, 'get', path(id), undefined, undefined, true);
      await phase('remote-progress', async () => {
        const cardId = ids[4];
        await request(peer, 'post', '/study/grade',
          { action_id: crypto.randomUUID(), card_id: cardId, deck_id: deck, grade: 2,
            return_next: false, include_progress: true }, undefined, true);
        const result = await page.evaluate(async () => {
          const { syncService } = await import('/src/services/syncService.js');
          await navigator.locks.request('lerne-offline-sync', () => {});
          return syncService.sync({ background: true });
        });
        assert.equal(result.pull_success, true, result.reason);
        await expect.poll(() => page.evaluate(async id => Boolean((await (await import('/src/services/localDb.js'))
          .getLocalDb().progress.get([id, 1]))?.last_reviewed), cardId)).toBe(true);
      });
      assert.equal(results['remote-progress'].partial, 1);
      assert.equal(results['remote-progress'].full, 0);
      assert.equal(results['remote-progress'].pullDecodes, 0);
      assert.equal(results['remote-progress'].paths.some(path => /^GET \/api\/(decks|folders)( |\/)/.test(path)), false);

      await phase('remote-edit', async () => {
        await edit(peer, await fresh(ids[0]), 'Changed on another device', false);
        await request(peer, 'post', '/decks/' + target + '/rename', { name: 'Renamed on another device' }, undefined, true);
        await visibility(page, 'hidden');
        await page.clock.runFor(2000);
        await visibility(page, 'visible');
        await expect.poll(async () => (await cached(page, ids[0])).content_v2.card.data.prompt).toBe('Changed on another device');
        await expect.poll(() => page.evaluate(async id => (await (await import('/src/services/localDb.js'))
          .getLocalDb().decks.get(id)).name, target)).toBe('Renamed on another device');
      });
      assert.equal(results['remote-edit'].full, 1);
      console.log('PASS: another browser profile changes a card and a deck; returning downloads them to Dexie');

      await phase('catalogue-update', async () => {
        await request(peer, 'post', '/__sync_fixture/publish', {}, undefined, true);
        await visibility(page, 'hidden');
        await page.clock.runFor(2000);
        await visibility(page, 'visible');
        await expect.poll(() => page.evaluate(async id => (await import('/src/store/useDeckStore.js'))
          .useDeckStore.getState().decks.find(deck => deck.id === id)?.has_updates, deck)).toBe(true);
      });
      assert.equal(results['catalogue-update'].full, 0);
      assert.equal(results['catalogue-update'].unchanged, 1);
      assert.equal(results['catalogue-update'].paths.some(p => /\/api\/decks\/\d+\/cards /.test(p)), false);

      let created;
      await phase('online-create-edit', async () => {
        const result = await request(page, 'post', '/cards/save', {
          deck_id: deck, content_v2: snapshotContent('Created online'), request_id: crypto.randomUUID(),
        });
        assert.ok(result.id > 0);
        created = await fresh(result.id);
        await edit(page, created, 'Edited online', false);
        created = await fresh(created.id);
        assert.equal(created.content_v2.card.data.prompt, 'Edited online');
      });

      let temporary;
      await phase('offline', async () => {
        await primary.setOffline(true);
        await page.waitForFunction(() => !navigator.onLine);
        const offlineCard = await request(page, 'get', '/study/card/' + ids[0]);
        assert.equal(offlineCard.content_v2.card.data.prompt, 'Changed on another device');
        const original = await cached(page, ids[1]);
        const moving = await cached(page, ids[2]);
        const deleting = await cached(page, ids[3]);
        const stale = await cached(page, ids[4]);
        temporary = (await request(page, 'post', '/cards/save', {
          deck_id: deck, content_v2: snapshotContent('Queued offline'), request_id: crypto.randomUUID(),
        })).id;
        assert.ok(temporary < 0);
        await edit(page, original, 'Edited offline', true);
        await edit(page, stale, 'Retain this conflicting offline draft', true);
        await request(page, 'post', '/cards/batch-move', {
          card_ids: [moving.id], target_deck_id: target, revisions: { [moving.id]: moving.revision }, request_id: crypto.randomUUID(),
        });
        await request(page, 'post', '/cards/batch-delete', {
          card_ids: [deleting.id], revisions: { [deleting.id]: deleting.revision }, request_id: crypto.randomUUID(),
        });
        await request(page, 'post', '/study/grade', { card_id: ids[0], deck_id: deck, grade: 2, return_next: false });
        await edit(peer, await fresh(stale.id), 'New server version during the outage', false);
      });
      assert.equal(results.offline.requests, 0);

      await phase('reconnect-and-deliver', async () => {
        await primary.setOffline(false);
        const alias = () => page.evaluate(async id => (await (await import('/src/services/localDb.js'))
          .getLocalDb().syncState.get('aliases'))?.mappings?.cards?.[id], temporary);
        await expect.poll(async () => (await alias()) || 0, { timeout: 20_000 }).toBeGreaterThan(0);
        await expect.poll(async () => (await fresh(ids[1])).content_v2.card.data.prompt).toBe('Edited offline');
        await expect.poll(async () => (await fresh(ids[2])).deck_id).toBe(target);
        await expect.poll(async () => (await cached(page, ids[4])).offline_edit?.status).toBe('conflict');
        assert.equal((await cached(page, ids[4])).content_v2.card.data.prompt, 'Retain this conflicting offline draft');
        assert.equal((await fresh(ids[4])).content_v2.card.data.prompt, 'New server version during the outage');
        assert.equal((await fresh(await alias())).content_v2.card.data.prompt, 'Queued offline');
        assert.equal((await request(peer, 'get', '/trash', undefined, undefined, true)).cards.some(card => card.id === ids[3]), true);
        await expect.poll(async () => Boolean((await request(peer, 'get', '/study/card/' + ids[0], undefined, undefined, true)).last_reviewed))
          .toBe(true);
        assert.equal(await cached(page, temporary), undefined);
      });
      assert.equal(results['reconnect-and-deliver'].full, 1);
      assert.ok(results['reconnect-and-deliver'].paths.filter(p => p === 'GET /api/decks 200').length <= 2,
        'Expected at most one recovery read and one refresh after the entire delivery batch');
      console.log('PASS: automatic reconnect delivers create, edit, move, delete and grade; conflicting draft survives');

      await phase('offline-mode-switch', async () => {
        await page.evaluate(() => localStorage.setItem('offline_mode', 'true'));
        const local = await request(page, 'get', '/decks/' + deck + '/cards');
        assert.ok(local.some(card => card.id === ids[1] && card.content_v2.card.data.prompt === 'Edited offline'));
        await page.evaluate(() => localStorage.removeItem('offline_mode'));
        await request(page, 'get', '/decks/' + deck + '/cards');
      });
      assert.equal(results['offline-mode-switch'].paths.filter(p => p.includes('/api/decks/' + deck + '/cards ')).length, 1);
      await phase('resume-pending-navigation', async () => {
        await primary.setOffline(true);
        await page.evaluate(async deckId => (await import('/src/store/useAuthStore.js')).useAuthStore.getState()
          .deferNavigation({ deckId, view: 'deck_intro' }), deck);
        await page.clock.runFor(2000);
        await primary.setOffline(false);
        await expect(intro).toHaveText(deckName, { timeout: 15_000 });
      });
      assert.equal(results['resume-pending-navigation'].paths.filter(p => p === 'GET /api/decks 200').length, 1);
      await independent.context.close();
    }
    fs.writeFileSync(fixture.output, JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
