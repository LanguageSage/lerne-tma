import assert from 'node:assert/strict';
import test from 'node:test';
import { setInterfaceLanguage } from '../../i18n/locale.js';
import { classifySentenceFast } from '../classifier/index.js';

test('the same CEFR input uses the current interface language through RU → EN → RU', t => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  });
  t.after(() => {
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete globalThis.localStorage;
  });

  setInterfaceLanguage('ru');
  const russian = classifySentenceFast('Passwort');
  assert.equal(russian.reason, 'Словарь: passwort');
  assert.equal(russian.reason_short, 'Словарь (passwort)');

  setInterfaceLanguage('en');
  assert.deepEqual(classifySentenceFast('Passwort'), {
    ...russian,
    reason: 'Vocabulary: passwort',
    reason_short: 'Vocabulary (passwort)',
  });

  setInterfaceLanguage('ru');
  assert.deepEqual(classifySentenceFast('Passwort'), russian);
});
