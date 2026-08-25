"""
api/services/classifier/rules_de.py

Pure-Python German grammar rule detectors for CEFR classification.
No spaCy, no external dependencies — uses regex + word-set lookups only.

Detection order (higher levels detected first to avoid shadowing):
  C1 → B2 → Passiv → B1 → A2 → tense constructions
"""

import re
from dataclasses import dataclass


@dataclass
class GrammarFeature:
    """A single detected grammatical construction with its CEFR level and confidence."""
    name: str
    level: str
    confidence: float


# ─── Tokenizer ────────────────────────────────────────────────────────────────

def _tokenize(text: str) -> list:
    """Lowercase tokenization — returns list of German word tokens."""
    return re.findall(r"[a-zäöüß]+(?:-[a-zäöüß]+)*", text.lower())


# ─── Verb form sets ───────────────────────────────────────────────────────────

# haben — Präsens (for Perfekt)
HABEN_PRES = frozenset({"habe", "hast", "hat", "haben", "habt"})

# sein — Präsens (for Perfekt with motion/state verbs)
SEIN_PRES = frozenset({"bin", "bist", "ist", "sind", "seid"})

# haben/sein — Präteritum (for Plusquamperfekt or simple Präteritum)
HABEN_PRÄT = frozenset({"hatte", "hattest", "hatten", "hattet"})
SEIN_PRÄT  = frozenset({"war", "warst", "waren", "wart"})

# werden — Präsens (for Passiv Präsens)
WERDEN_PRES = frozenset({"wird", "werden", "werde", "wirst", "werdet"})

# werden — Präteritum (for Passiv Präteritum)
WERDEN_PRÄT = frozenset({"wurde", "wurden", "wurdest", "wurdet"})

# Modal verbs — Präsens (A1 baseline marker)
MODALS_PRES = frozenset({
    "kann", "kannst", "können",
    "muss", "musst", "müssen",
    "will", "willst", "wollen",
    "darf", "darfst", "dürfen",
    "soll", "sollst", "sollen",
    "mag",
})

# Modal verbs — Präteritum (A2 marker)
MODAL_PRÄT = frozenset({
    "musste", "musstest", "mussten", "musstet",
    "konnte", "konntest", "konnten", "konntet",
    "wollte", "wolltest", "wollten", "wolltet",
    "sollte", "solltest", "sollten", "solltet",
    "durfte", "durftest", "durften", "durftet",
    "mochte", "mochtest", "mochten", "mochtet",
})

# Konjunktiv II — polite/courtesy forms → A2
KONJ_II_A2 = frozenset({
    "möchte", "möchten", "möchtest", "möchtet",
    "könnte", "könnten", "könntest", "könntet",  # "Könnten Sie...?"
    "dürfte", "dürften", "dürftest", "dürftet",  # "Dürfte ich...?"
    "hätte", "hätten", "hättest", "hättet",       # "Ich hätte gern..."
    "wäre", "wären", "wärst", "wäret",            # "Das wäre schön."
    "müsste", "müssten", "müsstest", "müsstet",
})

# Konjunktiv II — conditional/hypothetical → B1 (würde is the clearest marker)
KONJ_II_B1 = frozenset({
    "würde", "würden", "würdest", "würdet",
})

# ─── Partizip II detection ────────────────────────────────────────────────────

