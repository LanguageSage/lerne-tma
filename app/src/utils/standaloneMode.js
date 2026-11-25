const rawStandaloneFlag = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_LERNE_STANDALONE : undefined;
const rawLocalFlag = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_LERNE_LOCAL : undefined;

export const IS_STANDALONE = rawStandaloneFlag === '1';

if (IS_STANDALONE && rawLocalFlag === '1') {
  throw new Error('STANDALONE and LOCAL modes cannot be enabled together');
}

export const STANDALONE_APPLICATION_ID = 'com.lerne.offlinepilot';
export const STANDALONE_USER_ID = 900001;
export const STANDALONE_SESSION_IDENTITY = 'standalone-offline-pilot';
export const STANDALONE_DB_PREFIX = 'LerneStandaloneDB';
export { STANDALONE_SEED_DECK_IDS } from './deckUtils.js';
export const STANDALONE_PROFILE_NAME_KEY = 'lerne_standalone_profile_name';

export function getStandaloneProfileName() {
  try {
    if (typeof localStorage === 'undefined') return 'Offline Pilot';
    const stored = localStorage.getItem(STANDALONE_PROFILE_NAME_KEY);
    return stored && stored.trim() ? stored.trim() : 'Offline Pilot';
  } catch {
    return 'Offline Pilot';
  }
}

export function saveStandaloneProfileName(name) {
  const normalized = typeof name === 'string' && name.trim() ? name.trim().slice(0, 64) : 'Offline Pilot';
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STANDALONE_PROFILE_NAME_KEY, normalized);
    }
  } catch { /* storage unavailable */ }
  return normalized;
}

export function getStandaloneProfile() {
  return {
    user_id: STANDALONE_USER_ID,
    first_name: getStandaloneProfileName(),
    username: 'offline_pilot',
    is_guest: false,
    active_language: 'de',
    has_selected_language: true,
    is_standalone: true,
  };
}
