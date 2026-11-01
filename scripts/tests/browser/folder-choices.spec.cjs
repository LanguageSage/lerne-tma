const { test, expect } = require('./isolated-fixture.cjs');

for (const [width, locale] of [[375, 'ru'], [1280, 'uk']]) {
  test(`deck folder choices retain cached roots and accessible subtrees at ${width}px (${locale})`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const profile = { user_id: 101, first_name: 'Test', is_guest: false };
    const folders = [
      { id: 10, name: 'Deutsch · Prüfungsvorbereitung', target_language: 'de' },
      { id: 11, name: 'Schreiben · Unterordner', parent_id: 10, target_language: 'de' },
      { id: 12, name: 'Доступная вложенная папка', parent_id: 999, target_language: 'de' },
    ];
    const deck = { id: 21, name: 'Test deck', folder_id: null, target_language: 'de', role: 'owner', stats: { total: 0, new: 0 } };
    const moves = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.addInitScript(({ profile, locale }) => {
      for (const [key, value] of Object.entries({ native_language: locale, native_language_selected: 'true',
        lerne_target_language: 'de', lerne_has_selected_language: 'true', lerne_welcome_seen: 'true',
        lerne_tut_seen_welcome: 'true',
        lerne_user_profile: JSON.stringify(profile),
        lerne_auth_v2_session: JSON.stringify({ access_token: 'fixture', refresh_token: 'fixture' }) })) localStorage.setItem(key, value);
    }, { profile, locale });
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/init') return route.fulfill({ json: { folders, decks: [deck], settings: {}, user_settings: {}, prompts: [], user_info: profile } });
      if (path === '/api/folders') return route.fulfill({ json: folders });
      if (path === '/api/decks') return route.fulfill({ json: [deck] });
      if (path === '/api/decks/21/move') {
        const body = route.request().postDataJSON();
        moves.push(body); deck.folder_id = body.folder_id;
        return route.fulfill({ json: { status: 'success' } });
      }
      if (path === '/api/auth/v2/me') return route.fulfill({ json: profile });
      return route.fulfill({ json: [] });
    });
    await page.goto('/');
    await expect(page.locator('#deck-item-21')).toBeVisible();
    await page.evaluate(async () => {
      const { useUiStore } = await import('/src/store/useUiStore.js');
      const { useDeckStore } = await import('/src/store/useDeckStore.js');
      const ui = useUiStore.getState();
      ui.setDeckToRename(useDeckStore.getState().decks[0]);
      ui.setIsRenameModalOpen(true);
    });
    const dialog = page.locator('.settings-modal');
    await expect(dialog.getByRole('heading')).toHaveText(locale === 'ru' ? 'Настройки колоды' : 'Налаштування колоди');
    const select = dialog.locator('select');
    await expect(select.locator('option')).toHaveCount(4);
    await select.selectOption('11');
    await expect(select).toHaveValue('11');
    await select.selectOption('12');
    await page.screenshot({ path: testInfo.outputPath(`folder-choices-${width}.png`) });
    await dialog.locator('.modal-footer-actions .btn-primary').click();
    await expect(dialog).toHaveCount(0);
    expect(moves).toEqual([{ folder_id: 12 }]);
    expect(errors).toEqual([]);
  });
}
