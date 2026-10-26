const { test, expect } = require('./isolated-fixture.cjs');

const rootId = '11111111-1111-4111-8111-111111111111';
const replyId = '22222222-2222-4222-8222-222222222222';
const deck = { id: 1, name: 'Test deck', target_language: 'de', role: 'owner', is_learning: true,
  stats: { total: 1, new: 1, due: 0, learning: 0 } };
const card = { id: 10, deck_id: 1, front: 'Haus', back: 'дом' };
const root = { id: rootId, user_id: 1, sender: 'user', kind: 'suggestion', text: 'Fix typo',
  card_id: 10, thread_id: null, created_at: '2026-10-26T12:00:00', unread_count: 1, incoming_count: 1 };
const reply = { id: replyId, user_id: 1, sender: 'admin', kind: 'reply', text: 'Fixed',
  thread_id: rootId, read_at: null, created_at: '2026-10-26T12:01:00' };

async function setup(page, context, missingMigration = false) {
  const state = { reads: 0, writes: [] };
  await context.addInitScript(() => {
    for (const [key, value] of Object.entries({ native_language: 'ru', native_language_selected: 'true',
      lerne_has_selected_language: 'true', lerne_target_language: 'de', lerne_welcome_seen: 'true',
      lerne_tut_seen_welcome: 'true', lerne_user_id: '1' })) localStorage.setItem(key, value);
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, first_name: 'Test', is_guest: false }));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ access_token: 'fixture', refresh_token: 'fixture' }));
  });
  await page.route('**/api/**', route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/init') return route.fulfill({ json: { decks: [deck], folders: [], settings: {},
      prompts: {}, user_settings: {}, user_info: { user_id: 1, first_name: 'Test', is_guest: false } } });
    if (pathname === '/api/auth/v2/me') return route.fulfill({ json: { user_id: 1, first_name: 'Test', is_guest: false } });
    if (pathname === '/api/cards/duplicates') return route.fulfill({ json: [] });
    if (pathname === '/api/decks/1/cards') return route.fulfill({ json: [card] });
    if (pathname === '/api/messages') {
      state.reads++;
      return missingMigration ? route.fulfill({ status: 503, json: { detail: 'migration 90 required' } })
        : route.fulfill({ json: [{ ...root, unread_count: state.read ? 0 : 1 }] });
    }
    if (pathname === `/api/messages/${rootId}/card`) return route.fulfill({ json: { id: 10, deck_id: 1 } });
    if (pathname === `/api/messages/${rootId}`) return route.fulfill({ json: [root, { ...reply, read_at: state.read ? '2026-10-26T12:02:00' : null }] });
    if (pathname === `/api/messages/${rootId}/read`) {
      state.read = request.postDataJSON().read;
      return route.fulfill({ json: { status: 'ok' } });
    }
    if (pathname.startsWith('/api/messages/') && request.method() === 'PUT') {
      state.writes.push({ pathname, body: request.postDataJSON(), authorization: request.headers().authorization });
      return route.fulfill({ json: { id: pathname.split('/').pop() } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('/?user_id=1');
  await expect(page.locator('#deck-item-1')).toBeVisible();
  return state;
}

test('messages load on entry, mark read, reply with UUID, and open an existing card', async ({ page, context }) => {
  const state = await setup(page, context);
  await expect(page.getByRole('button', { name: /Мои сообщения, Непрочитанных сообщений: 1/ })).toBeVisible();
  await page.getByRole('button', { name: /Мои сообщения/ }).click();
  await expect(page.getByText('Fix typo')).toBeVisible();
  await page.getByRole('button', { name: /Предложение по карточке № 10/ }).click();
  await expect(page.getByText('Fixed')).toBeVisible();
  await expect.poll(() => state.read).toBe(true);
  await page.getByRole('button', { name: 'Отметить непрочитанным' }).click();
  await expect.poll(() => state.read).toBe(false);
  await page.getByRole('button', { name: 'Отметить прочитанным' }).click();
  await expect.poll(() => state.read).toBe(true);
  await page.getByLabel('Ответить').fill('Thanks');
  await page.getByRole('button', { name: 'Отправить' }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0].pathname).toMatch(/^\/api\/messages\/[0-9a-f-]{36}$/);
  expect(state.writes[0].body).toEqual({ text: 'Thanks', thread_id: rootId });
  expect(state.writes[0].authorization).toBe('Bearer fixture');
  await page.getByRole('button', { name: 'Открыть карточку' }).click();
  await expect(page.locator('#card-item-10')).toBeVisible();
  expect(state.reads).toBeGreaterThanOrEqual(2);
});

test('card action supplies card ID; missing migration leaves other screens usable', async ({ page, context }) => {
  await setup(page, context, true);
  await page.evaluate(async card => {
    const { useUiStore } = await import('/src/store/useUiStore.js');
    useUiStore.setState({ actionCard: card, isCardActionModalOpen: true });
  }, card);
  await page.getByRole('button', { name: 'Предложить улучшение' }).click();
  await expect(page.getByText('Карточка № 10')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('миграция базы данных №90');
  await expect(page.getByRole('button', { name: 'Отправить' })).toBeDisabled();
  await page.getByRole('button', { name: 'Назад' }).click();
  await page.getByRole('button', { name: 'Назад' }).click();
  await expect(page.locator('#deck-item-1')).toBeVisible();
});
