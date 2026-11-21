import { useDeckStore } from '../store/useDeckStore.js';
import { useLanguageStore } from '../store/useLanguageStore.js';
import { stopGlobalAudio } from './useAudio.js';
import { useSpeechRecognitionCore } from './useSpeechRecognitionCore.js';

export function useSpeechRecognition(options) {
  const deckLanguage = useDeckStore.getState().currentDeck?.target_language;
  const activeLanguage = useLanguageStore.getState().activeLanguage;
  return useSpeechRecognitionCore({
    ...options,
    language: options?.language || deckLanguage || activeLanguage || 'de',
    onBeforeStart: stopGlobalAudio,
  });
}
