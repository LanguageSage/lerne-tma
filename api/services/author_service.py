"""
Единое ядро контентного сервиса для автора уроков (Author Content Service).

Предоставляет функции для:
- Сериализации колод/папок в канонический текстовый формат Lerne Codex.
- Парсинга одно- и мультиколодных файлов разметки с валидацией синтаксиса.
- Двухфазного безопасного обновления карточек (preview -> apply без мутации SRS).
- Экспорта колод и папок.
- Публикации новых уроков с созданием папок, колод и сохранением карточек.

Используется одновременно:
- CLI-интерфейсом (`scripts/lerne_author_cli.py`);
- Консолью администратора (отдельный проект `lerne-admin`, `lerne_admin.routers.author`);
- Автоматизацией через AI-агентов.
"""

import os
import re
import uuid
import json
import datetime
from collections import Counter
from pathlib import PurePosixPath
from typing import List, Dict, Any, Optional, Tuple

from api.models import tma_db, TMA_Folder, TMA_Deck, TMA_Card, TMAMedia
from api import services
from api.services.card_text_update import preview_text_update, apply_text_update, preview_folder_text_update, apply_folder_text_update, _content, _digest, _claim_receipt, _require_deck, _require_folder, _folder_paths
from api.services.deck_passport import validate_passport, merge_passport, passport_from_metadata, read_metadata

CARD_SEPARATOR = "<<<LERNE_CARD>>>"


# ============================================================================
# Вспомогательные функции
# ============================================================================

def get_effective_user_id(specified_user_id: Optional[int] = None, target_obj: Any = None) -> int:
    """Определяет ID автора: переданный флаг -> env -> владелец объекта -> ошибка если не определен."""
    if specified_user_id is not None:
        return specified_user_id
    env_id = os.environ.get('AUTHOR_USER_ID') or os.environ.get('ADMIN_USER_ID')
    if env_id and env_id.strip().isdigit():
        return int(env_id.strip())
    if target_obj and getattr(target_obj, 'user_id', None):
        return target_obj.user_id
    raise ValueError(
        "Не удалось определить автора. Укажите user_id явно или задайте AUTHOR_USER_ID / ADMIN_USER_ID в переменных окружения."
    )


# ============================================================================
# Сериализатор текстового формата Lerne
# ============================================================================

def serialize_card(card: TMA_Card, deck_name: Optional[str] = None) -> str:
    value = _content(card)['content_v2']['card']
    # Source references are export metadata, never automatic persistence instructions.
    return json.dumps(value, ensure_ascii=False, indent=2)


def serialize_deck(deck: TMA_Deck, cards: List[TMA_Card]) -> str:
    return json.dumps({'schema_version': 2,
        'deck': {'name': deck.name, 'passport': passport_from_metadata(deck.metadata),
                 'metadata': {**{key: value for key, value in read_metadata(deck.metadata).items()
                                 if key not in ('intro', 'pedagogy')},
                              'source_deck_id': deck.id, 'source_card_ids': [card.id for card in cards]}},
        'cards': [json.loads(serialize_card(card)) for card in cards]}, ensure_ascii=False, indent=2)


def serialize_folder(folder: TMA_Folder, decks_with_cards: List[Tuple[TMA_Deck, List[TMA_Card]]]) -> str:
    return json.dumps([json.loads(serialize_deck(deck, cards)) for deck, cards in decks_with_cards],
                      ensure_ascii=False, indent=2)


# ============================================================================
# Парсер текстового формата Lerne
# ============================================================================







