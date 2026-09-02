#!/usr/bin/env python
"""
Build German CEFR vocabulary profiles for the local classifier.

Outputs:
  - api/services/classifier/data/vocab_de_medium.json
  - api/services/classifier/data/vocab_de_max.json
  - app/src/services/classifier/data/vocab_de_medium.json
  - app/src/services/classifier/data/vocab_de_max.json
"""

import json
import os
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
API_DATA = PROJECT_ROOT / "api" / "services" / "classifier" / "data"
APP_DATA = PROJECT_ROOT / "app" / "src" / "services" / "classifier" / "data"
BASE_VOCAB = API_DATA / "vocab_de.json"

VALID_LEVELS = {"A1", "A2", "B1", "B2", "C1", "C2"}


def merge_groups(*groups):
    data = {}
    for group in groups:
        for level, words in group.items():
            if level not in VALID_LEVELS:
                raise ValueError(f"Invalid CEFR level: {level}")
            for word in words:
                clean = word.strip().lower()
                if clean:
                    data[clean] = level
    return data


def weak_verb_forms(infinitives):
    forms = set()
    no_ge_prefixes = (
        "be", "emp", "ent", "er", "ge", "miss", "ver", "zer",
    )
    for infinitive in infinitives:
        verb = infinitive.strip().lower()
        if not verb:
            continue
        if verb.endswith("eln"):
            stem = verb[:-1]
        elif verb.endswith("ern"):
            stem = verb[:-1]
        elif verb.endswith("en"):
            stem = verb[:-2]
        elif verb.endswith("n"):
            stem = verb[:-1]
        else:
            stem = verb

        forms.update({verb, f"{stem}e", f"{stem}st", f"{stem}t", f"{stem}en"})
        if verb.endswith("ieren"):
            forms.add(f"{stem}t")
        elif verb.startswith(no_ge_prefixes):
            forms.add(f"{stem}t")
        else:
            forms.add(f"ge{stem}t")
    return sorted(forms)


def adjective_forms(adjectives):
    forms = set()
    for adjective in adjectives:
        adj = adjective.strip().lower()
        if not adj:
            continue
        forms.update({adj, f"{adj}e", f"{adj}en", f"{adj}er", f"{adj}es", f"{adj}em"})
    return sorted(forms)


