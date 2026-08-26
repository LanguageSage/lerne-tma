/**
 * app/src/services/classifier/index.js
 *
 * Client-side entry point for the local rule-based CEFR classifier.
 * Runs 100% offline in browser / TMA / APK.
 * Fast (< 0.1 ms) and zero API cost.
 */

import { detectAllFeaturesDe } from './rules_de.js';
import { detectVocabularyLevel } from './vocabulary.js';
import { calculateResult } from './scorer.js';

const CLASSIFIER_CACHE = new Map();
const MAX_CACHE_SIZE = 1000;

export function classifySentenceFast(phrase, targetLanguage = 'de') {
  if (!phrase || !phrase.trim()) {
    return { level: 'A1', confidence: 0.0, source: 'empty', ai_used: false };
  }

  const lang = (targetLanguage || 'de').toLowerCase().trim();
  if (lang !== 'de') {
    return { level: 'A1', confidence: 0.0, source: 'unsupported_lang', ai_used: false };
  }

  const cacheKey = phrase.trim();
  if (CLASSIFIER_CACHE.has(cacheKey)) {
    return CLASSIFIER_CACHE.get(cacheKey);
  }

  const grammarFeatures = detectAllFeaturesDe(phrase);
  const vocabResult     = detectVocabularyLevel(phrase);
  const result          = calculateResult(phrase, grammarFeatures, vocabResult);

  if (CLASSIFIER_CACHE.size >= MAX_CACHE_SIZE) {
    const firstKey = CLASSIFIER_CACHE.keys().next().value;
    CLASSIFIER_CACHE.delete(firstKey);
  }
  CLASSIFIER_CACHE.set(cacheKey, result);

  return result;
}

