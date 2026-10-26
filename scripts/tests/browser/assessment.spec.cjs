const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const course = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../local/test-data/lesson-qa/corrected.snapshot.json'), 'utf8'));
const deck = { ...course.decks.find(d => d.id === 7139), stats: { total: 48, new: 48, due: 0, learning: 0 } };
const cards = course.cards.filter(c => c.deck_id === deck.id).sort((a,b) => a.position - b.position || a.id - b.id);
// Match the real get_cards_for_study DTO: parsed metadata, front/back, no position.
const apiCards = course.cards.map(({front_text,back_text,metadata,position:_position,...card}) => ({...card,front:front_text,back:back_text,metadata:JSON.parse(metadata||'{}')}));
const items = course.knowledge_seed.map((ki, i) => ({ ...ki, id: i + 1 }));
const mappings = course.knowledge_mappings.filter(m => cards.some(c => c.id === m.card_id)).map(m =>
  ({ ...m, knowledge_item_id: items.find(ki => ki.rule_code === m.rule_code).id }));

async function setup(page, context) {
  const writes = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/*', route => ['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await context.addInitScript(() => {
    for (const [key,value] of Object.entries({ native_language: 'ru', native_language_selected:'true', lerne_has_selected_language:'true', lerne_target_language:'de' })) localStorage.setItem(key,value);
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id:1, is_guest:false }));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ access_token:'isolated-test', refresh_token:'isolated-test' }));
  });
  await page.route('**/api/**', route => {
    const request = route.request(), { pathname } = new URL(request.url());
    if (request.method() !== 'GET') writes.push({ pathname, body:request.postDataJSON() });
    if (pathname === '/api/init') return route.fulfill({ json: { decks:course.decks.map(d=>d.id===deck.id?deck:{...d,stats:{total:course.cards.filter(c=>c.deck_id===d.id).length,new:1,due:0,learning:0}}), folders:[], settings:{}, prompts:{}, user_settings:{}, user_info:{ user_id:1,is_guest:false } } });
    if (pathname === '/api/auth/v2/me') return route.fulfill({ json:{ user_id:1,is_guest:false } });
    if (pathname === '/api/knowledge/decks/7139') return route.fulfill({ json:{ knowledge_items:items, card_knowledge_items:mappings } });
    if (/^\/api\/decks\/\d+\/cards$/.test(pathname)) return route.fulfill({ json:apiCards.filter(c=>c.deck_id===Number(pathname.split('/')[3])) });
    if (pathname === '/api/decks/6985/next') return route.fulfill({json:course.cards.find(c=>c.deck_id===6985)});
    if (pathname === '/api/ai/evaluate-answer') {
      const correct = request.postDataJSON().answer !== 'Falsch.';
      return route.fulfill({ json: { result: correct ? { verdict:'correct', accepted:true, evaluator:'exact' }
        : { verdict:'incorrect', accepted:false, error_type:'grammar', error_code:'relative.production', hint:'Проверьте относительное предложение.', evaluator:'ai' }, grading_policy:{ mode:'open_text',max_retries:1 } } });
    }
    return route.fulfill({ json:{} });
  });
  await page.goto('/?user_id=1');
  await page.locator('#deck-item-7139').click();
  await page.getByRole('button', { name:'Начать занятие',exact:true }).click();
  await expect(page.locator('.assessment-view')).toBeVisible();
  return { writes, errors };
}

test('actual D14 entry, one attempt, skips, 46-core score, skill evidence and persisted completion', async ({page,context},testInfo) => {
  test.setTimeout(180000);
  const { writes,errors } = await setup(page,context);
  const wrong = new Set([358363,358364,358365,358375,358385,358397]);
  const { parseClozeData } = await import('../../../app/src/utils/clozeParser.js');
  const { detectExerciseType } = await import('../../../app/src/utils/exerciseDetector.js');
  for (const card of cards) {
    await expect(page.getByRole('button', { name:'Перевернуть карточку',exact:true })).toHaveCount(0);
    await expect(page.locator('.grade-buttons')).toHaveCount(0);
    await expect(page.getByRole('button', { name:'Показать перевод',exact:true })).toHaveCount(0);
    if (cards.indexOf(card) >= 46) {
      await page.getByRole('button', { name:'Пропустить задание',exact:true }).click();
    } else if (detectExerciseType(card) === 'free_text') {
      const metadata = JSON.parse(card.metadata);
      await page.getByRole('textbox', { name:'Ваш ответ',exact:true }).fill(wrong.has(card.id) ? 'Falsch.' : metadata.accepted_answers?.[0] || card.back_text.split('\n')[0]);
      await page.getByRole('button', { name:'Проверить ответ',exact:true }).click();
      await expect(page.getByRole('textbox', { name:'Ваш ответ',exact:true })).toBeDisabled();
    } else {
      const { gaps } = parseClozeData(card,'classic');
      let input=0,choice=0;
      for (const gap of gaps) {
        const answer = wrong.has(card.id) ? (gap.choices.find(c => !gap.correctAnswer.split('|').includes(c)) || 'Falsch') : gap.correctAnswer.split('|')[0];
        if (gap.mode === 'input') await page.locator('.cloze-masked-text input').nth(input++).fill(answer);
        else { await page.locator('.trainer-choice-gap').nth(choice++).click(); await page.locator('.gap-dropdown-popover').getByRole('button',{name:answer,exact:true}).click(); }
      }
      await page.getByRole('button',{name:'Проверить ответы',exact:true}).click();
      await expect(page.getByRole('button',{name:'Ответ сохранён',exact:true})).toBeDisabled();
    }
    await page.getByRole('button',{name:cards.indexOf(card) === 47 ? 'Завершить экзамен':'Следующее задание',exact:true}).click();
  }
  await expect(page.locator('.assessment-score')).toHaveText('40 / 46');
  await expect(page.locator('.assessment-results')).toContainText('Бонус: +0 / 2');
  await expect(page.locator('.assessment-results')).toContainText('Пропущено: 2');
  expect(writes.filter(w => /study\/grade|sync\/v2\/push/.test(w.pathname))).toEqual([]);
  const evidence = await page.evaluate(async () => {
    const {getLocalDb} = await import('/src/services/localDb.js');
    return (await getLocalDb().knowledge_attempt_outbox.toArray()).map(e => e.evaluation_data);
  });
  expect(evidence).toHaveLength(48);
  expect(evidence.filter(e => e.status === 'incorrect')).toHaveLength(6);
  expect(evidence.filter(e => e.status === 'skipped')).toHaveLength(2);
  expect(evidence.every(e => e.schema_version === 3 && e.assessment.competency_ids.length === 1)).toBe(true);
  for(const width of [320,375,430,768,1280]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath(`assessment-result-${width}.png`),fullPage:true});
  }
  const target=course.decks.find(d=>d.id===6985);
  await page.locator('.assessment-results').getByRole('button',{name:target.name,exact:true}).click();
  await expect(page.locator('.assessment-view')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(async()=> (await import('/src/store/useDeckStore.js')).useDeckStore.getState().currentDeck.id)).toBe(6985);
  await page.reload();
  const saved = await page.evaluate(async () => (await import('/src/services/assessmentService.js')).loadAssessment(1,7139));
  expect(saved.index).toBe(48);
  expect(Object.keys(saved.results)).toHaveLength(48);
  expect(errors).toEqual([]);
});

test('unavailable free evaluator never locks in a score; resume survives reload', async ({page,context},testInfo) => {
  await setup(page,context);
  await page.evaluate(async () => {
    const {useSessionStore}=await import('/src/store/useSessionStore.js');
    const s=useSessionStore.getState().assessment;
    useSessionStore.getState().setAssessment({...s,index:45});
  });
  await page.route('**/api/ai/evaluate-answer',route=>route.fulfill({status:503,json:{detail:'Unavailable'}}));
  await page.getByRole('textbox',{name:'Ваш ответ',exact:true}).fill('Ich suche eine Stelle, bei der ich viel lernen kann.');
  await page.getByRole('button',{name:'Проверить ответ',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Ваш ответ',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Показать пример ответа',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Следующее задание',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Пропустить задание',exact:true}).click();
  await page.getByRole('button',{name:'Следующее задание',exact:true}).click();
  await page.reload();
  await page.locator('#deck-item-7139').click();
  await page.getByRole('button',{name:'Начать занятие',exact:true}).click();
  await expect(page.locator('.assessment-view')).toContainText('47 / 48');
  await page.screenshot({path:testInfo.outputPath('assessment-resumed.png'),fullPage:true});
});

