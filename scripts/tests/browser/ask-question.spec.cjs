const { test, expect } = require('@playwright/test');

const wordBank = { id: 1, deck_id: 1, queue: 'new',
  front: '@wordbank\nIch <<gap-1>> <<gap-2>> <<gap-3>>.\n@options\nhabe | heute | einen | kleinen',
  back: 'gap-1=habe\ngap-2=heute\ngap-3=einen' };

const regularCard = { id: 2, deck_id: 1, queue: 'new',
  front: 'Der Apfel', back: 'Яблоко' };

async function openStudy(page, context, card) {
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await context.addInitScript(() => {
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
  });
  
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const { pathname } = new URL(url);
    if (pathname === '/api/init') return route.fulfill({ json: {
      decks: [{ id: 1, name: 'Deck', target_language: 'de' }], folders: [], settings: {}, prompts: {}, user_settings: {},
      user_info: { user_id: 1, first_name: 'Test', is_guest: false },
    } });
    if (pathname === '/api/decks/1/cards') return route.fulfill({ json: [card] });
    if (pathname === `/api/study/card/${card.id}` || pathname === '/api/decks/1/next') return route.fulfill({ json: card });
    if (pathname === '/api/cards/ai-generate') {
      const postData = JSON.parse(route.request().postData());
      // Return a simulated AI answer
      if (postData.user_request === 'server_error') return route.fulfill({ status: 500, json: { error: 'Server error' } });
      if (postData.user_request === 'network_error') return route.abort('failed');
      
      // Delay for network testing
      if (postData.user_request === 'slow') await new Promise(r => setTimeout(r, 1000));
      
      return route.fulfill({ json: { context: `AI explanation for: ${postData.user_request}` } });
    }
    if (pathname === '/api/cards/save') {
      return route.fulfill({ json: { id: card.id, ...JSON.parse(route.request().postData()) } });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto('/?user_id=1');
  await expect(page.getByText('Deck', { exact: true }).first()).toBeVisible();
  
  await page.evaluate(async ({ card }) => {
    const { useUiStore } = await import('/src/store/useUiStore.js');
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    const deck = { id: 1, name: 'Deck', target_language: 'de' };
    useDeckStore.setState({ currentDeck: deck, cards: [card] });
    useSessionStore.setState({ card, studyHistory: [card], historyIndex: 0, isFlipped: true });
    useUiStore.getState().setView('study');
  }, { card });
}

test('Wordbank AI Question: successful request saves explanation to context and does not open editor', async ({ page, context }) => {
  await openStudy(page, context, wordBank);
  
  // Back of card should be visible
  const trigger = page.locator('.card-question-trigger');
  await expect(trigger).toBeVisible();
  
  await trigger.click();
  const input = page.locator('.card-question-input');
  await expect(input).toBeVisible();
  
  await input.fill('What does habe mean?');
  await page.locator('.card-question-button.primary').click();
  
  // Wait for AI response to appear
  const aiBlock = page.locator('.ai-explanation-block');
  await expect(aiBlock).toBeVisible();
  await expect(aiBlock).toContainText('AI explanation for: What does habe mean?');
  
  // Save to context
  await page.getByRole('button', { name: 'Сохранить в Контекст' }).click();
  
  // Verify it's saved locally
  const savedContext = await page.evaluate(async () => {
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    return useSessionStore.getState().card.context;
  });
  expect(savedContext).toContain('AI explanation for: What does habe mean?');
  
  // Verify editor is NOT opened
  const view = await page.evaluate(async () => {
    const { useUiStore } = await import('/src/store/useUiStore.js');
    return useUiStore.getState().view;
  });
  expect(view).toBe('study');
});

test('Wordbank AI Question: handles server error gracefully', async ({ page, context }) => {
  await openStudy(page, context, wordBank);
  await page.locator('.card-question-trigger').click();
  const input = page.locator('.card-question-input');
  await input.fill('server_error');
  await page.locator('.card-question-button.primary').click();
  
  // Error should be shown via toast, input should remain visible
  await expect(input).toBeVisible();
  await expect(input).toHaveValue('server_error');
  await expect(page.locator('.toast')).toContainText('Ошибка ИИ');
});

test('Wordbank AI Question: handles network error gracefully', async ({ page, context }) => {
  await openStudy(page, context, wordBank);
  await page.locator('.card-question-trigger').click();
  const input = page.locator('.card-question-input');
  await input.fill('network_error');
  await page.locator('.card-question-button.primary').click();
  
  await expect(input).toBeVisible();
  await expect(page.locator('.toast')).toContainText('Ошибка сети');
});

test('Regular Card AI Question: preserves existing functionality', async ({ page, context }) => {
  await openStudy(page, context, regularCard);
  await page.locator('.card-question-trigger').click();
  await page.locator('.card-question-input').fill('Test regular');
  await page.locator('.card-question-button.primary').click();
  
  await expect(page.locator('.ai-explanation-block')).toBeVisible();
  await expect(page.locator('.ai-explanation-block')).toContainText('AI explanation for: Test regular');
});
