import en from './messages/en.json';
import uk from './messages/uk.json';

export const normalizeInterfaceLanguage = code => {
  const language = String(code || '').toLowerCase().split(/[-_]/)[0];
  if (['no', 'nb', 'nn'].includes(language)) return 'en';
  return ['uk', 'ru', 'en'].includes(language) ? language : null;
};

export function getInterfaceLanguage() {
  const saved = normalizeInterfaceLanguage(globalThis.localStorage?.getItem('native_language'));
  const telegram = normalizeInterfaceLanguage(globalThis.window?.Telegram?.WebApp?.initDataUnsafe?.user?.language_code);
  return saved || telegram || 'uk';
}

export function setInterfaceLanguage(code) {
  const language = normalizeInterfaceLanguage(code);
  if (!language) return false;
  const previous = globalThis.localStorage?.getItem('native_language');
  globalThis.localStorage?.setItem('native_language', language);
  if (previous !== language) globalThis.window?.dispatchEvent(new Event('lerne:interface-language'));
  if (globalThis.document) document.documentElement.lang = language;
  return true;
}

export function subscribeInterfaceLanguage(listener) {
  const onStorage = event => {
    if (!event.key || event.key === 'native_language') listener();
  };
  window.addEventListener('lerne:interface-language', listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener('lerne:interface-language', listener);
    window.removeEventListener('storage', onStorage);
  };
}

// Source-text keys are used for interface copy only, never for user content.
export function tr(source, params, language = getInterfaceLanguage()) {
  const messages = language === 'en' ? en : language === 'uk' ? uk : null;
  const text = messages?.[source] ?? source;
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => params?.[key] !== undefined ? String(params[key]) : match);
}
