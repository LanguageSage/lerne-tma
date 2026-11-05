const { test, expect } = require('./isolated-fixture.cjs');
for (const ttsFailure of [false, true]) test(`Frau Müller voice loop, pause, retry and finish (TTS failure: ${ttsFailure})`, async ({ page, context }, testInfo) => {
  await context.addInitScript(() => {
    localStorage.setItem('native_language','ru');
    localStorage.setItem('native_language_selected','true');
    localStorage.setItem('lerne_has_selected_language','true');
    localStorage.setItem('lerne_target_language','de');
    localStorage.setItem('lerne_user_profile',JSON.stringify({user_id:1,first_name:'Learner',is_guest:false}));
    localStorage.setItem('lerne_auth_v2_session',JSON.stringify({access_token:'fixture',refresh_token:'fixture'}));
    Array.prototype.at = undefined;
    Array.prototype.findLast = undefined;
    window.SpeechRecognition = class {
      start() { window.gameRecognition=this; this.onstart?.(); }
      abort() {}
      stop() { this.onend?.(); }
    };
    HTMLMediaElement.prototype.play = function () {
      if (!this.src.startsWith('data:')) setTimeout(() => this.dispatchEvent(new Event('ended')), 20);
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {};
  });
  let messages=0, fail=true, audio=0;
  await page.route('**/api/**', route => {
    const p=new URL(route.request().url()).pathname;
    if(p==='/api/init') return route.fulfill({json:{decks:[],folders:[],settings:{},prompts:{},user_settings:{},user_info:{user_id:1,first_name:'Learner',is_guest:false}}});
    if(p==='/api/auth/v2/me') return route.fulfill({json:{user_id:1,first_name:'Learner',is_guest:false}});
    if(p==='/api/auth/v2/identities') return route.fulfill({json:{providers:['email_password']}});
    if(p==='/api/game/v2/session/start') return route.fulfill({json:{session_id:'fixture',greeting:'Guten Tag!',character:{tts_voice:'de-DE-KatjaNeural'},history:[{role:'assistant',text:'Guten Tag!'}]}});
    if(p.endsWith('/message')) { messages++; return route.fulfill({status:fail?503:200,json:fail?{detail:'AI unavailable'}:{reply:{role:'assistant',text:'Willkommen!'}}}); }
    if(p==='/api/media/generate-audio') {audio++; return route.fulfill({status:ttsFailure?503:200,json:ttsFailure?{detail:'TTS unavailable'}:{path:'https://example.invalid/audio.mp3'}});}
    return route.fulfill({json:[]});
  });
  await page.goto('/');
  await page.getByRole('button',{name:/Game Mode/}).click();
  await page.getByRole('button',{name:'Старт',exact:true}).click();
  await expect(page.getByText('Guten Tag!',{exact:true})).toBeVisible();
  await expect.poll(()=>audio).toBe(1);
  await page.evaluate(()=>window.gameRecognition.onresult({resultIndex:0,results:[Object.assign([{transcript:'Hallo Frau Müller'}],{isFinal:true})]}));
  await expect.poll(()=>messages).toBe(1);
  await expect(page.getByRole('alert')).toContainText('AI unavailable');
  fail=false;
  await page.locator('textarea').press('Enter');
  // The form also has an explicit send button for multiline input.
  if(messages===1) await page.locator('button[type=submit]').click();
  await expect(page.getByText('Willkommen!',{exact:true})).toBeVisible();
  await expect.poll(()=>audio).toBe(2);
  await page.getByRole('button',{name:'Пауза',exact:true}).click();
  await expect(page.locator('.character-subtitle')).toContainText('Разговор на паузе');
  await expect(page.locator('button[type=submit]')).toBeDisabled();
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await page.evaluate(()=>window.gameRecognition.onresult({resultIndex:0,results:[Object.assign([{transcript:'Danke schön'}],{isFinal:true})]}));
  await page.getByRole('button',{name:'Завершить реплику',exact:true}).click();
  await page.waitForTimeout(1700);
  expect(messages).toBe(2);
  await expect(page.locator('textarea')).toHaveValue('Danke schön');
  for(const width of [320,375,430,768,1280]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath(`game-${width}.png`)});
  }
  await page.getByRole('button',{name:'Закончить',exact:true}).click();
  await expect(page.getByRole('button',{name:'Старт',exact:true})).toBeVisible();
});
