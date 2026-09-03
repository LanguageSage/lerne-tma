#!/usr/bin/env python
"""Find German words from cards that are missing from local CEFR vocabulary."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional


sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from api import models  # noqa: E402
from api.services.classifier import vocabulary  # noqa: E402


TOKEN_RE = re.compile(r"[a-zäöüßA-ZÄÖÜ]+(?:-[a-zäöüßA-ZÄÖÜ]+)*")
CEFR_TAG_RE = re.compile(r"\b(A1|A2|B1|B2|C1|C2)\b", re.IGNORECASE)
VALID_PROFILES = {"base", "medium", "max"}


def extract_existing_level(tags: Optional[str]) -> Optional[str]:
    if not tags:
        return None
    match = CEFR_TAG_RE.search(str(tags))
    return match.group(1).upper() if match else None


def clean_example(text: str, limit: int = 110) -> str:
    one_line = " ".join((text or "").split())
    if len(one_line) <= limit:
        return one_line
    return f"{one_line[:limit - 1]}…"


def iter_tma_cards(lang: str, limit: Optional[int]) -> Iterable[Dict[str, Any]]:
    query = (
        models.TMA_Card
        .select(
            models.TMA_Card.id,
            models.TMA_Card.front_text,
            models.TMA_Card.tags,
            models.TMA_Deck.target_language,
        )
        .join(models.TMA_Deck)
        .where(models.TMA_Card.is_deleted == False)
        .order_by(models.TMA_Card.id.asc())
    )
    if lang == "de":
        query = query.where(
            (models.TMA_Deck.target_language == "de") |
            (models.TMA_Deck.target_language.is_null())
        )
    else:
        query = query.where(models.TMA_Deck.target_language == lang)
    if limit:
        query = query.limit(limit)
    yield from query.dicts()


def iter_library_cards(lang: str, limit: Optional[int]) -> Iterable[Dict[str, Any]]:
    query = (
        models.Card
        .select(models.Card.id, models.Card.front_text, models.Card.tags, models.Deck.target_language)
        .join(models.Deck)
        .where(models.Card.is_deleted == False)
        .order_by(models.Card.id.asc())
    )
    if lang == "de":
        query = query.where(
            (models.Deck.target_language == "de") |
            (models.Deck.target_language.is_null())
        )
    else:
        query = query.where(models.Deck.target_language == lang)
    if limit:
        query = query.limit(limit)
    for row in query.dicts():
        row["id"] = f"lib:{row['id']}"
        yield row


def collect_unknowns(cards: Iterable[Dict[str, Any]], profile: str, min_length: int) -> Dict[str, Any]:
    vocab = vocabulary._load_vocab(profile)
    skip_words = vocabulary._SKIP_WORDS

    word_occurrences: Counter[str] = Counter()
    word_card_ids: Dict[str, set] = defaultdict(set)
    word_levels: Dict[str, Counter] = defaultdict(Counter)
    examples: Dict[str, List[Dict[str, Any]]] = defaultdict(list)

    total_cards = 0
    total_tokens = 0
    known_tokens = 0
    skipped_tokens = 0

    for card in cards:
        total_cards += 1
        front = card.get("front_text") or ""
        level = extract_existing_level(card.get("tags")) or "NO_LEVEL"
        seen_in_card = set()

        for raw in TOKEN_RE.findall(front):
            total_tokens += 1
            token = raw.lower()
            if len(token) < min_length or token in skip_words:
                skipped_tokens += 1
                continue
            if token in vocab:
                known_tokens += 1
                continue

            word_occurrences[token] += 1
            seen_in_card.add(token)

        for token in seen_in_card:
            word_card_ids[token].add(card["id"])
            word_levels[token][level] += 1
            if len(examples[token]) < 3:
                examples[token].append({
                    "card_id": card["id"],
                    "level": level,
                    "front": clean_example(front),
                })

    candidates = []
    for word, occurrences in word_occurrences.most_common():
        candidates.append({
            "word": word,
            "occurrences": occurrences,
            "cards": len(word_card_ids[word]),
            "card_levels": dict(word_levels[word].most_common()),
            "examples": examples[word],
        })

    return {
        "profile": profile,
        "known_vocab_entries": len(vocab),
        "cards_scanned": total_cards,
        "tokens_scanned": total_tokens,
        "known_tokens": known_tokens,
        "skipped_tokens": skipped_tokens,
        "unknown_occurrences": sum(word_occurrences.values()),
        "unknown_unique": len(word_occurrences),
        "candidates": candidates,
    }


def print_report(report: Dict[str, Any], top: int, min_count: int) -> None:
    candidates = [c for c in report["candidates"] if c["cards"] >= min_count]
    shown = candidates[:top]

    print("=" * 78)
    print("German Vocabulary Unknowns Audit")
    print("=" * 78)
    print(f"Profile:              {report['profile']}")
    print(f"Known vocab entries:  {report['known_vocab_entries']}")
    print(f"Cards scanned:        {report['cards_scanned']}")
    print(f"Tokens scanned:       {report['tokens_scanned']}")
    print(f"Known tokens:         {report['known_tokens']}")
    print(f"Unknown occurrences:  {report['unknown_occurrences']}")
    print(f"Unique unknown words: {report['unknown_unique']}")
    print(f"Shown candidates:     {len(shown)} (min cards: {min_count})")
    print("-" * 78)

    for idx, item in enumerate(shown, 1):
        levels = ", ".join(f"{lvl}:{count}" for lvl, count in item["card_levels"].items())
        print(f"{idx:>3}. {item['word']:<28} occ={item['occurrences']:<4} cards={item['cards']:<4} levels=[{levels}]")
        for example in item["examples"][:2]:
            print(f"     - #{example['card_id']} [{example['level']}] {example['front']}")


def write_report(path: Path, report: Dict[str, Any], top: int, min_count: int) -> None:
    filtered = {
        **report,
        "candidates": [c for c in report["candidates"] if c["cards"] >= min_count][:top],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(filtered, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit German words missing from local CEFR vocabulary.")
    parser.add_argument("--profile", choices=sorted(VALID_PROFILES), default="max", help="Vocabulary profile to check.")
    parser.add_argument("--lang", default="de", help="Deck target language to scan.")
    parser.add_argument("--limit", type=int, default=None, help="Limit cards scanned per source.")
    parser.add_argument("--top", type=int, default=80, help="Number of candidates to print/save.")
    parser.add_argument("--min-count", type=int, default=2, help="Minimum number of cards containing a word.")
    parser.add_argument("--min-length", type=int, default=4, help="Minimum token length to count.")
    parser.add_argument("--include-library", action="store_true", help="Also scan master library cards.")
    parser.add_argument("--output", type=Path, default=None, help="Optional JSON report path.")
    args = parser.parse_args()

    os.environ["DE_VOCAB_PROFILE"] = args.profile
    if not models.tma_db.obj:
        models.initialize_database()

    lang = (args.lang or "de").lower().strip()
    cards = list(iter_tma_cards(lang, args.limit))
    if args.include_library:
        cards.extend(iter_library_cards(lang, args.limit))

    report = collect_unknowns(cards, args.profile, args.min_length)
    print_report(report, args.top, args.min_count)
    if args.output:
        write_report(args.output, report, args.top, args.min_count)
        print(f"\nSaved JSON report: {args.output}")


if __name__ == "__main__":
    main()