COMMON_MEDIUM = merge_groups(
    {
        "A1": [
            "abend", "abends", "adresse", "alle", "alles", "alt", "alte", "alten", "ander", "andere",
            "anderen", "anders", "antwort", "apfel", "arzt", "auto", "bahnhof", "bald", "bank",
            "baum", "berlin", "bett", "bild", "bilder", "blume", "blumen", "brief", "brot", "bruder",
            "buch", "bücher", "café", "deutsch", "deutsche", "deutschland", "dienstag", "donnerstag",
            "dorf", "drei", "elf", "eltern", "ende", "essen", "familie", "fenster", "firma", "foto",
            "fotos", "frau", "freund", "freunde", "freundin", "garten", "geburtstag", "geld", "gerade",
            "gern", "gerne", "geschenk", "glas", "glück", "gute", "guten", "haus", "hause", "hemd",
            "herr", "hund", "jahr", "jahre", "kaffee", "karte", "katze", "kind", "kinder", "kleid",
            "kleine", "kleinen", "kleidung", "kuchen", "laden", "land", "leben", "lehrer", "lehrerin",
            "liebe", "lieber", "licht", "mittag", "montag", "morgen", "mutter", "nacht", "name",
            "nummer", "obst", "park", "person", "platz", "preis", "reise", "restaurant", "samstag",
            "schule", "schuhe", "schwester", "sofa", "sohn", "sommer", "stadt", "straße", "stunde",
            "stunden", "tag", "tage", "tee", "telefon", "tochter", "tür", "uhr", "urlaub", "vater",
            "wasser", "woche", "wochenende", "wohnung", "wort", "wörter", "zeit", "zimmer", "zwei",
        ],
        "A2": [
            "abgeschlossen", "abholen", "abgeholt", "ablehnen", "abteilung", "allein", "anfangen",
            "angefangen", "angst", "anrufen", "angerufen", "antworten", "anziehen", "arbeit",
            "arbeiten", "arbeitet", "arzttermin", "aufgabe", "aufgaben", "aufstehen", "ausflug",
            "ausflüge", "ausfüllen", "ausgefüllt", "ausgeben", "aussehen", "bahnhof", "beim",
            "bekommen", "bekommt", "bezahlen", "bezahlt", "bisschen", "bleiben", "bleibt", "brauche",
            "brauchst", "chef", "chefin", "dabei", "darauf", "dativ", "deshalb", "deutschen",
            "einfach", "einladen", "einmal", "einkaufen", "einkauf", "entschuldigung", "erlaubnis",
            "essen", "falsch", "fehler", "ferien", "finde", "findet", "fliegen", "frage", "fragen",
            "früher", "fühle", "fühlen", "gebäude", "geflogen", "gegangen", "gehört", "gemeinsam",
            "gemacht", "genug", "gereist", "gesagt", "geschlafen", "gespräch", "gestern", "gesund",
            "gleich", "günstig", "heizung", "helfen", "hilft", "jacke", "jeden", "kaputt", "kaufe",
            "kaufen", "klingt", "kollege", "kollegen", "kollegin", "komme", "kommen", "kommst",
            "kommt", "konnten", "konnte", "kunden", "kunde", "läuft", "lange", "lass", "leicht",
            "letzte", "letzten", "letztes", "magst", "macht", "mache", "maschine", "meer", "müde",
            "monat", "nachbar", "nachbarn", "nächste", "nächsten", "nett", "notizen", "okay", "paar",
            "passt", "passiert", "pause", "poster", "prüfung", "recht", "schlafen", "schlage",
            "schlüssel", "sehe", "sehen", "sicher", "siehst", "sport", "später", "steht", "strand",
            "streichen", "super", "tanzen", "termin", "total", "traurig", "trägt", "treffen",
            "verstanden", "verstehen", "vergessen", "vorbereiten", "warte", "wechseln", "weiß",
            "weißt", "wetter", "wieder", "wirklich", "wollte", "zuerst", "zusammen",
        ],
        "B1": [
            "akkusativ", "alltag", "ändern", "argument", "aufmerksamkeit", "ausbildung", "ausdruck",
            "ausnahme", "bedeutung", "bedingung", "bedingungen", "begriff", "begründen", "begründung",
            "beschreibung", "beschäftigt", "bestehen", "bestanden", "bevor", "beziehung", "chance",
            "darüber", "darum", "diskussion", "eigenschaft", "einladung", "empfehlung", "entscheidung",
            "entscheiden", "erinnern", "erklären", "erklärung", "erwartung", "fall", "folge", "folgen",
            "fühlen", "gefühl", "gefühle", "grund", "gründe", "häufig", "hoffnung", "interesse",
            "interessiert", "komisch", "kommunikation", "konflikt", "kontakt", "lösung", "meinung",
            "meistens", "möglich", "möglichkeit", "notwendig", "plan", "planung", "präposition",
            "präpositionen", "problem", "regel", "regeln", "rolle", "schwierigkeit", "situation",
            "trotzdem", "umgang", "unterschied", "vorschlag", "wechselpräpositionen", "wirkung",
            "ziemlich", "zweifel",
        ],
        "B2": [
            "analyse", "anforderung", "anforderungen", "anspruch", "auswertung", "bereich", "bereiche",
            "beruflich", "bewertung", "datenschutz", "effektiv", "effizienz", "entwicklung",
            "erforderlich", "erfolgreich", "erfahrung", "fachlich", "funktion", "funktionen",
            "geschäftlich", "grundlage", "herausforderung", "konsequenz", "konzept", "kunden",
            "management", "manager", "maßnahme", "maßnahmen", "organisation", "priorität", "projekt",
            "qualität", "relevant", "ressource", "risiko", "struktur", "system", "umsetzung",
            "verantwortlich", "vereinbarung", "verhalten", "verfahren", "verfügung", "wirtschaft",
        ],
        "C1": [
            "abstrakt", "ambivalent", "differenziert", "diskurs", "komplexität", "nachvollziehbar",
            "paradigma", "rechtsprechung", "steuerrecht", "strukturell", "verfassungsrechtlich",
            "widerspruch", "zweckentfremdungsverbot",
        ],
    }
)