test('local storage failure rolls back result and outbox; retry saves the first answer once', async ({page,context}) => {
  await setup(page,context);
  await page.evaluate(async () => {
    const db=(await import('/src/services/localDb.js')).getLocalDb();
    window.failAssessmentStorage=true;
    db.knowledge_attempt_outbox.hook('creating',()=> { if(window.failAssessmentStorage) throw new Error('Isolated storage failure'); });
  });
  const {parseClozeData}=await import('../../../app/src/utils/clozeParser.js');
  for (const [index,gap] of parseClozeData(cards[0],'classic').gaps.entries()) {
    await page.locator('.trainer-choice-gap').nth(index).click();
    await page.locator('.gap-dropdown-popover').getByRole('button',{name:gap.correctAnswer.split('|')[0],exact:true}).click();
  }
  await page.getByRole('button',{name:'Проверить ответы',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось сохранить ответ');
  const read=()=>page.evaluate(async()=>{
    const db=(await import('/src/services/localDb.js')).getLocalDb();
    const saved=(await db.syncState.get('assessment:1:7139')).session;
    return {results:Object.keys(saved.results).length,events:await db.knowledge_attempt_outbox.count()};
  });
  expect(await read()).toEqual({results:0,events:0});
  await expect(page.getByRole('button',{name:'Ответ сохранён',exact:true})).toBeDisabled();
  await page.evaluate(()=>{window.failAssessmentStorage=false;});
  await page.getByRole('button',{name:'Повторить сохранение',exact:true}).click();
  await expect(page.getByRole('button',{name:'Следующее задание',exact:true})).toBeEnabled();
  expect(await read()).toEqual({results:1,events:1});
  await page.getByRole('button',{name:'Следующее задание',exact:true}).click();
  expect(await read()).toEqual({results:1,events:1});
});
