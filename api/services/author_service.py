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
- Консолью администратора (`tools/admin/routers/author.py`);
- Автоматизацией через AI-агентов.
"""

import os
import re
import uuid
import json
import datetime
from typing import List, Dict, Any, Optional, Tuple

from api.models import tma_db, TMA_Folder, TMA_Deck, TMA_Card, TMAUser
from api import services
from api.services.card_text_update import (
    preview_text_update,
    apply_text_update,
    preview_folder_text_update,
    apply_folder_text_update,
    _content,
    _digest, _claim_receipt, _require_deck, _require_folder, _folder_paths,
    LEVELS
)
from api.services.input_parser import detect_ai_input_type
from api.services.deck_passport import validate_passport, merge_passport, passport_from_metadata, read_metadata

CARD_SEPARATOR = "---"


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
    """Сериализует одну карточку в канонический формат с метаданными."""
    content = _content(card)
    front = content.get('front', '')
    back = content.get('back', '')
    context_body = content.get('context', '')
    level = content.get('level')
    topics = content.get('topics')

    meta_lines = []
    if card.deck_id:
        meta_lines.append(f"::deck_id {card.deck_id}")
    if card.id:
        meta_lines.append(f"::card_id {card.id}")

    context_lines = []
    if level:
        context_lines.append(f"::level {level}")
    if topics:
        context_lines.append(f"::topic {topics}")
    if context_body:
        context_lines.append(context_body)

    parts = []
    if meta_lines:
        parts.append('\n'.join(meta_lines))
    parts.append(f"FRONT:\n{front}")
    parts.append(f"BACK:\n{back}")
    if context_lines:
        parts.append("CONTEXT:\n" + '\n'.join(context_lines))
    else:
        parts.append("CONTEXT:")

    return '\n\n'.join(parts)


def serialize_deck(deck: TMA_Deck, cards: List[TMA_Card]) -> str:
    """Сериализует колоду со всеми карточками."""
    header = f"# Deck: {deck.name}"
    passport = passport_from_metadata(getattr(deck, 'metadata', None))
    if passport:
        header += (f"\n::deck_id {deck.id}\n\n<<<LERNE_PASSPORT>>>\n"
                   + json.dumps(passport, ensure_ascii=False, indent=2, allow_nan=False)
                   + "\n<<<END_LERNE_PASSPORT>>>")
    cards_text = [serialize_card(c, deck.name) for c in cards]
    return f"{header}\n\n" + f"\n\n{CARD_SEPARATOR}\n\n".join(cards_text) + "\n"


def serialize_folder(folder: TMA_Folder, decks_with_cards: List[Tuple[TMA_Deck, List[TMA_Card]]]) -> str:
    """Сериализует папку со всеми входящими колодами."""
    output_parts = [f"# Folder: {folder.name}\n"]
    for deck, cards in decks_with_cards:
        output_parts.append(serialize_deck(deck, cards))
    return f"\n{CARD_SEPARATOR}\n\n".join(output_parts)


# ============================================================================
# Парсер текстового формата Lerne
# ============================================================================

def _parse_card_blocks(
    text: str,
    default_deck_id: Optional[int] = None,
    default_deck_name: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Разбирает текстовый файл карточек (одно- или мультиколодный).
    Возвращает список словарей карточек с полями:
    number, card_id, deck_id, deck_name, card_type, front, back, context, level, topics.
    """
    cleaned_text = text.replace('\r\n', '\n').replace('\r', '\n')
    raw_blocks = re.split(r'(?m)^\s*(?:---+|<<<LERNE_CARD>>>)\s*$', cleaned_text)

    parsed_cards = []
    current_deck_id = default_deck_id
    current_deck_name = default_deck_name

    for block in raw_blocks:
        block = block.strip()
        if not block:
            continue

        # Проверяем заголовок # Folder:
        if block.startswith('# Folder:'):
            folder_header_m = re.match(r'# Folder:\s*(.+)', block)
            block = block[folder_header_m.end():].strip() if folder_header_m else block

        # Проверяем заголовок # Deck: или # Колода:
        deck_header_m = re.search(r'# (?:Deck|Колода):\s*([^\n]+)', block, re.IGNORECASE)
        if deck_header_m:
            current_deck_name = deck_header_m.group(1).strip()
            block = (block[:deck_header_m.start()] + block[deck_header_m.end():]).strip()

        if not block:
            continue

        # Метаданные до FRONT:
        card_id = None
        deck_id = current_deck_id

        meta_part = ""
        front_idx = re.search(r'^\s*FRONT\s*:', block, re.IGNORECASE | re.MULTILINE)
        if front_idx:
            meta_part = block[:front_idx.start()]
            card_content = block[front_idx.start():]
        else:
            card_content = block

        deck_m = re.search(r'::deck_id\s+(\d+)', meta_part)
        if deck_m:
            deck_id = int(deck_m.group(1))
            current_deck_id = deck_id

        card_m = re.search(r'::card_id\s+(\d+)', meta_part)
        if card_m:
            card_id = int(card_m.group(1))

        # Извлечение секций FRONT:, BACK:, CONTEXT:
        front_m = re.search(r'FRONT:\s*\n?(.*?)(?=\n\s*BACK:|\Z)', card_content, re.DOTALL | re.IGNORECASE)
        back_m = re.search(r'BACK:\s*\n?(.*?)(?=\n\s*CONTEXT:|\Z)', card_content, re.DOTALL | re.IGNORECASE)
        context_m = re.search(r'CONTEXT:\s*\n?(.*)', card_content, re.DOTALL | re.IGNORECASE)

        front = front_m.group(1).strip() if front_m else ""
        back = back_m.group(1).strip() if back_m else ""
        raw_context = context_m.group(1).strip() if context_m else ""

        # Разбор CONTEXT:
        level = None
        topics = None
        clean_context_lines = []
        context_lines = raw_context.split('\n')
        i = 0

        while i < len(context_lines):
            line_str = context_lines[i].strip()
            level_m = re.match(r'::level(?:\s+([A-Za-z0-9]+))?$', line_str, re.IGNORECASE)
            topic_m = re.match(r'::topic(?:\s+(.+))?$', line_str, re.IGNORECASE)
            if level_m:
                lvl = (level_m.group(1) or '').strip().upper()
                if not lvl and i + 1 < len(context_lines):
                    next_str = context_lines[i + 1].strip()
                    if next_str and not next_str.startswith('::'):
                        lvl = next_str.upper()
                        i += 1
                if lvl in LEVELS:
                    level = lvl
            elif topic_m:
                top = (topic_m.group(1) or '').strip()
                if not top and i + 1 < len(context_lines):
                    next_str = context_lines[i + 1].strip()
                    if next_str and not next_str.startswith('::'):
                        top = next_str
                        i += 1
                if top:
                    topics = top
            else:
                clean_context_lines.append(context_lines[i])
            i += 1

        clean_context = '\n'.join(clean_context_lines).strip()

        if front or back:
            card_type = detect_ai_input_type(front) or 'standard'
            parsed_cards.append({
                'number': len(parsed_cards) + 1,
                'card_id': card_id,
                'deck_id': deck_id,
                'deck_name': current_deck_name,
                'card_type': card_type,
                'front': front,
                'back': back,
                'context': clean_context,
                'level': level,
                'topics': topics,
            })

    return parsed_cards