def parse_document(text, default_deck_id=None, default_deck_name=None, *, json_input=False):
    from api.card_core.lerne_card_core.structured_cards_import import import_documents
    result = {key: [] for key in ('cards', 'passports', 'decks', 'errors', 'structure_errors', 'warnings')}
    try:
        documents = import_documents(text, default_deck_name=default_deck_name or 'Новый урок', json_input=json_input)
        for document in documents:
            deck = document.deck
            deck_id = default_deck_id or deck.metadata.get('source_deck_id')
            result['decks'].append({'deck_name': deck.name, 'deck_id': deck_id, 'cards_count': len(document.cards)})
            if deck.passport:
                result['passports'].append({'deck_name': deck.name, 'deck_id': deck_id, 'passport': deck.passport})
            source_ids = deck.metadata.get('source_card_ids')
            if source_ids is not None and (not isinstance(source_ids, list) or len(source_ids) != len(document.cards) or any(type(item) is not int or item <= 0 for item in source_ids) or len(set(source_ids)) != len(source_ids)):
                raise ValueError('Invalid source_card_ids export references')
            for index, card in enumerate(document.cards):
                result['cards'].append({'number': len(result['cards']) + 1, 'deck_id': deck_id,
                    'card_id': source_ids[index] if source_ids is not None else int(card.id) if card.id and card.id.isdecimal() else None,
                    'deck_name': deck.name, 'source_id': card.id, 'image_ref': card.image,
                    'content_v2': {'schema_version': 2, 'card': card.model_dump(mode='json')}})
    except (ValueError, RecursionError) as error:
        result = {key: [] for key in result}
        result['errors'] = result['structure_errors'] = [str(error)]
    return result


def parse_uploaded_documents(files):
    """Parse (filename, text) uploads independently, preserving each deck's scope."""
    combined = {key: [] for key in ('cards', 'passports', 'decks', 'errors', 'structure_errors', 'warnings')}
    passport_names = set()
    for filename, text in files:
        name, extension = os.path.splitext(filename)
        document = parse_document(text, default_deck_name=name.strip() or None, json_input=extension.lower() == '.json')
        if not document['cards'] and not document['passports'] and not document['errors']:
            message = 'В файле не найдено ни одной карточки или паспорта.'
            document['errors'].append(message)
            document['structure_errors'].append(message)
        for entry in document['passports']:
            if entry['deck_name'] in passport_names:
                message = f"{entry['deck_name']}: дублирующийся паспорт колоды."
                document['errors'].append(message)
                document['structure_errors'].append(message)
        passport_names.update(entry['deck_name'] for entry in document['passports'])
        for key in combined:
            values = document[key]
            if key in ('errors', 'structure_errors', 'warnings'):
                values = [f'{filename}: {message}' for message in values]
            combined[key].extend(values)
    for number, card in enumerate(combined['cards'], 1):
        card['number'] = number
    return combined


IMAGE_LINK = re.compile(r'!\[[^\]]*\]\(<([^>]+)>\)|!\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)', re.I)
IMAGE_DIRECTIVE = re.compile(r'(?m)^\s*::image\s+(.+?)\s*$')


def _image_key(value):
    """Normalize only safe, relative asset names; never resolve paths on disk."""
    from urllib.parse import unquote, urlsplit
    value = unquote(str(value or '').strip().replace('\\', '/'))
    if not value or value.startswith('/') or '://' in value or value.startswith('data:'):
        return None
    path = urlsplit(value).path
    parts = PurePosixPath(path).parts
    if not parts or any(part in ('.', '..') for part in parts) or ':' in parts[0]:
        return None
    return '/'.join(parts).casefold()