# Curated irregular Partizip II forms (most common in learner texts)
IRREG_PART_II = frozenset({
    # Core irregular verbs
    "gegangen", "gewesen", "geworden", "gegessen", "getrunken",
    "gefahren", "geschrieben", "gelesen", "gesehen", "gehört",
    "gesprochen", "geblieben", "gesessen", "gestanden", "gelegen",
    "gesungen", "genommen", "gegeben", "gekommen", "geflogen",
    "geschwommen", "getroffen", "gefunden", "verloren", "vergessen",
    "gefallen", "geschlafen", "gehalten", "gerufen", "geschnitten",
    "geholfen", "geworfen", "gezogen", "getragen", "geschlagen",
    "gebissen", "gelaufen", "gebracht", "gedacht", "gewusst",
    "gewaschen", "gestiegen", "gestorben",
    # Separable verbs
    "aufgestanden", "eingeschlafen", "angekommen", "abgefahren",
    "mitgenommen", "weggegangen", "ausgegangen", "eingegangen",
    "eingegeben", "angerufen", "aufgehört", "eingekauft",
    "herausgekommen", "zurückgekommen", "aufgewacht", "eingestiegen",
    "ausgestiegen", "stattgefunden", "teilgenommen", "aufgenommen",
    "angefangen", "abgebrochen", "angeschaut", "umgezogen",
    "eingezogen", "ausgezogen", "aufgemacht", "zugemacht",
    "aufgeräumt", "abgeholt", "abgegeben", "angeboten", "mitgemacht",
    "hergestellt", "vorgestellt", "eingestellt", "vorgeschlagen",
    "aufgeschrieben", "abgeschrieben", "weitergegangen", "umgestiegen",
    # Inseparable prefix verbs
    "beschrieben", "bekommen", "verstanden", "entschieden",
    "empfohlen", "versucht", "erklärt",
    # Regular but very common
    "gearbeitet", "gelernt", "geübt", "gespielt", "gemacht",
    "gekauft", "gefragt", "gewartet", "geholfen", "gewohnt",
    "gesucht", "gestellt", "gesagt", "gebraucht", "gezeigt",
    "geöffnet", "geschlossen", "bezahlt", "bestellt", "besucht",
    "erzählt", "gereist", "gewählt", "bezeichnet", "erklärt",
    "gepackt", "telefoniert", "reserviert", "studiert", "passiert",
})

# Nouns/adjectives that could false-positive as Partizip II (-t endings with ge-)
FALSE_POS_PART = frozenset({
    "gedicht", "gericht", "gesetz", "gewicht", "gesicht", "gerät",
    "geschäft", "geschlecht", "gesundheit", "gehalt", "gewinn",
    "geruch", "gesang", "getränk", "gespräch", "gebiet", "gelände",
    "bericht", "bezirk", "bereich", "betrieb", "besitz",
})

# Regex for regular Partizip II forms (only -t endings, safer than -en)
_REG_PART_RE = re.compile(
    r'\b(?:'
    r'ge[a-zäöüß]{3,}e?t'                    # ge...t / ge...et (gemacht, gewartet)
    r'|[a-zäöüß]{2,}ge[a-zäöüß]{2,}e?[nt]'  # separable: einge...t/en (eingegeben)
    r'|[a-zäöüß]+iert'                        # ...iert (telefoniert, reserviert)
    r'|be[a-zäöüß]{3,}t'                     # be...t (bestellt, bezahlt)
    r'|er[a-zäöüß]{3,}t'                     # er...t (erklärt, erledigt)
    r'|ver[a-zäöüß]{3,}t'                    # ver...t (verkauft, versucht)
    r'|ent[a-zäöüß]{3,}t'                    # ent...t (entdeckt, entschuldigt)
    r')\b',
    re.IGNORECASE
)


def _has_partizip_ii(text_lower: str, tokens: list) -> bool:
    """Check if text contains a Partizip II form (irregular list or regex)."""
    # Irregular list (most reliable, curated)
    if any(t in IRREG_PART_II for t in tokens):
        return True
    # Regex for regular forms
    m = _REG_PART_RE.search(text_lower)
    if m and m.group(0).lower() not in FALSE_POS_PART:
        return True
    return False


# ─── Subordinating conjunctions ───────────────────────────────────────────────

A2_SUBORDINATORS = frozenset({"weil", "dass", "ob", "wenn", "als"})

B1_SUBORDINATORS = frozenset({
    "obwohl", "während", "nachdem", "bevor", "seitdem",
    "sodass", "solange", "sobald", "indem", "sofern", "falls",
    "vorausgesetzt", "insofern",
})

# ─── Genitiv prepositions (B1) ────────────────────────────────────────────────

B1_GENITIV = frozenset({
    "wegen", "aufgrund", "mithilfe", "anstelle", "anlässlich",
    "infolge", "trotz", "mangels", "dank", "kraft", "laut",
})

# ─── Regex patterns ───────────────────────────────────────────────────────────