def parse_document(text, default_deck_id=None, default_deck_name=None):
    """Remove deck passports before parsing cards; retain errors for editable preview."""
    lines = text.lstrip('\ufeff').replace('\r\n', '\n').replace('\r', '\n').split('\n')
    sections = []
    section = {'deck_name': default_deck_name, 'lines': [], 'passports': []}
    errors, warnings, validation_errors = [], [], []
    passport_lines = None
    for line in lines:
        marker = line.strip()
        if marker == '<<<LERNE_PASSPORT>>>':
            if passport_lines is not None:
                errors.append('Вложенные блоки паспорта запрещены.')
            else:
                passport_lines = []
            continue
        if marker == '<<<END_LERNE_PASSPORT>>>':
            if passport_lines is None:
                errors.append('Конец паспорта без начала.')
            else:
                try:
                    def unique_keys(pairs):
                        result = {}
                        for key, value in pairs:
                            if key in result:
                                raise ValueError(f'Повтор JSON-ключа: {key}')
                            result[key] = value
                        return result
                    value = json.loads('\n'.join(passport_lines), object_pairs_hook=unique_keys)
                    section['passports'].append(value)
                except (ValueError, RecursionError) as exc:
                    errors.append(f"{section['deck_name'] or 'Колода'}: некорректный JSON паспорта: {exc}")
                passport_lines = None
            continue
        if passport_lines is not None:
            passport_lines.append(line)
            continue
        header = re.match(r'^\s*# (?:Deck|Колода):\s*(.+?)\s*$', line, re.IGNORECASE)
        if header:
            if section['lines'] or section['passports']:
                sections.append(section)
            section = {'deck_name': header.group(1), 'lines': [], 'passports': []}
        else:
            section['lines'].append(line)
    if passport_lines is not None:
        errors.append('Не найден <<<END_LERNE_PASSPORT>>>; содержимое паспорта не импортировано в карточки.')
    sections.append(section)
    cards, passports, decks = [], [], []
    passport_names = set()
    for part in sections:
        name = part['deck_name'] or default_deck_name
        body = '\n'.join(part['lines'])
        parsed = _parse_card_blocks(body, default_deck_id, name)
        for card in parsed:
            card['number'] = len(cards) + 1
            cards.append(card)
        if not parsed and not part['passports']:
            continue
        ids = {c['deck_id'] for c in parsed if c.get('deck_id')}
        # A deck-level ID also identifies an empty / passport-only export.
        prefix = re.split(r'^\s*FRONT\s*:', body, maxsplit=1, flags=re.MULTILINE | re.IGNORECASE)[0]
        ids.update(int(x) for x in re.findall(r'^\s*::deck_id\s+(\d+)\s*$', prefix, re.MULTILINE))
        resolved_id = next(iter(ids)) if len(ids) == 1 else default_deck_id
        if len(ids) > 1 and part['passports']:
            errors.append(f'{name}: конфликт deck_id в колоде с паспортом.')
        decks.append({'deck_name': name or 'Без названия', 'deck_id': resolved_id, 'cards_count': len(parsed)})
        if len(part['passports']) > 1 or (part['passports'] and name in passport_names):
            errors.append(f'{name}: дублирующийся паспорт колоды.')
        for passport in part['passports'][:1]:
            if not name:
                errors.append('Паспорт требует заголовок # Deck: или default_deck_name.')
            passport_names.add(name)
            validation = validate_passport(passport)
            validation_errors.extend(f'{name}: {error}' for error in validation)
            passports.append({'deck_name': name, 'deck_id': resolved_id, 'passport': passport})
            if not validation and parsed:
                for stage in passport.get('pedagogy', {}).get('stages', []):
                    if stage.get('to_card', 0) > len(parsed):
                        warnings.append(f"{name}: этап {stage['id']} выходит за число карточек файла; проверьте авторский диапазон.")
    return {'cards': cards, 'passports': passports, 'decks': decks, 'errors': errors + validation_errors,
            'structure_errors': errors, 'warnings': warnings}