GENERATED_MAX = merge_groups(
    {
        "A1": (
            weak_verb_forms([
                "antworten", "arbeiten", "brauchen", "fragen", "glauben", "heiraten", "hören",
                "kaufen", "kochen", "kosten", "lernen", "machen", "passen", "reisen", "sagen",
                "spielen", "suchen", "tanzen", "telefonieren", "warten", "wohnen", "zeigen",
            ])
            + adjective_forms([
                "alt", "billig", "blau", "braun", "dunkel", "einfach", "falsch", "freundlich",
                "gelb", "gesund", "groß", "grün", "gut", "heiß", "jung", "kalt", "klein",
                "kurz", "lang", "langsam", "leicht", "müde", "neu", "nett", "rot", "schlecht",
                "schnell", "schön", "spät", "teuer", "warm", "weiß",
            ])
        ),
        "A2": (
            weak_verb_forms([
                "abholen", "abmelden", "ändern", "anmelden", "anrufen", "ausdrucken",
                "ausfüllen", "bezahlen", "buchen", "drucken", "einkaufen", "einladen",
                "erklären", "erledigen", "fühlen", "gehören", "herunterladen", "hochladen",
                "installieren", "klicken", "mieten", "öffnen", "probieren", "reservieren",
                "schließen", "speichern", "studieren", "wiederholen", "zahlen",
            ])
            + adjective_forms([
                "allein", "bequem", "besetzt", "frei", "gefährlich", "günstig", "kaputt",
                "krank", "leise", "letzte", "nächste", "pünktlich", "ruhig", "sauber",
                "schmutzig", "sicher", "traurig", "wichtig", "zufrieden",
            ])
        ),
        "B1": (
            weak_verb_forms([
                "beantragen", "beantworten", "bedeuten", "begründen", "beschreiben",
                "beschäftigen", "diskutieren", "entwickeln", "erinnern", "erwähnen",
                "funktionieren", "organisieren", "planen", "präsentieren", "vergleichen",
                "verbessern", "vorbereiten",
            ])
            + adjective_forms([
                "abhängig", "allgemein", "beruflich", "deutlich", "ehrlich", "häufig",
                "interessant", "kompliziert", "möglich", "notwendig", "persönlich",
                "schwierig", "typisch", "unmöglich", "verschieden", "ziemlich",
            ])
        ),
        "B2": (
            weak_verb_forms([
                "analysieren", "auswerten", "berücksichtigen", "digitalisieren", "evaluieren",
                "gewährleisten", "implementieren", "optimieren", "priorisieren", "realisieren",
                "strukturieren", "verschlüsseln",
            ])
            + adjective_forms([
                "effektiv", "effizient", "erforderlich", "fachlich", "finanziell",
                "individuell", "komplex", "professionell", "relevant", "strategisch",
                "transparent", "wirtschaftlich",
            ])
        ),
    }
)

