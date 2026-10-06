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
from typing import List, Dict, Any, Optional, Tuple

from api.models import tma_db, TMA_Folder, TMA_Deck, TMA_Card, TMAUser
from api import services
from api.services.card_text_update import (
    preview_text_update,
    apply_text_update,
    preview_folder_text_update,
    apply_folder_text_update,
    _content,
    LEVELS
)
from api.services.input_parser import detect_ai_input_type

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

def parse_cards_text(
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
    raw_blocks = re.split(r'\n\s*---+\s*\n', cleaned_text)

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
        front_m = re.search(r'FRONT:\s*\n(.*?)(?=\nBACK:|\Z)', card_content, re.DOTALL | re.IGNORECASE)
        back_m = re.search(r'BACK:\s*\n(.*?)(?=\nCONTEXT:|\Z)', card_content, re.DOTALL | re.IGNORECASE)
        context_m = re.search(r'CONTEXT:\s*\n?(.*)', card_content, re.DOTALL | re.IGNORECASE)

        front = front_m.group(1).strip() if front_m else ""
        back = back_m.group(1).strip() if back_m else ""
        raw_context = context_m.group(1).strip() if context_m else ""

        # Разбор CONTEXT:
        level = None
        topics = None
        clean_context_lines = []

        for line in raw_context.split('\n'):
            line_str = line.strip()
            level_m = re.match(r'::level\s+([A-Za-z0-9]+)', line_str, re.IGNORECASE)
            topic_m = re.match(r'::topic\s+(.+)', line_str, re.IGNORECASE)
            if level_m:
                lvl = level_m.group(1).upper()
                if lvl in LEVELS:
                    level = lvl
            elif topic_m:
                topics = topic_m.group(1).strip()
            else:
                clean_context_lines.append(line)

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


# ============================================================================
# Операции ЭКСПОРТА (Export)
# ============================================================================

def export_deck_content(deck_id: int, user_id: Optional[int] = None) -> Dict[str, Any]:
    """Экспортирует колоду в текстовый формат Lerne."""
    deck = TMA_Deck.get_or_none(TMA_Deck.id == deck_id, TMA_Deck.is_deleted == False)
    if not deck:
        raise ValueError(f"Колода ID {deck_id} не найдена.")

    cards = list(TMA_Card.select().where(TMA_Card.deck_id == deck.id, TMA_Card.is_deleted == False).order_by(TMA_Card.id))
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
        cards = list(TMA_Card.select().where(TMA_Card.deck_id == d.id, TMA_Card.is_deleted == False).order_by(TMA_Card.id))
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
    user_id: Optional[int] = None
) -> Dict[str, Any]:
    """
    Выполняет двухфазный расчет предпросмотра обновления карточек.
    Возвращает структуру с diff, токеном preview_token и подсчетом изменений.
    """
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
    include_new: bool = False
) -> Dict[str, Any]:
    """
    Атомарно применяет изменения карточек в базе данных без мутации SRS.
    """
    if not request_id:
        request_id = str(uuid.uuid4())

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


# ============================================================================
# Операции ПУБЛИКАЦИИ (Publish: Preview & Apply)
# ============================================================================

def preview_publish_content(
    cards: List[Dict[str, Any]],
    default_deck_name: Optional[str] = None
) -> Dict[str, Any]:
    """
    Анализирует карточки перед публикацией: группирует по колодам,
    определяет типы упражнений, находит ошибки синтаксиса.
    """
    if not cards:
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
    for dname, dcards in decks_map.items():
        deck_summaries.append({
            'deck_name': dname,
            'cards_count': len(dcards),
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
    user_id: Optional[int] = None
) -> Dict[str, Any]:
    """
    Атомарно публикует урок:
    - Создает папку при необходимости;
    - Создает или находит колоды;
    - Сохраняет карточки через bulk_save_cards.
    """
    if not cards:
        raise ValueError("Список карточек пуст.")

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

    # 2. Группировка карточек по колодам
    decks_map: Dict[str, List[Dict[str, Any]]] = {}
    for c in cards:
        dname = c.get('deck_name') or default_deck_name or "Новый урок"
        decks_map.setdefault(dname, []).append(c)

    published_decks = []
    total_saved_cards = 0

    with tma_db.atomic():
        for dname, dcards in decks_map.items():
            existing_deck = TMA_Deck.get_or_none(
                TMA_Deck.folder_id == target_folder_id,
                TMA_Deck.name == dname,
                TMA_Deck.is_deleted == False
            )

            if existing_deck and not force_new_deck:
                deck = existing_deck
                created_deck = False
            else:
                deck = services.create_deck(dname, effective_user_id, target_folder_id)
                created_deck = True

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

            save_result = services.bulk_save_cards(cards_payload, effective_user_id)
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
        'total_saved_cards': total_saved_cards
    }