def resolve_import_images(cards, image_names, manifest=None):
    """Return reviewable links; never guess when a filename or card target is ambiguous."""
    manifest = manifest or []
    name_counts = Counter(image_names)
    assets = {}
    for name in image_names:
        key = _image_key(name)
        if key:
            assets.setdefault(key, []).append(name)
    links = []
    manifest_hits = [0] * len(manifest)
    for card in cards:
        refs = []
        if card.get('image_ref'):
            refs.append(card['image_ref'])
        content = card['content_v2']['card']
        def strings(value):
            if isinstance(value, str):
                yield value
            elif isinstance(value, dict):
                for child in value.values():
                    yield from strings(child)
            elif isinstance(value, list):
                for child in value:
                    yield from strings(child)
        for body in strings({key: content.get(key) for key in ('data', 'info', 'explanation')}):
            refs.extend(match.group(1) or match.group(2) for match in IMAGE_LINK.finditer(body))
            refs.extend(IMAGE_DIRECTIVE.findall(body))
        for index, item in enumerate(manifest):
            if (item.get('deck') == card.get('deck_name') and
                (item.get('card') == card.get('source_id') or
                 item.get('card') == card.get('number'))):
                manifest_hits[index] += 1
                refs.append(item.get('file'))
                if not card.get('image_ref'):
                    card['image_ref'] = item.get('file')
        refs = list(dict.fromkeys(refs))
        if not refs:
            continue
        candidates = []
        for ref in refs:
            key = _image_key(ref)
            if key:
                exact = assets.get(key, [])
                basename = [name for asset_key, names in assets.items()
                            if asset_key.rsplit('/', 1)[-1] == key.rsplit('/', 1)[-1]
                            for name in names]
                candidates.extend(exact or basename)
        unique = list(dict.fromkeys(candidates))
        duplicate_file = any(name_counts[name] > 1 for name in unique)
        status = ('matched' if len(refs) == 1 and len(unique) == 1 and not duplicate_file else
                  'missing' if not unique else 'ambiguous')
        if status == 'matched':
            card['image_ref'] = refs[0]
            def remove_image_markup(value):
                if isinstance(value, str):
                    return IMAGE_DIRECTIVE.sub('', IMAGE_LINK.sub('', value))
                if isinstance(value, dict):
                    return {key: remove_image_markup(child) for key, child in value.items()}
                if isinstance(value, list):
                    return list(map(remove_image_markup, value))
                return value
            for field in ('data', 'info', 'explanation'):
                if field in content:
                    original = content[field]
                    content[field] = remove_image_markup(original)
                    if isinstance(original, str) and original != content[field]:
                        content[field] = content[field].strip()
            for key, value in content.get('data', {}).items():
                if isinstance(value, str):
                    content['data'][key] = value.strip()
        links.append({'card_number': card['number'], 'deck': card.get('deck_name'),
                      'references': refs, 'candidates': unique, 'status': status,
                      'file': unique[0] if status == 'matched' else None})
    for item, hits in zip(manifest, manifest_hits):
        if hits != 1:
            links.append({'card_number': None, 'deck': item.get('deck'),
                          'references': [item.get('file')], 'candidates': [],
                          'status': 'missing' if hits == 0 else 'ambiguous', 'file': None})
    return links


def parse_cards_text(text, default_deck_id=None, default_deck_name=None):
    """Native card projection from the single validated document parser."""
    document = parse_document(text, default_deck_id, default_deck_name)
    if document['errors']:
        raise ValueError('\n'.join(document['errors']))
    return document['cards']


def _passport_map(passports):
    result = {}
    for entry in passports or []:
        if not isinstance(entry, dict):
            raise ValueError('Запись паспорта должна быть объектом.')
        name = entry.get('deck_name')
        if not isinstance(name, str) or not name.strip() or name in result:
            raise ValueError('Требуется уникальное название колоды для каждого паспорта.')
        errors = validate_passport(entry.get('passport'))
        if errors:
            raise ValueError(f"{name}: " + '\n'.join(errors))
        if entry.get('deck_id') is not None and (type(entry['deck_id']) is not int or entry['deck_id'] <= 0):
            raise ValueError(f'{name}: некорректный deck_id.')
        result[name] = entry
    return result


def _save_passport(deck, passport):
    merged = merge_passport(deck.metadata, passport)
    if merged != read_metadata(deck.metadata):
        deck.metadata = json.dumps(merged, ensure_ascii=False, allow_nan=False)
        deck.updated_at = datetime.datetime.now()
        deck.save(only=[TMA_Deck.metadata, TMA_Deck.updated_at])