# Relativsatz: comma + relative pronoun (B1)
_RELATIV_RE = re.compile(
    r',\s*(?:der|die|das|den|dem|denen|deren|dessen)\b',
    re.IGNORECASE
)

# Passiv Perfekt: ist/sind/war/waren ... worden (B2)
_WORDEN_RE = re.compile(r'\bworden\b', re.IGNORECASE)

# B2 double conjunctions
_B2_JE_DESTO     = re.compile(r'\bje\b.{1,80}\b(?:desto|umso)\b', re.IGNORECASE | re.DOTALL)
_B2_NICHT_NUR    = re.compile(r'\bnicht\s+nur\b', re.IGNORECASE)
_B2_SOWOHL       = re.compile(r'\bsowohl\b.{1,80}\bals\s+auch\b', re.IGNORECASE | re.DOTALL)
_B2_WEDER        = re.compile(r'\bweder\b.{1,80}\bnoch\b', re.IGNORECASE | re.DOTALL)

# C1: sein + zu + Infinitiv ("Das ist schwer zu lösen")
_C1_SEIN_ZU      = re.compile(
    r'\b(?:ist|sind|war|waren|wäre|sei|wären)\b.{0,40}\bzu\b\s+\w+en\b',
    re.IGNORECASE | re.DOTALL
)

# C1: sich lassen + Infinitiv ("Das lässt sich leicht erklären")
_C1_LASSEN_SICH  = re.compile(
    r'\b(?:lässt|lassen|ließ|ließen)\b.{0,40}\bsich\b',
    re.IGNORECASE | re.DOTALL
)


# ─── Individual detectors ─────────────────────────────────────────────────────

def detect_c1(text: str) -> GrammarFeature | None:
    """C1: sein+zu+Infinitiv, sich lassen."""
    if _C1_LASSEN_SICH.search(text):
        return GrammarFeature("sich lassen + Infinitiv", "C1", 0.88)
    if _C1_SEIN_ZU.search(text):
        return GrammarFeature("sein + zu + Infinitiv", "C1", 0.82)
    return None


def detect_b2(text: str) -> GrammarFeature | None:
    """B2: je…desto, weder…noch, sowohl…als auch, nicht nur…sondern auch."""
    if _B2_JE_DESTO.search(text):
        return GrammarFeature("je…desto Konstruktion", "B2", 0.92)
    if _B2_SOWOHL.search(text):
        return GrammarFeature("sowohl…als auch", "B2", 0.90)
    if _B2_WEDER.search(text):
        return GrammarFeature("weder…noch", "B2", 0.90)
    if _B2_NICHT_NUR.search(text):
        return GrammarFeature("nicht nur…sondern auch", "B2", 0.85)
    return None


def detect_passiv(text: str, tokens: list) -> GrammarFeature | None:
    """
    B2: Passiv Perfekt (ist/sind...worden)
    B1: Passiv Präsens (wird + Part.II) or Passiv Präteritum (wurde + Part.II)
    """
    text_lower = text.lower()
    # B2 first
    if _WORDEN_RE.search(text_lower):
        return GrammarFeature("Passiv Perfekt (…worden)", "B2", 0.90)
    # B1 Passiv Präsens
    if any(t in WERDEN_PRES for t in tokens) and _has_partizip_ii(text_lower, tokens):
        return GrammarFeature("Passiv Präsens (wird + Part.II)", "B1", 0.82)
    # B1 Passiv Präteritum
    if any(t in WERDEN_PRÄT for t in tokens) and _has_partizip_ii(text_lower, tokens):
        return GrammarFeature("Passiv Präteritum (wurde + Part.II)", "B1", 0.82)
    return None


def detect_subordinators(tokens: list) -> GrammarFeature | None:
    """B1 or A2 subordinating conjunctions."""
    b1 = next((t for t in tokens if t in B1_SUBORDINATORS), None)
    if b1:
        return GrammarFeature(f"B1-Nebensatz ({b1})", "B1", 0.90)
    a2 = next((t for t in tokens if t in A2_SUBORDINATORS), None)
    if a2:
        return GrammarFeature(f"A2-Nebensatz ({a2})", "A2", 0.88)
    return None


