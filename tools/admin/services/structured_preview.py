"""Read-only presentation adapter over the authoritative V2 loader/converter."""
import json
from collections import Counter

from pydantic import ValidationError

from api.services.structured_cards_v2 import load_document
from api.services.structured_cards_legacy import LegacyConversionError, to_legacy_card


def preview_document(text):
    try:
        document = load_document(text)
    except ValidationError as exc:
        errors = []
        for error in exc.errors(include_url=False, include_context=False, include_input=False):
            loc = error['loc']
            # Discriminator labels identify model branches, not JSON fields.
            tags = {'theory', 'standard', 'trainer', 'quiz', 'match', 'puzzle', 'word_bank',
                    'free_text', 'text', 'input', 'choice', 'gap', 'task', 'source', 'example', 'options'}
            fields = [part for i, part in enumerate(loc) if not (
                i > 0 and i + 1 < len(loc) and isinstance(loc[i - 1], int) and part in tags)]
            path = ''.join(f'[{part}]' if isinstance(part, int) else f'.{part}' for part in fields).lstrip('.')
            errors.append({'path': path or '$', 'message': error['msg'],
                           'card_number': loc[1] + 1 if len(loc) > 1 and loc[0] == 'cards'
                           and isinstance(loc[1], int) else None})
        return {'valid': False, 'errors': errors}
    except (ValueError, RecursionError) as exc:
        message = 'JSON nesting is too deep' if isinstance(exc, RecursionError) else str(exc)
        error = {'path': '$', 'message': message, 'card_number': None}
        if isinstance(exc, json.JSONDecodeError):
            error.update(line=exc.lineno, column=exc.colno)
        return {'valid': False, 'errors': [error]}

    projections = []
    for index, card in enumerate(document.cards):
        if card.type not in ('theory', 'standard', 'trainer', 'match', 'puzzle', 'quiz'):
            projections.append({'status': 'unsupported'})
            continue
        try:
            projections.append({'status': 'converted', 'card': to_legacy_card(card, document.deck, index)})
        except LegacyConversionError as exc:
            projections.append({'status': 'unrepresentable', 'message': str(exc)})
    return {'valid': True, 'errors': [], 'document': document.model_dump(mode='json'),
            'total_cards': len(document.cards), 'types': dict(Counter(card.type for card in document.cards)),
            'legacy_projections': projections}
