"""
api/services/classifier/pipeline.py

Main entry point: classify_sentence_fast(phrase, target_language)

Flow:
  1. Grammar rules (rules_de.py)  → list[GrammarFeature]
  2. Vocabulary lookup (vocabulary.py) → {level, words, unknown_count}
  3. Scorer (scorer.py) → final result dict

Only German (de) is fully supported.
Other languages return confidence=0.0 → caller falls back to AI.
"""

from .rules_de    import detect_all_features_de
from .vocabulary  import detect_vocabulary_level
from .scorer      import calculate_result


def classify_sentence_fast(phrase: str, target_language: str = "de") -> dict:
    """
    Classify a phrase deterministically (no AI, no network calls).

    Returns a dict:
    {
        "level":               "A2",
        "grammar_level":       "A2",
        "vocabulary_level":    "A2",
        "confidence":          0.91,
        "grammar_features":    [{"name": "Perfekt (haben + Part.II)", "level": "A2", "confidence": 0.92}],
        "vocabulary_features": [{"word": "passwort", "level": "A2"}],
        "source":              "rules",
        "ai_used":             False
    }

    If the phrase is empty or the language is not German, returns confidence=0.0
    so the caller knows to fall back to AI.
    """
    if not phrase or not phrase.strip():
        return {"level": "A1", "confidence": 0.0, "source": "empty", "ai_used": False}

    lang = (target_language or "de").lower().strip()

    if lang not in ("de",):
        # Not supported: tell the caller to use AI instead
        return {"level": "A1", "confidence": 0.0, "source": "unsupported_lang", "ai_used": False}

    grammar_features = detect_all_features_de(phrase)
    vocab_result     = detect_vocabulary_level(phrase)
    result           = calculate_result(phrase, grammar_features, vocab_result)

    return result
