"""
api/services/classifier/vocabulary.py

Loads vocab_de.json and detects the CEFR level of content words in a German phrase.
Lookups are done on lowercased tokens. The vocab dict stores both lemmas and common
inflected forms so no stemmer/lemmatizer is required.
"""

import json
import os
import re
from pathlib import Path

# ─── Vocabulary loader ────────────────────────────────────────────────────────

_VOCAB_CACHE: dict[str, dict] = {}
_VOCAB_FILES = {
    "base": "vocab_de.json",
    "medium": "vocab_de_medium.json",
    "max": "vocab_de_max.json",
}


def get_vocab_profile() -> str:
    profile = os.environ.get("DE_VOCAB_PROFILE", "base").lower().strip()
    return profile if profile in _VOCAB_FILES else "base"


def _load_vocab(profile: str | None = None) -> dict:
    profile = profile or get_vocab_profile()
    if profile not in _VOCAB_CACHE:
        vocab_path = Path(__file__).parent / "data" / _VOCAB_FILES[profile]
        if not vocab_path.exists() and profile != "base":
            vocab_path = Path(__file__).parent / "data" / _VOCAB_FILES["base"]
        if vocab_path.exists():
            with open(vocab_path, encoding="utf-8") as f:
                _VOCAB_CACHE[profile] = json.load(f)
        else:
            _VOCAB_CACHE[profile] = {}
    return _VOCAB_CACHE[profile]


# ─── Common function words to skip during vocab lookup ───────────────────────

_SKIP_WORDS = frozenset({
    # Articles
    "der", "die", "das", "ein", "eine", "einen", "einem", "einer", "eines",
    "des", "dem", "den",
    # Pronouns
    "ich", "du", "er", "sie", "es", "wir", "ihr",
    "mich", "dich", "sich", "uns", "euch",
    "mir", "dir", "ihm", "ihr", "uns", "euch",
    "mein", "dein", "sein", "unser", "euer",
    "meinen", "meinem", "meiner", "meines",
    "meine", "deine", "seine", "ihre", "ihren", "ihnen", "unserer", "unsere",
    "dieser", "diese", "dieses", "diesem", "diesen",
    # Common prepositions
    "in", "an", "auf", "bei", "mit", "nach", "seit", "von", "zu", "aus",
    "um", "für", "durch", "ohne", "gegen", "über", "unter", "neben",
    "vor", "hinter", "zwischen", "ab", "bis", "laut",
    # Common conjunctions / particles
    "und", "oder", "aber", "denn", "doch", "auch", "noch", "schon",
    "nicht", "kein", "keine", "keinen", "keinem",
    "sehr", "viel", "wenig", "mehr", "weniger", "immer", "manchmal",
    "ja", "nein", "hier", "dort", "da", "heute", "morgen", "gestern",
    "jetzt", "dann", "so", "wie", "wo", "wann", "warum", "was",
    "wer", "wen", "wem", "wessen", "welche", "welches", "etwas", "nichts",
    # Common auxiliary / modal verb forms (already handled in grammar rules)
    "ist", "sind", "war", "waren", "bin", "bist", "seid",
    "hat", "haben", "habe", "hast", "habt", "hatte", "hatten",
    "wird", "werden", "wurde", "wurden",
    "kann", "kannst", "können", "muss", "musst", "müssen", "will", "wollen",
    "soll", "darf", "mag",
    "könnte", "könnten", "müsste", "würde", "hätte", "wäre", "möchte", "möchtest",
    # Ultra-common short verbs (A1 by definition)
    "sein", "machen", "gehen", "kommen", "sehen", "geben", "nehmen",
    "sagen", "stehen", "liegen", "laufen", "fahren", "schreiben",
    "lesen", "trinken", "essen", "kaufen", "lernen", "spielen",
    "hören", "sprechen", "fragen", "antworten", "wohnen", "heißen",
    "brauchen", "suchen", "finden", "kennen", "wissen", "denken",
    "glauben", "meinen",
    # Common adjectives / adverbs (A1)
    "gut", "schlecht", "groß", "klein", "alt", "neu", "schön",
    "richtig", "falsch", "schnell", "langsam", "früh", "spät",
    "lang", "kurz", "hoch", "tief", "warm", "kalt",
    # Filler words
    "bitte", "danke", "leider", "natürlich", "vielleicht", "eigentlich",
})


# ─── CEFR order ───────────────────────────────────────────────────────────────

CEFR_ORDER = {"A1": 1, "A2": 2, "B1": 3, "B2": 4, "C1": 5, "C2": 6}


# ─── Main function ────────────────────────────────────────────────────────────

def detect_vocabulary_level(text: str) -> dict:
    """
    Scan content words in the text against vocab_de.json.

    Returns:
        {
          "level": "A2",           # highest found vocab level
          "words": [               # list of matched words with levels
              {"word": "Passwort", "level": "A2"}, ...
          ],
          "unknown_count": 2       # number of long content words NOT in dict
        }
    """
    vocab = _load_vocab()

    # Simple whitespace tokenization; strip punctuation
    raw_tokens = re.findall(r"[a-zäöüßA-ZÄÖÜ]+(?:-[a-zäöüßA-ZÄÖÜ]+)*", text)
    found_words = []
    unknown_count = 0

    for raw in raw_tokens:
        clean = raw.lower()
        if clean in _SKIP_WORDS or len(clean) < 4:
            continue

        if clean in vocab:
            found_words.append({"word": clean, "level": vocab[clean]})
        else:
            # Count long content-word-shaped tokens as unknown
            # (length >= 6 to avoid counting short prepositions missed by _SKIP_WORDS)
            if len(clean) >= 6:
                unknown_count += 1

    if found_words:
        best_level = max(
            (w["level"] for w in found_words),
            key=lambda l: CEFR_ORDER.get(l, 0)
        )
    else:
        best_level = "A1"

    return {
        "level": best_level,
        "words": found_words,
        "unknown_count": unknown_count,
    }