def preview_passports(passports, folder_id=None, user_id=None):
    """Field-level before/after preview, scoped to a selected local-admin folder."""
    result = []
    for name, entry in _passport_map(passports).items():
        deck = None
        if folder_id:
            folder = TMA_Folder.get_or_none(TMA_Folder.id == folder_id, TMA_Folder.is_deleted == False)
            if not folder:
                raise ValueError('Папка не найдена.')
            effective = get_effective_user_id(user_id, folder)
            from api.services.collaborative_service import _require_can_mutate
            _require_can_mutate(effective, 'folder', folder_id)
            matches = list(TMA_Deck.select().where(TMA_Deck.folder_id == folder_id,
                           TMA_Deck.name == name, TMA_Deck.is_deleted == False))
            if len(matches) > 1:
                raise ValueError(f'{name}: несколько колод с этим именем; разрешите конфликт перед импортом.')
            deck = matches[0] if matches else None
            if deck:
                _require_can_mutate(effective, 'deck', deck.id)
        current = read_metadata(deck.metadata) if deck else {}
        merged = merge_passport(current, entry['passport'])
        changes = []
        for section in ('intro', 'pedagogy'):
            if section in entry['passport']:
                for field, value in merged[section].items():
                    before = current.get(section, {}).get(field)
                    if before != value:
                        changes.append({'field': f'{section}.{field}', 'before': before, 'after': value})
        result.append({**entry, 'target_deck_id': deck.id if deck else None, 'changes': changes})
    return result


# ============================================================================
# Операции ЭКСПОРТА (Export)
# ============================================================================

def export_deck_content(deck_id: int, user_id: Optional[int] = None) -> Dict[str, Any]:
    """Экспортирует колоду в текстовый формат Lerne."""
    deck = TMA_Deck.get_or_none(TMA_Deck.id == deck_id, TMA_Deck.is_deleted == False)
    if not deck:
        raise ValueError(f"Колода ID {deck_id} не найдена.")

    cards = list(TMA_Card.select().where(TMA_Card.deck_id == deck.id, TMA_Card.is_deleted == False).order_by(TMA_Card.position, TMA_Card.id))
    serialized = serialize_deck(deck, cards)

    return {
        'deck_id': deck.id,
        'deck_name': deck.name,
        'cards_count': len(cards),
        'text': serialized
    }


def export_folder_content(folder_id: int, user_id: Optional[int] = None) -> Dict[str, Any]:
    """Экспортирует папку со всеми входящими колодами в текстовый формат."""
    folder = TMA_Folder.get_or_none(TMA_Folder.id == folder_id, TMA_Folder.is_deleted == False)
    if not folder:
        raise ValueError(f"Папка ID {folder_id} не найдена.")

    decks = list(TMA_Deck.select().where(TMA_Deck.folder_id == folder.id, TMA_Deck.is_deleted == False).order_by(TMA_Deck.id))
    decks_with_cards = []
    total_cards = 0

    for d in decks:
        cards = list(TMA_Card.select().where(TMA_Card.deck_id == d.id, TMA_Card.is_deleted == False).order_by(TMA_Card.position, TMA_Card.id))
        decks_with_cards.append((d, cards))
        total_cards += len(cards)

    serialized = serialize_folder(folder, decks_with_cards)

    return {
        'folder_id': folder.id,
        'folder_name': folder.name,
        'decks_count': len(decks),
        'cards_count': total_cards,
        'text': serialized
    }


# ============================================================================
# Операции ОБНОВЛЕНИЯ (Update: Preview & Apply)
# ============================================================================