def detect_relativsatz(text: str) -> GrammarFeature | None:
    """B1: Relativsatz detected by comma + relative pronoun."""
    if _RELATIV_RE.search(text):
        return GrammarFeature("Relativsatz", "B1", 0.85)
    return None


def detect_infinitiv_konstruktionen(text: str) -> GrammarFeature | None:
    """B1: um…zu, ohne…zu, statt…zu / anstatt…zu."""
    tl = text.lower()
    if re.search(r'\bum\b.{0,60}\bzu\b', tl):
        return GrammarFeature("um…zu Konstruktion", "B1", 0.85)
    if re.search(r'\bohne\b.{0,60}\bzu\b', tl):
        return GrammarFeature("ohne…zu Konstruktion", "B1", 0.88)
    if re.search(r'\b(?:statt|anstatt)\b.{0,60}\bzu\b', tl):
        return GrammarFeature("statt…zu Konstruktion", "B1", 0.88)
    return None


def detect_genitiv_preps(tokens: list) -> GrammarFeature | None:
    """B1: Genitiv prepositions (wegen, aufgrund, trotz…)."""
    found = next((t for t in tokens if t in B1_GENITIV), None)
    if found:
        return GrammarFeature(f"Genitiv-Präposition ({found})", "B1", 0.80)
    return None


def detect_konjunktiv(tokens: list) -> GrammarFeature | None:
    """A2 polite Konjunktiv II OR B1 conditional würde."""
    b1 = next((t for t in tokens if t in KONJ_II_B1), None)
    if b1:
        return GrammarFeature(f"Konjunktiv II Konditional ({b1})", "B1", 0.85)
    a2 = next((t for t in tokens if t in KONJ_II_A2), None)
    if a2:
        return GrammarFeature(f"Konjunktiv II höflich ({a2})", "A2", 0.88)
    return None


def detect_reflexive(text: str, tokens: list) -> GrammarFeature | None:
    """A2: reflexive verbs (sich / mich / dich / uns / euch as reflexive pronoun).
    Excludes sich lassen (C1, handled separately).
    """
    # 3rd person / formal: sich
    if "sich" in tokens and not _C1_LASSEN_SICH.search(text):
        return GrammarFeature("Reflexives Verb (sich)", "A2", 0.85)
    # 1st/2nd person reflexive: mich, dich, uns, euch — only if paired with typical
    # reflexive verbs (freuen, erinnern, ärgern, fühlen, vorstellen, befinden, etc.)
    _REFLEX_VERBS = {
        "freue", "freust", "freut", "freuen",
        "erinnere", "erinnerst", "erinnert", "erinnern",
        "ärger", "ärgere", "ärgerst", "ärgert", "ärgern",
        "fühle", "fühlst", "fühlt", "fühlen",
        "vorstelle", "vorstellst", "vorstellt", "vorstellen",
        "befinde", "befindest", "befindet", "befinden",
        "beschäftige", "beschäftigst", "beschäftigt", "beschäftigen",
        "interessiere", "interessierst", "interessiert", "interessieren",
        "entscheide", "entscheidest", "entscheidet", "entscheiden",
        "bewege", "bewegst", "bewegt", "bewegen",
        "wasche", "wäschst", "wäscht", "waschen",
        "setze", "setzt", "setzen",
        "lege", "legst", "legt", "legen",
        "ziehe", "ziehst", "zieht", "ziehen",
    }
    reflexive_prons = {"mich", "dich", "uns", "euch"}
    if any(t in reflexive_prons for t in tokens) and any(t in _REFLEX_VERBS for t in tokens):
        pron = next(t for t in tokens if t in reflexive_prons)
        return GrammarFeature(f"Reflexives Verb ({pron})", "A2", 0.82)
    return None


def detect_modal_prät(tokens: list) -> GrammarFeature | None:
    """A2: Präteritum of modal verbs (musste, konnte, wollte…)."""
    found = next((t for t in tokens if t in MODAL_PRÄT), None)
    if found:
        return GrammarFeature(f"Präteritum-Modal ({found})", "A2", 0.90)
    return None


