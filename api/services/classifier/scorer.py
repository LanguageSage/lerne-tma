"""
api/services/classifier/scorer.py

Combines grammar features and vocabulary results into a final CEFR classification
with a confidence score.

Confidence starts at 1.0 and is reduced by:
  - Low-confidence grammar features
  - Unknown content words
  - No grammar features detected (ambiguous)
  - Many conflicting levels
"""

CEFR_ORDER = {"A1": 1, "A2": 2, "B1": 3, "B2": 4, "C1": 5, "C2": 6}


def _max_level(levels: list) -> str:
    """Return the highest CEFR level from a list, defaulting to A1."""
    if not levels:
        return "A1"
    return max(levels, key=lambda l: CEFR_ORDER.get(l, 0))


def calculate_result(phrase: str, grammar_features: list, vocab_result: dict) -> dict:
    """
    Compute the final classification result.

    Args:
        phrase:           Original input phrase.
        grammar_features: List of GrammarFeature from rules_de.
        vocab_result:     Dict from vocabulary.detect_vocabulary_level.

    Returns:
        Dict with keys: level, grammar_level, vocabulary_level,
                        confidence, grammar_features, vocabulary_features,
                        source, ai_used.
    """
    # ── Grammar level ────────────────────────────────────────────────────
    grammar_levels = [f.level for f in grammar_features]
    grammar_level  = _max_level(grammar_levels) if grammar_levels else "A1"

    # ── Vocabulary level ─────────────────────────────────────────────────
    vocabulary_level = vocab_result.get("level", "A1")

    # ── Overall = max of both ────────────────────────────────────────────
    overall_level = _max_level([grammar_level, vocabulary_level])

    # ── Confidence ───────────────────────────────────────────────────────
    confidence = 1.0

    if grammar_features:
        # Average confidence of detected features
        avg_feat_conf = sum(f.confidence for f in grammar_features) / len(grammar_features)
        # Pull overall confidence toward the feature confidence
        confidence = 0.7 * avg_feat_conf + 0.3 * confidence
    else:
        # No grammar features: confidence drops — only vocabulary or nothing found
        known_words = vocab_result.get("words", [])
        if known_words:
            # We have vocabulary evidence but no grammar features
            confidence -= 0.15
        else:
            # Completely blank — simple A1 sentence with no markers at all
            # Still likely A1, but we're not 100% sure
            confidence -= 0.20

    # Penalty for unknown content words
    unknown = vocab_result.get("unknown_count", 0)
    if unknown >= 4:
        confidence -= 0.25
    elif unknown >= 2:
        confidence -= 0.15
    elif unknown >= 1:
        confidence -= 0.05

    # Penalty if multiple very different levels detected (unlikely, but possible)
    unique_levels = set(grammar_levels)
    if len(unique_levels) >= 3:
        confidence -= 0.10

    confidence = round(max(0.0, min(1.0, confidence)), 3)

    # ── Reason generation ────────────────────────────────────────────────
    g_reasons = [f.name for f in grammar_features if f.level == overall_level or f.level == grammar_level]
    v_matching = [w["word"] for w in vocab_result.get("words", []) if w.get("level") == overall_level]

    reasons = []
    if g_reasons:
        reasons.extend(g_reasons)
    if v_matching:
        reasons.append(f"Словарь: {', '.join(v_matching)}")

    if not reasons:
        reason = "Präsens (базовая фраза)" if overall_level == "A1" else f"Уровень {overall_level}"
        reason_short = "Präsens" if overall_level == "A1" else overall_level
    else:
        # Deduplicate while preserving order
        seen = set()
        dedup = [r for r in reasons if not (r in seen or seen.add(r))]
        reason = " | ".join(dedup)
        # Short primary reason (first grammar rule or vocab)
        primary = g_reasons[0] if g_reasons else (f"Словарь ({v_matching[0]})" if v_matching else overall_level)
        # Simplify common verbose names for short badge display
        short_map = {
            "Perfekt (haben + Part.II)": "Perfekt (haben)",
            "Perfekt (sein + Part.II)": "Perfekt (sein)",
            "Passiv Präsens (wird + Part.II)": "Passiv (wird)",
            "Passiv Präteritum (wurde + Part.II)": "Passiv (wurde)",
            "Passiv Perfekt (…worden)": "Passiv Perfekt",
            "um…zu Konstruktion": "um…zu",
            "ohne…zu Konstruktion": "ohne…zu",
            "statt…zu Konstruktion": "statt…zu",
            "je…desto Konstruktion": "je…desto",
            "sein + zu + Infinitiv": "sein + zu",
            "sich lassen + Infinitiv": "sich lassen",
        }
        reason_short = short_map.get(primary, primary)

    return {
        "level":               overall_level,
        "reason":              reason,
        "reason_short":        reason_short,
        "grammar_level":       grammar_level,
        "vocabulary_level":    vocabulary_level,
        "confidence":          confidence,
        "grammar_features":    [
            {"name": f.name, "level": f.level, "confidence": f.confidence}
            for f in grammar_features
        ],
        "vocabulary_features": vocab_result.get("words", []),
        "source":              "rules",
        "ai_used":             False,
    }