def preview_update_content(
    cards: List[Dict[str, Any]],
    deck_id: Optional[int] = None,
    folder_id: Optional[int] = None,
    user_id: Optional[int] = None,
    passports=None
) -> Dict[str, Any]:
    """
    Выполняет двухфазный расчет предпросмотра обновления карточек.
    Возвращает структуру с diff, токеном preview_token и подсчетом изменений.
    """
    if passports:
        preview = preview_update_content(cards, deck_id, folder_id, user_id)
        plan = _update_passport_plan(passports, preview.get('deck_id'), preview.get('folder_id'), preview['user_id'])
        preview['card_preview_token'] = preview['preview_token']
        preview['preview_token'] = _digest({'cards': preview['card_preview_token'], 'passports': plan})
        preview['passports'] = plan
        return preview
    if not cards:
        raise ValueError("Список карточек пуст.")

    deck_ids = {c['deck_id'] for c in cards if c.get('deck_id')}
    is_multi_deck = len(deck_ids) > 1 or bool(folder_id)

    target_obj = None
    target_deck_id = deck_id or (list(deck_ids)[0] if deck_ids else None)
    target_folder_id = folder_id

    if is_multi_deck:
        if not target_folder_id and deck_ids:
            first_deck = TMA_Deck.get_or_none(TMA_Deck.id == list(deck_ids)[0])
            target_folder_id = first_deck.folder_id if first_deck else None
        if target_folder_id:
            target_obj = TMA_Folder.get_or_none(TMA_Folder.id == target_folder_id)
        if not target_folder_id:
            raise ValueError("Не удалось определить папку для мультиколодного файла.")

        effective_user_id = get_effective_user_id(user_id, target_obj)
        preview = preview_folder_text_update(target_folder_id, effective_user_id, cards)
        preview['is_multi_deck'] = True
        preview['folder_id'] = target_folder_id
        preview['user_id'] = effective_user_id
    else:
        if target_deck_id:
            target_obj = TMA_Deck.get_or_none(TMA_Deck.id == target_deck_id)
        if not target_deck_id:
            raise ValueError("Не указан deck_id для обновления.")

        effective_user_id = get_effective_user_id(user_id, target_obj)
        preview = preview_text_update(target_deck_id, effective_user_id, cards)
        preview['is_multi_deck'] = False
        preview['deck_id'] = target_deck_id
        preview['user_id'] = effective_user_id

    return preview


def apply_update_content(
    cards: List[Dict[str, Any]],
    preview_token: str,
    request_id: Optional[str] = None,
    deck_id: Optional[int] = None,
    folder_id: Optional[int] = None,
    user_id: Optional[int] = None,
    include_new: bool = False,
    passports=None
) -> Dict[str, Any]:
    """
    Атомарно применяет изменения карточек в базе данных без мутации SRS.
    """
    if not request_id:
        request_id = str(uuid.uuid4())

    if passports:
        # A document receipt binds BOTH passports and cards and supports response-loss retries.
        with tma_db.atomic():
            preview = preview_update_content(cards, deck_id, folder_id, user_id)
            effective = preview['user_id']
            plan = _update_passport_plan(passports, preview.get('deck_id'), preview.get('folder_id'), effective, lock=True)
            receipt, replay = _claim_receipt(f'author-document-update:{effective}:{request_id}', _digest({
                'cards': cards, 'passports': passports, 'token': preview_token,
                'deck_id': deck_id, 'folder_id': folder_id, 'include_new': include_new}))
            if replay is not None:
                return replay
            token = _digest({'cards': preview['preview_token'], 'passports': plan})
            if token != preview_token:
                raise ValueError('Предпросмотр устарел; выполните его повторно.')
            result = apply_update_content(cards, preview['preview_token'], f'author-document:{request_id}',
                                          deck_id, folder_id, effective, include_new)
            for entry in plan:
                deck = _require_deck(entry['deck_id'], effective, lock=True)
                _save_passport(deck, entry['passport'])
            result['updated_passports'] = len(plan)
            receipt.response = json.dumps(result, ensure_ascii=False)
            receipt.save()
            return result

    deck_ids = {c['deck_id'] for c in cards if c.get('deck_id')}
    is_multi_deck = len(deck_ids) > 1 or bool(folder_id)

    target_obj = None
    target_deck_id = deck_id or (list(deck_ids)[0] if deck_ids else None)
    target_folder_id = folder_id

    if is_multi_deck:
        if not target_folder_id and deck_ids:
            first_deck = TMA_Deck.get_or_none(TMA_Deck.id == list(deck_ids)[0])
            target_folder_id = first_deck.folder_id if first_deck else None
        if target_folder_id:
            target_obj = TMA_Folder.get_or_none(TMA_Folder.id == target_folder_id)
        effective_user_id = get_effective_user_id(user_id, target_obj)
        result = apply_folder_text_update(
            target_folder_id, effective_user_id, cards, preview_token, request_id, include_new=include_new
        )
    else:
        if target_deck_id:
            target_obj = TMA_Deck.get_or_none(TMA_Deck.id == target_deck_id)
        effective_user_id = get_effective_user_id(user_id, target_obj)
        result = apply_text_update(
            target_deck_id, effective_user_id, cards, preview_token, request_id, include_new=include_new
        )

    return result