def detect_modal_pres(tokens: list) -> GrammarFeature | None:
    """A1: modal verbs in Präsens (kann, muss, will…)."""
    found = next((t for t in tokens if t in MODALS_PRES), None)
    if found:
        return GrammarFeature(f"Modalverb Präsens ({found})", "A1", 0.90)
    return None


def detect_tense(text: str, tokens: list) -> list:
    """
    Detect tense-related constructions:
      Plusquamperfekt (B1): hatte/war + Partizip II
      Präteritum (A2): just hatte/war without Partizip II
      Perfekt (A2): habe/hat/haben + Partizip II
      Perfekt mit sein (A2): bin/ist/sind + irregular participle
    Returns a list (may have 0 or 1 feature).
    """
    text_lower = text.lower()
    has_haben_prät = any(t in HABEN_PRÄT for t in tokens)
    has_sein_prät  = any(t in SEIN_PRÄT  for t in tokens)
    has_haben_pres = any(t in HABEN_PRES for t in tokens)
    has_sein_pres  = any(t in SEIN_PRES  for t in tokens)
    has_partizip   = _has_partizip_ii(text_lower, tokens)
    has_irr_part   = any(t in IRREG_PART_II for t in tokens)

    # Plusquamperfekt (hatte/war + Partizip II) — B1
    if (has_haben_prät or has_sein_prät) and has_partizip:
        return [GrammarFeature("Plusquamperfekt", "B1", 0.78)]

    # Simple Präteritum (hatte/war WITHOUT Partizip II) — A2
    if has_haben_prät or has_sein_prät:
        return [GrammarFeature("Präteritum (hatte/war)", "A2", 0.88)]

    # Perfekt with haben (habe/hat + Partizip II) — A2, most reliable
    if has_haben_pres and has_partizip:
        return [GrammarFeature("Perfekt (haben + Part.II)", "A2", 0.92)]

    # Perfekt with sein (bin/ist/sind + known irregular motion/state participle) — A2
    # Only use irregular list here (not regex) to avoid false positives with "ist schön"
    if has_sein_pres and has_irr_part:
        # Make sure 'worden' is not present (that's Passiv, handled separately)
        if not _WORDEN_RE.search(text_lower):
            return [GrammarFeature("Perfekt (sein + Part.II)", "A2", 0.85)]

    return []


# ─── Main entry point ─────────────────────────────────────────────────────────

def detect_all_features_de(text: str) -> list:
    """
    Run all grammar detectors for German and return a list of GrammarFeature.
    Detection is ordered highest-level first to allow early return for rare constructions.
    """
    tokens  = _tokenize(text)
    features = []

    # C1 — highest priority
    c1 = detect_c1(text)
    if c1:
        features.append(c1)
        return features  # C1 is decisive, no need to check further

    # B2
    b2 = detect_b2(text)
    if b2:
        features.append(b2)

    # Passiv (may be B1 or B2)
    passiv = detect_passiv(text, tokens)
    if passiv:
        features.append(passiv)

    # B1 subordinators / relativsatz / infinitive constructions / genitiv
    subord = detect_subordinators(tokens)
    if subord:
        features.append(subord)

    rel = detect_relativsatz(text)
    if rel:
        features.append(rel)

    inf = detect_infinitiv_konstruktionen(text)
    if inf:
        features.append(inf)

    gen = detect_genitiv_preps(tokens)
    if gen:
        features.append(gen)

    # Konjunktiv II (A2 or B1 depending on form)
    konj = detect_konjunktiv(tokens)
    if konj:
        features.append(konj)

    # A2: modal Präteritum, reflexive
    modal_p = detect_modal_prät(tokens)
    if modal_p:
        features.append(modal_p)

    reflexive = detect_reflexive(text, tokens)
    if reflexive:
        features.append(reflexive)

    # Tense constructions (Perfekt, Plusquamperfekt, Präteritum)
    tense_features = detect_tense(text, tokens)
    features.extend(tense_features)

    # A1: modal verbs in Präsens (only add if nothing else was detected)
    if not features:
        modal_pres = detect_modal_pres(tokens)
        if modal_pres:
            features.append(modal_pres)

    return features
