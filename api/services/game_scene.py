"""Fixed world data and authoritative transitions; no AI or database dependency."""
import json
import re
from pathlib import Path

LIBRARY = json.loads((Path(__file__).parents[1] / 'game_config' / 'library.json').read_text(encoding='utf-8'))
NEIGHBOR = json.loads((Path(__file__).parents[1] / 'game_config' / 'neighbor.json').read_text(encoding='utf-8'))
CATALOG = {book['id']: book for book in LIBRARY['catalog']}
MAX_TURNS = 40
HISTORY_MESSAGES = 24


def scenario_for(state):
    # Rows written before the social scenario have no situation marker.
    return NEIGHBOR if state.get('situation_id') == NEIGHBOR['scene']['situation_id'] else LIBRARY


def initial_scene():
    return {'criteria': {}, 'offered_book_id': None, 'borrowed_book_id': None,
            'outcome': 'ongoing', 'slow_speech': False, 'simple_language': False}


def normalized_title(text):
    return re.sub(r'[^\w]+', ' ', text.casefold()).strip()


def clarification(state):
    criteria = state['criteria']
    matches = [b for b in CATALOG.values() if all(b.get(key) == value for key, value in criteria.items())]
    questions = []
    for key, question in [
        ('subject', 'Welches Thema interessiert Sie?'),
        ('setting', 'Möchten Sie Gemüse auf dem Balkon oder im Garten anbauen?'),
        ('audience', 'Sind Sie Anfänger oder haben Sie schon Erfahrung?'),
    ]:
        if key not in criteria and len({b.get(key) for b in matches}) > 1:
            questions.append(question)
    if not questions:
        questions = ['Können Sie genauer sagen, welches Buch Sie suchen?']
    return {'kind': 'clarify', 'fact': 'Der Wunsch ist noch nicht eindeutig.', 'questions': questions}


def advance_scene(current, intent):
    """Semantic intent is evidence, never a book ID or a success verdict."""
    state = {**current, 'criteria': dict(current['criteria'])}
    action = intent.action
    if intent.confidence < .75:
        return state, {'kind': 'clarify', 'fact': 'Die Aussage wurde nicht sicher verstanden.',
                       'questions': ['Entschuldigung, können Sie das bitte anders sagen?']}
    if action == 'slow':
        state['slow_speech'] = True
        return state, {'kind': 'slow', 'fact': 'Ich spreche jetzt langsamer.'}
    if action == 'simplify':
        state['simple_language'] = True
        return state, {'kind': 'simplify', 'fact': ''}
    if action == 'repeat':
        return state, {'kind': 'repeat', 'fact': ''}
    if action == 'chat':
        return state, {'kind': 'chat', 'fact': ''}
    if action == 'decline':
        state.update(criteria={}, offered_book_id=None)
        return state, clarification(state)
    if state['borrowed_book_id']:
        book = CATALOG[state['borrowed_book_id']]
        return state, {'kind': 'already_borrowed', 'fact': f'Sie haben „{book["title"]}“ bereits ausgeliehen.'}
    if action == 'confirm' or (action == 'borrow' and not intent.requested_title and
                              not intent.criteria.model_dump(exclude_none=True)):
        book = CATALOG.get(state['offered_book_id'])
    else:
        criteria = intent.criteria.model_dump(exclude_none=True)
        if intent.requested_title or (criteria.get('subject') and state['criteria'].get('subject') and
                                     criteria['subject'] != state['criteria'].get('subject')):
            state['criteria'] = {}
        state['criteria'].update(criteria)
        state['offered_book_id'] = None
        if not criteria and not intent.requested_title:
            return state, clarification(state)
        if intent.requested_title:
            book = next((b for b in CATALOG.values() if
                         normalized_title(b['title']) == normalized_title(intent.requested_title)), None)
            if not book:
                return state, {'kind': 'not_found', 'fact': 'Dieses Buch gehört nicht zu unserem Katalog.'}
        else:
            matches = [b for b in CATALOG.values() if state['criteria'] and all(
                b.get(key) == value for key, value in state['criteria'].items())]
            if not matches:
                return state, {'kind': 'not_found', 'fact': 'Zu diesem Wunsch habe ich kein passendes Buch in unserem Katalog.'}
            book = matches[0] if len(matches) == 1 else None
    if not book:
        return state, clarification(state)
    if not book['available']:
        return state, {'kind': 'unavailable', 'fact': f'„{book["title"]}“ ist leider bereits ausgeliehen.'}
    if action in ('borrow', 'confirm'):
        state['borrowed_book_id'] = book['id']
        state['offered_book_id'] = None
        state['outcome'] = 'success' if book['id'] == LIBRARY['scene']['target_book_id'] else 'other_book'
        return state, {'kind': 'borrowed', 'fact': f'Hier ist „{book["title"]}“. Sie haben das Buch jetzt ausgeliehen.'}
    state['offered_book_id'] = book['id']
    return state, {'kind': 'offered', 'fact': f'„{book["title"]}“ passt zu Ihrem Wunsch und ist verfügbar. Möchten Sie es ausleihen?'}


def hint_for(state):
    if state['offered_book_id']:
        return 'Wenn das Buch passt, können Sie sagen: „Ja, das möchte ich ausleihen.“'
    return ('Beschreiben Sie das Thema, den Ort und Ihre Erfahrung. Zum Beispiel: '
            '„Ich möchte Gemüse auf meinem Balkon anbauen. Ich bin Anfänger.“')
