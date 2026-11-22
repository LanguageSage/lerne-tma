const { test, expect } = require('./isolated-fixture.cjs');

test('grade buttons localize scheduled and forced previews without changing the intervals', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.route('**/grade-interval-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: '<div id="root"></div>',
  }));
  await page.goto('/grade-interval-fixture');
  await page.clock.setFixedTime(new Date('2026-10-16T00:00:00Z'));
  await page.evaluate(async () => {
    const { GradeButtons } = await import('/src/components/study/GradeButtons.jsx');
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const { getNextIntervals } = await import('/src/utils/srsEngine.js');
    const { setInterfaceLanguage } = await import('/src/i18n/locale.js');
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    await import('/src/components/StudyView.css');
    const root = createRoot(document.getElementById('root'));
    const progress = { queue: 'review', interval: 40, ease_factor: 2.5, repetitions: 3, lapses: 0,
      last_reviewed: '2026-10-13T00:00:00Z', next_review: '2026-11-22T00:00:00Z' };
    // Scheduled API preview for this progress, from api.srs.get_next_intervals.
    const extended = ['5 мин', '23 дн', '1.5 мес', '2.4 мес', '3.3 мес', '3.8 мес', '4.3 мес', '6.3 мес'];
    const scheduled = { ...progress, intervals: {
      0: extended[0], 1: extended[2], 2: extended[4], 3: extended[6], extended,
    } };
    const forced = { ...progress, _studyContext: 'forced' };
    setInterfaceLanguage('en');
    const cached = { ...forced, intervals: getNextIntervals(forced, 'forced') };
    useSettingsStore.setState({ gradeSoundEnabled: false, gradingCollapsed: false, srsExtendedGrades: false });
    window.gradeFixture = {
      setInterfaceLanguage,
      expectedForced: () => getNextIntervals(forced, 'forced'),
      extended: value => useSettingsStore.setState({ srsExtendedGrades: value }),
      render: (source, loading = false) => root.render(React.createElement(GradeButtons, {
        card: { scheduled, cached, forced }[source], loading, onGrade() {},
      })),
    };
  });

  const labels = page.locator('.btn-grade .grade-val');
  const buttons = page.locator('.btn-grade');
  const scheduled = {
    ru: ['5 мин', '23 дн', '1.5 мес', '2.4 мес', '3.3 мес', '3.8 мес', '4.3 мес', '6.3 мес'],
    en: ['5 min', '23 d', '1.5 mo', '2.4 mo', '3.3 mo', '3.8 mo', '4.3 mo', '6.3 mo'],
    uk: ['5 хв', '23 дн.', '1.5 міс.', '2.4 міс.', '3.3 міс.', '3.8 міс.', '4.3 міс.', '6.3 міс.'],
  };
  await page.evaluate(() => window.gradeFixture.render('scheduled'));
  for (const language of ['ru', 'en', 'uk']) {
    await page.evaluate(language => window.gradeFixture.setInterfaceLanguage(language), language);
    await page.evaluate(() => window.gradeFixture.extended(false));
    await expect(labels).toHaveText([0, 2, 4, 6].map(index => scheduled[language][index]));
    await page.evaluate(() => window.gradeFixture.extended(true));
    await expect(labels).toHaveText(scheduled[language]);
    await expect(buttons.last()).toBeVisible();
  }

  for (const width of [320, 375, 430, 768, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    await expect.poll(() => labels.evaluateAll(items => items.every(label => {
      const text = label.getBoundingClientRect();
      const button = label.closest('button').getBoundingClientRect();
      return button.left >= 0 && button.right <= window.innerWidth && text.width <= button.width;
    }))).toBe(true);
  }

  for (const source of ['cached', 'forced']) {
    await page.evaluate(source => window.gradeFixture.render(source, true), source);
    await expect(buttons.last()).toBeDisabled();
    for (const language of ['uk', 'en', 'ru']) {
      const expected = await page.evaluate(language => {
        window.gradeFixture.setInterfaceLanguage(language);
        return window.gradeFixture.expectedForced().extended;
      }, language);
      await expect(labels).toHaveText(expected);
    }
  }
});