def _update_passport_plan(passports, deck_id, folder_id, user_id, lock=False):
    records = _passport_map(passports)
    decks, plan = {}, []
    for name, entry in sorted(records.items()):
        identifier = entry.get('deck_id') or deck_id
        if not identifier or (deck_id and identifier != deck_id):
            raise ValueError(f'{name}: отсутствующий или конфликтующий deck_id паспорта.')
        deck = _require_deck(identifier, user_id, lock=lock)
        if deck.name != name:
            raise ValueError(f'{name}: название не совпадает с deck_id паспорта.')
        decks[identifier] = deck
        current = read_metadata(deck.metadata)
        plan.append({**entry, 'deck_id': identifier,
                     'before': {key: current.get(key) for key in ('intro', 'pedagogy') if key in entry['passport']}})
    if folder_id:
        _require_folder(folder_id, user_id)
        paths = _folder_paths(folder_id, decks, lock=lock)
        if len(paths) != len(decks):
            raise ValueError('Паспорт колоды вне выбранной папки.')
    return plan


# ============================================================================
# Операции ПУБЛИКАЦИИ (Publish: Preview & Apply)
# ============================================================================

def parse_native_publication(text, default_deck_name=None):
    document = parse_document(text, default_deck_name=default_deck_name)
    if document['errors']:
        raise ValueError('; '.join(document['errors']))
    return document


def preview_publish_content(
    cards: List[Dict[str, Any]],
    default_deck_name: Optional[str] = None,
    passports=None
) -> Dict[str, Any]:
    """
    Анализирует карточки перед публикацией: группирует по колодам,
    определяет типы упражнений, находит ошибки синтаксиса.
    """
    passport_map = _passport_map(passports)
    if not cards and not passport_map:
        raise ValueError("Список карточек пуст.")

    decks_map: Dict[str, List[Dict[str, Any]]] = {}
    type_counts: Dict[str, int] = {}
    syntax_issues: List[Dict[str, Any]] = []

    for c in cards:
        dname = c.get('deck_name') or default_deck_name or "Без названия"
        decks_map.setdefault(dname, []).append(c)

        from .structured_card_storage import decode_v2_content
        ctype = decode_v2_content(c['content_v2']).type
        type_counts[ctype] = type_counts.get(ctype, 0) + 1

    deck_summaries = []
    for name in passport_map:
        decks_map.setdefault(name, [])
    for dname, dcards in decks_map.items():
        passport = passport_map.get(dname, {}).get('passport', {})
        intro = passport.get('intro', {})
        pedagogy = passport.get('pedagogy', {})
        deck_summaries.append({
            'deck_name': dname,
            'cards_count': len(dcards),
            'has_passport': bool(passport),
            'level': intro.get('level'),
            'goal': intro.get('goal'),
            'stages_count': len(pedagogy.get('stages', [])),
            'expected_result': pedagogy.get('expected_result'),
        })

    return {
        'total_cards': len(cards),
        'decks_count': len(decks_map),
        'decks': deck_summaries,
        'exercise_types': type_counts,
        'syntax_issues': syntax_issues
    }


def apply_publish_content(
    cards: List[Dict[str, Any]],
    target_folder_id: Optional[int] = None,
    new_folder_name: Optional[str] = None,
    default_deck_name: Optional[str] = None,
    force_new_deck: bool = False,
    user_id: Optional[int] = None,
    passports=None,
    passport_only: bool = False,
    image_data=None
) -> Dict[str, Any]:
    """
    Атомарно публикует урок:
    - Создает папку при необходимости;
    - Создает или находит колоды;
    - Сохраняет карточки через native bulk_save.
    """
    passport_map = _passport_map(passports)
    if passport_only and not passport_map:
        raise ValueError('Для обновления только паспорта требуется паспорт.')
    if not cards and not passport_only:
        raise ValueError("Список карточек пуст.")

    # Outer transaction also covers new folder creation and all nested bulk saves.
    with tma_db.atomic():
        media_paths = {}
        for card in cards:
            if card.get('image_file'):
                file_name = card['image_file']
                if not image_data or file_name not in image_data:
                    raise ValueError(f'Изображение {file_name} отсутствует в запросе публикации.')
                if file_name not in media_paths:
                    media_name = f'author_{uuid.uuid4().hex}.webp'
                    TMAMedia.create(filename=media_name, folder='images', content=image_data[file_name])
                    media_paths[file_name] = f'images/{media_name}'
                card['image_path'] = media_paths[file_name]
        return _publish_document(cards, target_folder_id, new_folder_name, default_deck_name,
                                 force_new_deck, user_id, passport_map, passport_only)


