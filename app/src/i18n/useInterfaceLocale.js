import { useSyncExternalStore } from 'react';
import { getInterfaceLanguage, subscribeInterfaceLanguage } from './locale';

// Subscribe even in memoized components so open dialogs update without losing drafts.
export function useInterfaceLocale() {
  return useSyncExternalStore(subscribeInterfaceLanguage, getInterfaceLanguage, () => 'uk');
}
