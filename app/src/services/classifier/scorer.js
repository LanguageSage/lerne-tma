/**
 * app/src/services/classifier/scorer.js
 *
 * Combines grammar features and vocabulary results into a final CEFR classification result.
 */

const CEFR_ORDER = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };

function maxLevel(levels) {
  if (!levels || levels.length === 0) return 'A1';
  return levels.reduce((max, lvl) => {
    return (CEFR_ORDER[lvl] || 0) > (CEFR_ORDER[max] || 0) ? lvl : max;
  }, 'A1');
}

export function calculateResult(phrase, grammarFeatures, vocabResult) {
  const grammarLevels = grammarFeatures.map(f => f.level);
  const grammarLevel  = grammarLevels.length > 0 ? maxLevel(grammarLevels) : 'A1';
  const vocabularyLevel = vocabResult.level || 'A1';
  const overallLevel = maxLevel([grammarLevel, vocabularyLevel]);

  let confidence = 1.0;

  if (grammarFeatures.length > 0) {
    const avgFeatConf = grammarFeatures.reduce((sum, f) => sum + f.confidence, 0) / grammarFeatures.length;
    confidence = 0.7 * avgFeatConf + 0.3 * confidence;
  } else {
    const knownWords = vocabResult.words || [];
    if (knownWords.length > 0) {
      confidence -= 0.15;
    } else {
      confidence -= 0.20;
    }
  }

  const unknown = vocabResult.unknown_count || 0;
  if (unknown >= 4) {
    confidence -= 0.25;
  } else if (unknown >= 2) {
    confidence -= 0.15;
  } else if (unknown >= 1) {
    confidence -= 0.05;
  }

  const uniqueLevels = new Set(grammarLevels);
  if (uniqueLevels.size >= 3) {
    confidence -= 0.10;
  }

  confidence = Math.round(Math.max(0.0, Math.min(1.0, confidence)) * 1000) / 1000;

  // ── Reason generation ────────────────────────────────────────────────
  const gReasons = grammarFeatures.filter(f => f.level === overallLevel || f.level === grammarLevel).map(f => f.name);
  const vMatching = (vocabResult.words || []).filter(w => w.level === overallLevel).map(w => w.word);

  const reasons = [];
  if (gReasons.length > 0) reasons.push(...gReasons);
  if (vMatching.length > 0) reasons.push(`Словарь: ${vMatching.join(', ')}`);

  let reason = '';
  let reasonShort = '';

  if (reasons.length === 0) {
    reason = overallLevel === 'A1' ? 'Präsens (базовая фраза)' : `Уровень ${overallLevel}`;
    reasonShort = overallLevel === 'A1' ? 'Präsens' : overallLevel;
  } else {
    const dedup = Array.from(new Set(reasons));
    reason = dedup.join(' | ');

    const primary = gReasons.length > 0 ? gReasons[0] : (vMatching.length > 0 ? `Словарь (${vMatching[0]})` : overallLevel);
    const shortMap = {
      'Modalsatz (so, wie)': 'so, wie',
      'Perfekt (haben + Part.II)': 'Perfekt (haben)',
      'Perfekt (sein + Part.II)': 'Perfekt (sein)',
      'Passiv Präsens (wird + Part.II)': 'Passiv (wird)',
      'Passiv Präteritum (wurde + Part.II)': 'Passiv (wurde)',
      'Passiv Perfekt (…worden)': 'Passiv Perfekt',
      'um…zu Konstruktion': 'um…zu',
      'ohne…zu Konstruktion': 'ohne…zu',
      'statt…zu Konstruktion': 'statt…zu',
      'Adjektiv + zu + Infinitiv': 'Adjektiv + zu',
      'je…desto Konstruktion': 'je…desto',
      'sein + zu + Infinitiv': 'sein + zu',
      'sich lassen + Infinitiv': 'sich lassen',
    };
    reasonShort = shortMap[primary] || primary;
  }

  return {
    level: overallLevel,
    reason,
    reason_short: reasonShort,
    grammar_level: grammarLevel,
    vocabulary_level: vocabularyLevel,
    confidence,
    grammar_features: grammarFeatures,
    vocabulary_features: vocabResult.words || [],
    source: 'rules',
    ai_used: false,
  };
}