MAX_EXTRA = merge_groups(
    {
        "A1": [
            "acht", "apotheke", "bad", "beispiel", "birne", "bus", "dein", "dich", "dort", "eltern",
            "fisch", "fleisch", "fünf", "große", "grün", "hallo", "heiß", "heute", "hose", "immer",
            "jung", "käse", "krank", "küche", "kurz", "lang", "milch", "minute", "minuten", "rot",
            "salat", "schlecht", "sieben", "stuhl", "tisch", "vier", "warm", "wein", "zehn",
        ],
        "A2": [
            "abfahrt", "ankunft", "anmeldung", "antrag", "anzeige", "arm", "artikel", "aufmachen",
            "ausziehen", "bestellen", "bestellt", "besuchen", "besucht", "bezirk", "billig", "dauern",
            "drucker", "einsteigen", "eintritt", "erledigen", "erledigt", "fahrkarte", "formular",
            "füllen", "gebühr", "geöffnet", "geschlossen", "girokonto", "haltestelle", "hochladen",
            "installieren", "konto", "krankenkasse", "krankenversicherung", "leihen", "miete",
            "mitbringen", "mitnehmen", "passen", "patient", "quittung", "rezept", "schließen",
            "schwierig", "senden", "sparbuch", "speichern", "umsteigen", "unterschrift", "vermieter",
            "verspätung", "versicherung", "zahlung",
        ],
        "B1": [
            "absicht", "abhängig", "allgemein", "ansicht", "auswirkung", "beantragen", "beeinflussen",
            "beitrag", "berichten", "beschreiben", "bescheid", "besteht", "betreffen", "beweisen",
            "darstellung", "diskutieren", "einfluss", "einschätzung", "empfehlen", "entstehen",
            "entschieden", "ergebnis", "ergebnisse", "erleben", "erwähnen", "gesellschaft", "hinweis",
            "inhalt", "kritik", "nachteil", "nachteile", "nutzen", "persönlich", "präsentation",
            "reaktion", "schritt", "schritte", "teilnehmen", "teilgenommen", "ursache", "ursachen",
            "verbessern", "vergleich", "vergleichen", "vorteil", "vorteile", "weiterbildung",
            "zusammenhang",
        ],
        "B2": [
            "abwicklung", "akzeptanz", "ansatz", "ausführlich", "berücksichtigen", "datenbank",
            "digitalisierung", "einführung", "einschränkung", "einschließlich", "einschätzung",
            "finanziell", "flexibilität", "fortschritt", "gewährleisten", "hinsichtlich",
            "implementieren", "individuell", "infrastruktur", "integration", "intensiv", "kapazität",
            "kompetenz", "kompetenzen", "kooperation", "leistungsfähigkeit", "nachhaltigkeit",
            "optimieren", "parameter", "perspektive", "produktivität", "professionell", "prozess",
            "prozesse", "qualifikation", "qualifiziert", "realisieren", "strategie", "strategien",
            "strukturieren", "transparenz", "verschlüsseln", "wirtschaftlich",
        ],
        "C1": [
            "authentizität", "dezentralisierung", "diskrepanz", "epistemologie", "hermeneutik",
            "implikation", "konstitutionell", "legitimation", "paradigmenwechsel", "subsidiarität",
            "terminologie", "theoretisch", "wahrnehmung",
        ],
        "C2": [
            "axiom", "jurisprudenz", "postulat",
        ],
    }
)


def load_base():
    with open(BASE_VOCAB, encoding="utf-8") as f:
        return json.load(f)


def write_vocab(path, vocab):
    path.parent.mkdir(parents=True, exist_ok=True)
    ordered = dict(sorted(vocab.items(), key=lambda item: item[0]))
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(ordered, f, ensure_ascii=False, indent=2)
        f.write("\n")


def main():
    base = load_base()
    medium = {**base, **COMMON_MEDIUM}
    max_vocab = {**medium, **MAX_EXTRA, **GENERATED_MAX}

    outputs = {
        "medium": medium,
        "max": max_vocab,
    }

    for profile, vocab in outputs.items():
        for data_dir in (API_DATA, APP_DATA):
            path = data_dir / f"vocab_de_{profile}.json"
            write_vocab(path, vocab)
        print(f"{profile}: {len(vocab)} entries")


if __name__ == "__main__":
    main()
