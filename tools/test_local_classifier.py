#!/usr/bin/env python
"""
tools/test_local_classifier.py

Tests the local rule-based CEFR classifier for German.
No AI calls, no database — runs entirely offline.

Usage:
    python tools/test_local_classifier.py
"""

import sys
import os

# Make sure project root is on the path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from api.services.classifier import classify_sentence_fast

# ─── Test cases: (phrase, expected_level) ─────────────────────────────────────

TEST_CASES = [
    # ── A1 ──────────────────────────────────────────────────────────────────
    ("Ich lerne Deutsch.",                                          "A1"),
    ("Das ist sehr schön.",                                         "A1"),
    ("Er kann schwimmen.",                                          "A1"),
    ("Ich lerne Deutsch jeden Tag.",                                "A1"),
    ("Sie wohnt in Berlin.",                                        "A1"),
    # ── A2 ──────────────────────────────────────────────────────────────────
    ("Ich habe das Passwort falsch eingegeben.",                    "A2"),
    ("Ich habe ein Buch gekauft.",                                  "A2"),
    ("Er ist gestern nach Berlin gefahren.",                        "A2"),
    ("Ich habe gehört, dass die Musik schön ist.",                  "A2"),
    ("Sie konnte nicht kommen.",                                    "A2"),
    ("Ich freue mich auf das Wochenende.",                          "A2"),
    ("Ich möchte einen Kaffee, bitte.",                             "A2"),
    ("Du hast das Passwort vergessen.",                             "A2"),
    # ── B1 ──────────────────────────────────────────────────────────────────
    ("Ich lerne Deutsch, um in Deutschland zu arbeiten.",           "B1"),
    ("Das Auto wird repariert.",                                    "B1"),
    ("Das ist der Mann, den ich gestern gesehen habe.",             "B1"),
    ("Obwohl ich müde bin, gehe ich arbeiten.",                     "B1"),
    ("Nachdem ich gegessen hatte, bin ich schlafen gegangen.",      "B1"),
    ("Wegen des Regens blieben wir zu Hause.",                      "B1"),
    # ── B2 ──────────────────────────────────────────────────────────────────
    ("Je mehr ich lerne, desto besser spreche ich.",                "B2"),
    ("Das Dokument ist verschlüsselt worden.",                      "B2"),
    ("Nicht nur Kinder, sondern auch Erwachsene lieben Spiele.",    "B2"),
    # ── C1 ──────────────────────────────────────────────────────────────────
    ("Das Problem ist schwer zu lösen.",                            "C1"),
    ("Das lässt sich leicht erklären.",                             "C1"),
]

CEFR_ORDER = {"A1": 1, "A2": 2, "B1": 3, "B2": 4, "C1": 5, "C2": 6}

LEVEL_COLORS = {
    "A1": "\033[32m",   # green
    "A2": "\033[36m",   # cyan
    "B1": "\033[34m",   # blue
    "B2": "\033[33m",   # yellow
    "C1": "\033[35m",   # magenta
    "C2": "\033[31m",   # red
}
RESET = "\033[0m"
BOLD  = "\033[1m"


def run_tests(threshold: float = 0.80):
    passed = failed = low_conf = 0

    print(f"\n{BOLD}Lerne TMA — Local CEFR Classifier Test{RESET}")
    print(f"Confidence threshold for local use: {threshold:.0%}\n")
    print(f"{'STATUS':<8} {'CONF':>5}  {'EXPECT':>6}  {'ACTUAL':>6}  {'FEATURES'}")
    print("─" * 80)

    for phrase, expected in TEST_CASES:
        result    = classify_sentence_fast(phrase, "de")
        actual    = result.get("level", "?")
        conf      = result.get("confidence", 0.0)
        features  = result.get("grammar_features", [])
        vocab_w   = result.get("vocabulary_features", [])

        feat_str  = ", ".join(f["name"] for f in features) if features else "—"
        vocab_str = ", ".join(f"{w['word']}({w['level']})" for w in vocab_w) if vocab_w else ""
        details   = feat_str + (f"  |  vocab: {vocab_str}" if vocab_str else "")

        conf_ai = conf < threshold   # would go to AI

        if actual == expected:
            status = f"\033[32m✅ PASS{RESET}"
            passed += 1
        else:
            status = f"\033[31m❌ FAIL{RESET}"
            failed += 1

        if conf_ai:
            low_conf += 1
            conf_flag = f"\033[33m{conf:.2f}↗AI{RESET}"
        else:
            conf_flag = f"{conf:.2f}"

        exp_c = LEVEL_COLORS.get(expected, "") + expected + RESET
        act_c = LEVEL_COLORS.get(actual,   "") + actual   + RESET

        print(f"{status}  {conf_flag:>10}  {exp_c:>14}  {act_c:>14}  {details}")
        print(f"         {phrase}")
        print()

    total = len(TEST_CASES)
    print("─" * 80)
    print(f"{BOLD}Results: {passed}/{total} passed | {failed} failed | {low_conf} would go to AI{RESET}")

    if failed == 0:
        print(f"\n\033[32m{BOLD}✅ All tests passed!{RESET}")
    else:
        print(f"\n\033[31m{BOLD}❌ {failed} test(s) failed. Review detectors in rules_de.py.{RESET}")

    return failed == 0


if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)