def _publish_document(cards, target_folder_id, new_folder_name, default_deck_name,
                      force_new_deck, user_id, passport_map, passport_only):
    if passport_only and (not target_folder_id or force_new_deck):
        raise ValueError('Только паспорт: выберите существующую папку; создание колод запрещено.')

    # 1. Разрешение целевой папки
    folder = None
    if not target_folder_id and new_folder_name:
        folder_user_id = get_effective_user_id(user_id)
        folder = services.create_folder(new_folder_name.strip(), folder_user_id)
        target_folder_id = folder.id
    elif target_folder_id:
        folder = TMA_Folder.get_or_none(TMA_Folder.id == target_folder_id, TMA_Folder.is_deleted == False)
        if not folder:
            raise ValueError(f"Папка ID {target_folder_id} не найдена.")
    else:
        raise ValueError("Не указана целевая папка (--folder-id или --new-folder).")

    effective_user_id = get_effective_user_id(user_id, folder)
    from api.services.collaborative_service import _require_can_mutate
    _require_can_mutate(effective_user_id, 'folder', target_folder_id)

    # 2. Группировка карточек по колодам
    decks_map: Dict[str, List[Dict[str, Any]]] = {}
    for c in ([] if passport_only else cards):
        dname = c.get('deck_name') or default_deck_name or "Новый урок"
        decks_map.setdefault(dname, []).append(c)
    for name in passport_map:
        if name not in decks_map and not passport_only:
            raise ValueError(f'{name}: паспорт без карточек; используйте режим «Только паспорт».')
        decks_map.setdefault(name, [])

    published_decks = []
    total_saved_cards = 0

    with tma_db.atomic():
        for dname, dcards in decks_map.items():
            query = TMA_Deck.select().where(
                TMA_Deck.folder_id == target_folder_id,
                TMA_Deck.name == dname,
                TMA_Deck.is_deleted == False
            )
            if tma_db.for_update:
                query = query.for_update()
            matches = list(query)
            if len(matches) > 1 and not force_new_deck:
                raise ValueError(f'{dname}: несколько колод с этим именем.')
            existing_deck = matches[0] if matches else None
            if passport_only and not existing_deck:
                raise ValueError(f'Колода {dname} не найдена в выбранной папке.')

            if existing_deck and not force_new_deck:
                deck = existing_deck
                created_deck = False
            else:
                deck = services.create_deck(dname, effective_user_id, target_folder_id)
                created_deck = True

            _require_can_mutate(effective_user_id, 'deck', deck.id)
            entry = passport_map.get(dname)
            if passport_only and entry.get('deck_id') and entry['deck_id'] != deck.id:
                raise ValueError(f'{dname}: deck_id не совпадает с колодой в выбранной папке.')
            if entry:
                _save_passport(deck, entry['passport'])

            from .structured_card_api import BulkSave, bulk_save

            cards_payload = [{
                'deck_id': deck.id, 'content_v2': card['content_v2'],
                **({'image_path': card['image_path']} if card.get('image_path') else {}),
            } for card in dcards]
            count = bulk_save(BulkSave(import_id=uuid.uuid4(), cards=cards_payload),
                              effective_user_id)['created'] if cards_payload else 0
            total_saved_cards += count
            published_decks.append({
                'deck_id': deck.id,
                'deck_name': deck.name,
                'created_deck': created_deck,
                'cards_count': count
            })

    return {
        'folder_id': target_folder_id,
        'folder_name': folder.name if folder else str(target_folder_id),
        'published_decks': published_decks,
        'total_saved_cards': total_saved_cards,
        'passport_only': passport_only,
        'updated_passports': len(passport_map)
    }