def parse_cards_text(text, default_deck_id=None, default_deck_name=None):
    """Backward-compatible card projection; never silently discard malformed passports."""
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

        front = c.get('front', '')
        ctype = c.get('card_type') or detect_ai_input_type(front) or 'standard'
        type_counts[ctype] = type_counts.get(ctype, 0) + 1

        # Проверка баланса скобок [[ ]], { }, << >>
        for op, cl in (('[[', ']]'), ('{', '}'), ('<<', '>>')):
            if front.count(op) != front.count(cl):
                syntax_issues.append({
                    'card_number': c.get('number'),
                    'deck': dname,
                    'issue': f"Несбалансированные скобки {op}...{cl}",
                    'front_snippet': front[:60]
                })

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
    passport_only: bool = False
) -> Dict[str, Any]:
    """
    Атомарно публикует урок:
    - Создает папку при необходимости;
    - Создает или находит колоды;
    - Сохраняет карточки через bulk_save_cards.
    """
    passport_map = _passport_map(passports)
    if passport_only and not passport_map:
        raise ValueError('Для обновления только паспорта требуется паспорт.')
    if not cards and not passport_only:
        raise ValueError("Список карточек пуст.")

    # Outer transaction also covers new folder creation and all nested bulk saves.
    with tma_db.atomic():
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

            cards_payload = []
            for c in dcards:
                front = c.get('front', '')
                exercise_type = c.get('card_type') or detect_ai_input_type(front) or 'standard'
                cards_payload.append({
                    'deck_id': deck.id,
                    'front_text': front,
                    'back_text': c.get('back', ''),
                    'context': c.get('context', ''),
                    'topics': c.get('topics', ''),
                    'tags': c.get('level') or '',
                    'card_type': exercise_type,
                })

            save_result = services.bulk_save_cards(cards_payload, effective_user_id) if cards_payload else {'created': 0}
            if save_result.get('failed_count') or save_result.get('failed'):
                raise ValueError(f'{dname}: ошибка сохранения карточек; публикация полностью отменена.')
            count = save_result.get('created', len(cards_payload))
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
