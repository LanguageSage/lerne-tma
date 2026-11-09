#!/usr/bin/env python3
"""Generate a standalone local HTML viewer for all blocked V1 cards from LOCAL PostgreSQL.

This script connects strictly read-only to LOCAL PostgreSQL, analyzes all cards
matching the scope of Stage 7.3c, and outputs an offline single-file HTML viewer.
The generated HTML file contains zero server dependencies and opens in any browser.
"""

from __future__ import annotations

import html
import json
from pathlib import Path
import sys
import time
from typing import Any

# Ensure UTF-8 output on Windows terminals
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, 'reconfigure'):
        stream.reconfigure(encoding='utf-8')

# Ensure worktree and card_core are on sys.path
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = Path("C:/121/Lerne_projekt/tma")
if (REPO_ROOT / 'local' / 'integration-native-v2').exists():
    WORKTREE = REPO_ROOT / 'local' / 'integration-native-v2'
elif (REPO_ROOT / 'local' / '7-1-v1-to-v2-converter').exists():
    WORKTREE = REPO_ROOT / 'local' / '7-1-v1-to-v2-converter'
else:
    WORKTREE = REPO_ROOT

sys.path.insert(0, str(WORKTREE))
sys.path.insert(0, str(WORKTREE / 'api' / 'card_core'))

try:
    from api.services.db_v1_reader import fetch_v1_snapshot_from_db
    from api.v1_to_v2_converter import inspect_v1_card
    from api.card_core.lerne_card_core.input_parser import detect_card_type, detect_ai_input_type
except ImportError as exc:
    print(f"Error importing modules: {exc}")
    print(f"sys.path: {sys.path}")
    sys.exit(1)

# Actionable recommendations for blockage reasons (from Stage 7.3c audit)
RECOMMENDATIONS: dict[str, str] = {
    'empty_back': 'Дефектные карточки без перевода/ответа и без аудио (изолированные слова или обрывки черновиков). Требуется указать перевод либо удалить.',
    'card_type_mismatch': 'Сохранённый card_type конфликтует с фактическим синтаксисом контента (например, тип quiz на стандартном тексте). Требуется согласовать тип.',
    'invalid_quiz_structure': 'Некорректная разметка квиза (отсутствуют варианты ответа или правильный ответ). Требуется восстановить правильный маркер (* или -).',
    'invalid_trainer_structure': 'Некорректная разметка тренажёра (например, меньше двух вариантов выбора или дубликат ответа). Требуется добавить дистракторы.',
    'invalid_context_directive': 'Поле context содержит повреждённые директивы или необработанный сырой дамп AI генерации. Требуется очистить поле context.',
    'unmarked_preamble_before_directive': 'Текст инструкции размещён внутри блока ::exercise перед директивой (@puzzle/@match). Обернуть инструкцию в ::task.',
    'ambiguous_quiz_or_mixed_markers': 'Неоднозначные маркеры в квизе (смесь * и - или текст похож на список). Требуется явно выделить верный ответ.',
    'unconverted_blank_placeholder': 'Карточка содержит плейсхолдер ___ без разметки [[пропуск]] или {выбор}. Оформить пропуск скобками.',
    'conflicting_level_sources': 'Конфликт уровней CEFR в тегах карточки и колоде (например, указаны одновременно A1 и B1). Привести теги к единому уровню.',
    'ambiguous_puzzle_delimiters': 'Неоднозначные разделители частей пазла (использованы пайпы | вместо косых черт / или пробелов). Заменить разделители.',
    'invalid_match_structure': 'Некорректная разметка соответствий @match (нечётное число элементов или нет пар сопоставления). Исправить пары.',
    'invalid_free_text_structure': 'Некорректная разметка карточки свободного ввода. Проверить синтаксис @free и формулировку задания.',
    'empty_front': 'Пустой текст лицевой стороны карточки. Указать текст задания или удалить пустую запись.',
    'invalid_word_bank_structure': 'Синтаксическая ошибка в банке слов тренажёра/пазла.',
    'multiple_exercise_blocks': 'Карточка содержит более одного блока ::exercise. Объединить упражнения в один блок.',
    'invalid_directive': 'Неизвестная или опечатанная директива (например, @theori вместо @theory).',
    'unknown_block_marker': 'Неизвестный маркер блока (опечатка в ::task, ::exercise или ::info).',
    'inline_front_directive': 'Директива встроена некорректно в середину строки.',
    'info_after_exercise': 'Блок ::info расположен после блока ::exercise. Переместить блок информации наверх или в ::task.',
    'detector_type_divergence': 'Расхождение между алгоритмами распознавания типов контента.',
    'legacy_default_card_type_normalized': 'Дефолтный тип колонки standard/translation успешно нормализован в фактический тип контента V2.',
    'legacy_ai_detector_divergence': 'Эвристический авторский детектор разошёлся со study-детектором; карточка безопасно сохраняет подтверждённый тип.',
    'auto_distractors_choice_part': 'Выбор в тренажёре с одним вариантом успешно преобразован с использованием автоматических дистракторов (V2 auto-distractors).',
}


def classify_card(card: dict[str, Any], deck: dict[str, Any] | None, res: dict[str, Any]) -> tuple[str, str]:
    """Classify card into A, B, C, D and return (category_code, category_label)."""
    warn_codes = set(w['code'] for w in res.get('warnings', []))
    err_codes = set(d['code'] for d in res.get('diagnostics', []))

    if res['ok']:
        if warn_codes & {
            'legacy_default_card_type_normalized',
            'legacy_ai_detector_divergence',
            'auto_distractors_choice_part',
        }:
            return 'B', 'Категория B (В V2)'
        return '', 'Успешно'

    stored = card.get('card_type')
    raw_front = (card.get('front_text') or '').strip()
    det_c = detect_card_type(raw_front)
    kind = res['card'].type if res.get('card') else det_c

    # Category A: confirmed broken in V1
    if (
        ('card_type_mismatch' in err_codes and stored == 'quiz' and kind == 'standard') or
        ('card_type_mismatch' in err_codes and stored == 'trainer' and kind == 'standard') or
        ('card_type_mismatch' in err_codes and stored == 'puzzle' and kind == 'standard') or
        ('card_type_mismatch' in err_codes and stored == 'free_text' and kind == 'quiz') or
        ('invalid_quiz_structure' in err_codes) or
        ('ambiguous_puzzle_delimiters' in err_codes) or
        ('invalid_match_structure' in err_codes) or
        ('invalid_free_text_structure' in err_codes) or
        ('empty_front' in err_codes) or
        ('invalid_word_bank_structure' in err_codes) or
        ('multiple_exercise_blocks' in err_codes) or
        ('invalid_directive' in err_codes) or
        ('unknown_block_marker' in err_codes) or
        ('inline_front_directive' in err_codes) or
        ('info_after_exercise' in err_codes)
    ):
        return 'A', 'Категория A (Ошибка V1)'

    # Category C: ambiguous / requires author decision
    if (
        ('ambiguous_quiz_or_mixed_markers' in err_codes) or
        ('empty_back' in err_codes) or
        ('unmarked_preamble_before_directive' in err_codes) or
        ('conflicting_level_sources' in err_codes) or
        ('unconverted_blank_placeholder' in err_codes) or
        ('invalid_trainer_structure' in err_codes) or
        ('invalid_context_directive' in err_codes)
    ):
        return 'C', 'Категория C (Решение автора)'

    # Category D: edge case / insufficient evidence
    return 'D', 'Категория D (Недостаточно данных)'


def extract_blocked_cards_data() -> list[dict[str, Any]]:
    """Fetch read-only snapshot from LOCAL PostgreSQL and extract all 7.3c cards."""
    print("Fetching read-only snapshot from LOCAL PostgreSQL...")
    t0 = time.time()
    snapshot = fetch_v1_snapshot_from_db(scope='all', include_deleted=False)
    t1 = time.time()
    print(f"Snapshot loaded in {t1 - t0:.2f}s: {len(snapshot['cards'])} cards, {len(snapshot['decks'])} decks.")

    decks_by_id = {d['id']: d for d in snapshot['decks']}
    extracted_cards: list[dict[str, Any]] = []

    print("Analyzing cards with V1 -> V2 converter rules...")
    for idx, card in enumerate(snapshot['cards']):
        deck = decks_by_id.get(card.get('deck_id'))
        res = inspect_v1_card(card, deck=deck, classify_empty_back=True)

        cat_code, cat_label = classify_card(card, deck, res)
        if not cat_code:
            continue  # Normal card from baseline, not part of the 1,613 blocked audit

        raw_front = card.get('front_text') or ''
        raw_back = card.get('back_text') or ''
        raw_context = card.get('context') or ''

        # Media links detection (non-downloading links)
        img = (card.get('image_path') or '').strip()
        aud_f = (card.get('audio_path') or '').strip()
        aud_b = (card.get('audio_back_path') or '').strip()
        vid_f = (card.get('video_front_path') or '').strip()
        vid_b = (card.get('video_back_path') or '').strip()

        has_media = bool(img or aud_f or aud_b or vid_f or vid_b)
        media_info = {
            'has_media': has_media,
            'image': img or None,
            'audio_front': aud_f or None,
            'audio_back': aud_b or None,
            'video_front': vid_f or None,
            'video_back': vid_b or None,
        }

        # Diagnostics with recommendations
        diags: list[dict[str, Any]] = []
        for d in res.get('diagnostics', []):
            code = d.get('code', 'unknown')
            rec = RECOMMENDATIONS.get(code, 'Требуется ручная проверка карточки.')
            diags.append({
                'code': code,
                'message': d.get('message', ''),
                'path': d.get('path', ''),
                'recommendation': rec,
                'details': d.get('details', {}),
            })

        warns: list[dict[str, Any]] = []
        for w in res.get('warnings', []):
            code = w.get('code', 'unknown')
            rec = RECOMMENDATIONS.get(code, '')
            warns.append({
                'code': code,
                'message': w.get('message', ''),
                'path': w.get('path', ''),
                'recommendation': rec,
            })

        # V2 payload if conversion succeeded
        v2_payload = res.get('content_v2')
        v2_type = v2_payload['card']['type'] if v2_payload else None

        stored_type = card.get('card_type')
        det_type = detect_card_type(raw_front)

        deck_title = (deck.get('name') if deck else None) or f"Колода #{card.get('deck_id')}"
        deck_level = (deck.get('level') if deck else None) or ''
        deck_topic = (deck.get('topic') if deck else None) or ''

        extracted_cards.append({
            'id': card.get('id'),
            'deck_id': card.get('deck_id'),
            'deck_title': deck_title,
            'deck_level': deck_level,
            'deck_topic': deck_topic,
            'scope': card.get('scope', 'tma'),
            'position': card.get('position', 0),
            'stored_type': stored_type or 'standard',
            'detected_type': det_type,
            'front': raw_front,
            'back': raw_back,
            'context': raw_context,
            'metadata': card.get('metadata'),
            'tags': card.get('tags') or '',
            'topics': card.get('topics') or '',
            'media': media_info,
            'category': cat_code,
            'category_name': cat_label,
            'is_blocked': not res['ok'],
            'diagnostics': diags,
            'warnings': warns,
            'v2_result': v2_payload,
            'v2_type': v2_type,
        })

    # Sort deterministically: Category A, C, D, B; then by id
    extracted_cards.sort(key=lambda c: (c['category'], c['id']))
    return extracted_cards


def generate_html_viewer(cards_data: list[dict[str, Any]], output_path: Path) -> None:
    """Generate the complete self-contained HTML file."""
    print(f"Building standalone HTML viewer with {len(cards_data)} cards...")

    # Escape JSON safely for script tag
    cards_json = json.dumps(cards_data, ensure_ascii=False, indent=None)
    cards_json_safe = cards_json.replace('</script>', '<\\/script>').replace('<!--', '<\\!--')

    # Compute summary statistics
    cat_counts = {'A': 0, 'B': 0, 'C': 0, 'D': 0}
    blocked_count = 0
    with_v2_count = 0
    with_media_count = 0
    reason_counts: dict[str, int] = {}

    for c in cards_data:
        cat_counts[c['category']] = cat_counts.get(c['category'], 0) + 1
        if c['is_blocked']:
            blocked_count += 1
        if c['v2_result']:
            with_v2_count += 1
        if c['media']['has_media']:
            with_media_count += 1
        for d in c['diagnostics']:
            code = d['code']
            reason_counts[code] = reason_counts.get(code, 0) + 1

    sorted_reasons = sorted(reason_counts.items(), key=lambda x: -x[1])

    html_content = f"""<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Lerne TMA — Просмотрщик заблокированных карточек V1</title>
<style>
:root {{
  --bg-app: #0f172a;
  --bg-card: #1e293b;
  --bg-card-sub: #172033;
  --bg-input: #0b1120;
  --border-color: #334155;
  --border-focus: #7c3aed;
  --text-main: #f8fafc;
  --text-sub: #94a3b8;
  --text-muted: #64748b;
  --primary: #8b5cf6;
  --primary-hover: #7c3aed;
  --accent-green: #10b981;
  --accent-red: #ef4444;
  --accent-amber: #f59e0b;
  --accent-blue: #3b82f6;
  --accent-teal: #14b8a6;
  --accent-slate: #64748b;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -2px rgba(0, 0, 0, 0.3);
}}

* {{
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}}

body {{
  font-family: var(--font-sans);
  background: var(--bg-app);
  color: var(--text-main);
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}}

/* Filter Bar (Ultra Compact) */
.filter-panel {{
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
  padding: 6px 12px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  z-index: 50;
}}

.search-box-wrap {{
  flex: 1 1 240px;
  max-width: 380px;
  position: relative;
}}

.search-input {{
  width: 100%;
  padding: 5px 28px 5px 10px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-main);
  font-size: 13px;
  outline: none;
}}

.search-input:focus {{
  border-color: var(--primary);
}}

.search-clear-btn {{
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
}}

.filter-select {{
  padding: 5px 8px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-main);
  font-size: 12px;
  outline: none;
  cursor: pointer;
}}

.filter-select:focus {{
  border-color: var(--primary);
}}

.filter-btn-group {{
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}}

.filter-tab {{
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  color: var(--text-sub);
  padding: 4px 8px;
  border-radius: 5px;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
}}

.filter-tab:hover {{
  background: var(--border-color);
  color: #fff;
}}

.filter-tab.active {{
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}}

.filter-tab.active-a {{ background: #991b1b; border-color: #ef4444; color: #fee2e2; }}
.filter-tab.active-b {{ background: #065f46; border-color: #10b981; color: #d1fae5; }}
.filter-tab.active-c {{ background: #92400e; border-color: #f59e0b; color: #fef3c7; }}
.filter-tab.active-d {{ background: #334155; border-color: #64748b; color: #f1f5f9; }}

.reset-filters-btn {{
  background: none;
  border: 1px dashed var(--border-color);
  color: var(--text-muted);
  padding: 4px 8px;
  border-radius: 5px;
  font-size: 11.5px;
  cursor: pointer;
}}

.reset-filters-btn:hover {{
  color: var(--text-main);
  border-color: var(--text-sub);
}}

.export-btn-group {{
  display: flex;
  align-items: center;
  gap: 5px;
  margin-left: auto;
}}

.export-btn {{
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  color: var(--text-main);
  padding: 4px 9px;
  border-radius: 5px;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: all 0.15s;
}}

.export-btn:hover {{
  background: var(--border-color);
  border-color: var(--primary);
  color: #fff;
}}

/* Navigation & Card Meta Bar (Merged into Single Compact Area) */
.nav-bar {{
  background: var(--bg-card-sub);
  border-bottom: 1px solid var(--border-color);
  padding: 6px 12px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 42px;
}}

.nav-left-group {{
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}}

.nav-btn {{
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 5px;
  padding: 6px 12px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  user-select: none;
}}

.nav-btn:hover:not(:disabled) {{
  background: var(--primary-hover);
}}

.nav-btn:disabled {{
  opacity: 0.35;
  cursor: not-allowed;
}}

.nav-btn-sub {{
  background: var(--bg-input);
  color: var(--text-sub);
  border: 1px solid var(--border-color);
}}

.nav-btn-sub:hover:not(:disabled) {{
  background: var(--border-color);
  color: #fff;
}}

.counter-badge {{
  font-size: 12px;
  font-weight: 600;
  color: var(--text-main);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}}

.index-input {{
  width: 52px;
  padding: 4px 6px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 5px;
  color: #fff;
  text-align: center;
  font-size: 12px;
  font-weight: 600;
}}

/* Card Meta from Screenshot 2 placed in the Navigation area */
.nav-meta-group {{
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  flex: 1;
  min-width: 320px;
}}

.nav-card-id-block {{
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  padding: 3px 8px;
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 800;
  color: #fff;
}}

.copy-btn {{
  background: rgba(255, 255, 255, 0.08);
  border: none;
  color: var(--text-sub);
  cursor: pointer;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
}}

.copy-btn:hover {{
  background: var(--primary);
  color: #fff;
}}

.badge {{
  font-size: 11px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}}

.badge-cat-a {{ background: #450a0a; color: #fca5a5; border: 1px solid #ef4444; }}
.badge-cat-b {{ background: #064e3b; color: #86efac; border: 1px solid #10b981; }}
.badge-cat-c {{ background: #451a03; color: #fde68a; border: 1px solid #f59e0b; }}
.badge-cat-d {{ background: #1e293b; color: #cbd5e1; border: 1px solid #64748b; }}

.badge-scope {{ background: #1e1b4b; color: #c7d2fe; border: 1px solid #6366f1; }}
.badge-media {{ background: #083344; color: #67e8f9; border: 1px solid #06b6d4; }}

.nav-deck-text {{
  font-size: 12px;
  color: var(--text-sub);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 480px;
}}

.nav-deck-text strong {{
  color: var(--text-main);
}}

/* Decision Checkboxes Bar (Top of Right Window) */
.decision-bar {{
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 6px 10px;
}}

.decision-title {{
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--text-sub);
  letter-spacing: 0.5px;
}}

.decision-checkbox-label {{
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-main);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 5px;
  border: 1px solid var(--border-color);
  background: var(--bg-input);
  transition: all 0.15s;
  user-select: none;
}}

.decision-checkbox-label:hover {{
  border-color: var(--primary);
}}

.decision-checkbox-label input[type="checkbox"] {{
  accent-color: var(--primary);
  width: 14px;
  height: 14px;
  cursor: pointer;
}}

.key-badge {{
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 800;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #fff;
  letter-spacing: 0.5px;
}}

.decision-checkbox-label.is-checked-postpone {{
  background: rgba(245, 158, 11, 0.18);
  border-color: #f59e0b;
  color: #fef3c7;
}}

.decision-checkbox-label.is-checked-strict {{
  background: rgba(59, 130, 246, 0.18);
  border-color: #3b82f6;
  color: #bfdbfe;
}}

.decision-checkbox-label.is-checked-fix {{
  background: rgba(20, 184, 166, 0.18);
  border-color: #14b8a6;
  color: #99f6e4;
}}

.decision-checkbox-label.is-checked-discard {{
  background: rgba(239, 68, 68, 0.18);
  border-color: #ef4444;
  color: #fca5a5;
}}

/* Main Layout */
.layout-container {{
  flex: 1;
  display: flex;
  position: relative;
  overflow: hidden;
}}

/* Sidebar Drawer */
.sidebar {{
  width: 280px;
  background: var(--bg-card);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  transition: transform 0.2s ease;
  flex-shrink: 0;
  height: 100%;
  overflow: hidden;
}}

.sidebar.closed {{
  margin-left: -280px;
}}

.sidebar-header {{
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-sub);
  display: flex;
  justify-content: space-between;
  align-items: center;
}}

.card-list-scroll {{
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}}

.card-list-item {{
  padding: 6px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
}}

.card-list-item:hover {{
  background: rgba(255, 255, 255, 0.04);
}}

.card-list-item.selected {{
  background: rgba(139, 92, 246, 0.18);
  border-left: 3px solid var(--primary);
}}

.item-top {{
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 4px;
}}

.item-id {{
  font-size: 11.5px;
  font-family: var(--font-mono);
  font-weight: 700;
  color: #fff;
}}

.item-cat-tag {{
  font-size: 9.5px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 3px;
}}

.item-preview {{
  font-size: 10.5px;
  color: var(--text-sub);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}}

.item-decision-pill {{
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 3px;
  align-self: flex-start;
}}

/* Main Card View */
.main-view {{
  flex: 1;
  overflow-y: auto;
  height: 100%;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}}

/* Comparison Split View (Side by Side) */
.split-view-grid {{
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  flex: 1;
}}

@media (max-width: 960px) {{
  .split-view-grid {{
    grid-template-columns: 1fr;
  }}
}}

.pane {{
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}}

.pane-header {{
  padding: 8px 12px;
  background: var(--bg-card-sub);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}}

.pane-title {{
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 6px;
}}

.pane-body {{
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  overflow-y: auto;
}}

/* Text Content Boxes */
.field-block {{
  display: flex;
  flex-direction: column;
  gap: 3px;
}}

.field-label {{
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-sub);
  display: flex;
  justify-content: space-between;
  align-items: center;
}}

.preserve-text {{
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 5px;
  padding: 6px 10px;
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.45;
  color: #e2e8f0;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
}}

.empty-placeholder {{
  font-style: italic;
  color: var(--text-muted);
}}

/* Diagnostic Reasons & Actionable Cards */
.reasons-list {{
  display: flex;
  flex-direction: column;
  gap: 6px;
}}

.reason-card {{
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-left: 3px solid var(--accent-red);
  border-radius: 5px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}}

.reason-card.is-warning {{
  background: rgba(245, 158, 11, 0.08);
  border-color: rgba(245, 158, 11, 0.3);
  border-left-color: var(--accent-amber);
}}

.reason-code-title {{
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  color: #fca5a5;
  display: flex;
  align-items: center;
  gap: 6px;
}}

.reason-card.is-warning .reason-code-title {{
  color: #fde68a;
}}

.reason-msg {{
  font-size: 12px;
  color: var(--text-main);
  line-height: 1.35;
}}

.reason-rec {{
  font-size: 11.5px;
  color: #a7f3d0;
  background: rgba(16, 185, 129, 0.1);
  padding: 4px 6px;
  border-radius: 4px;
  border-left: 2px solid var(--accent-green);
  line-height: 1.35;
}}

.reason-path {{
  font-size: 10.5px;
  font-family: var(--font-mono);
  color: var(--text-muted);
}}

/* Status Banners */
.status-banner {{
  padding: 8px 10px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
}}

.status-banner.success {{
  background: rgba(16, 185, 129, 0.15);
  border: 1px solid rgba(16, 185, 129, 0.4);
  color: #86efac;
}}

.status-banner.blocked {{
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #fca5a5;
}}

/* Media Section */
.media-table {{
  width: 100%;
  border-collapse: collapse;
  font-size: 11.5px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 5px;
  overflow: hidden;
}}

.media-table th, .media-table td {{
  padding: 4px 8px;
  text-align: left;
  border-bottom: 1px solid var(--border-color);
}}

.media-table th {{
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-sub);
}}

.media-link {{
  color: var(--primary);
  text-decoration: none;
  font-family: var(--font-mono);
  word-break: break-all;
}}

.media-link:hover {{
  text-decoration: underline;
}}

/* JSON Code Box */
.json-box {{
  font-size: 11.5px;
  max-height: 400px;
}}

/* Empty Search Result State */
.no-results {{
  padding: 30px;
  text-align: center;
  color: var(--text-muted);
  font-size: 14px;
}}
</style>
</head>
<body>

<!-- Filter Bar -->
<section class="filter-panel">
  <div class="search-box-wrap">
    <input type="text" id="searchInput" class="search-input" placeholder="🔍 Поиск по ID, тексту FRONT, BACK, колоде..." autocomplete="off">
    <button id="searchClearBtn" class="search-clear-btn" title="Очистить" style="display: none;">✕</button>
  </div>

  <div class="filter-btn-group" id="categoryGroup">
    <button class="filter-tab active" data-cat="all">Все ({len(cards_data)})</button>
    <button class="filter-tab" data-cat="A">A: Ошибки V1 ({cat_counts.get('A', 0)})</button>
    <button class="filter-tab" data-cat="B">B: В V2 ({cat_counts.get('B', 0)})</button>
    <button class="filter-tab" data-cat="C">C: Автор ({cat_counts.get('C', 0)})</button>
    <button class="filter-tab" data-cat="D">D: Другие ({cat_counts.get('D', 0)})</button>
  </div>

  <select id="reasonSelect" class="filter-select">
    <option value="all">Все причины ({len(cards_data)})</option>
"""
    for reason, count in sorted_reasons:
        safe_reason = html.escape(reason)
        html_content += f'    <option value="{safe_reason}">{safe_reason} ({count})</option>\n'

    html_content += f"""  </select>

  <select id="decisionFilterSelect" class="filter-select">
    <option value="all">Все отметки</option>
    <option value="postpone">Отмечено: Отложить [Z]</option>
    <option value="strict">Отмечено: Строгий парсер [X]</option>
    <option value="fix">Отмечено: Исправить карточку [C]</option>
    <option value="discard">Отмечено: Не нужна [V]</option>
    <option value="unmarked">Без отметки</option>
  </select>

  <select id="scopeSelect" class="filter-select">
    <option value="all">Все области</option>
    <option value="tma">TMA</option>
    <option value="library">Library</option>
  </select>

  <select id="mediaSelect" class="filter-select">
    <option value="all">Медиа: Все</option>
    <option value="with_media">С медиа ({with_media_count})</option>
    <option value="no_media">Без медиа</option>
  </select>

  <select id="statusSelect" class="filter-select">
    <option value="all">Статус: Все</option>
    <option value="blocked">Заблокированы ({blocked_count})</option>
    <option value="has_v2">С V2 ({with_v2_count})</option>
  </select>

  <button id="resetFiltersBtn" class="reset-filters-btn" title="Сбросить фильтры">Сброс</button>

  <div class="export-btn-group">
    <select id="exportCategorySelect" class="filter-select" style="max-width: 175px; font-weight: 600;" title="Выберите категорию для экспорта или копирования">
      <option value="A" selected>Категория A</option>
      <option value="active">Текущий фильтр</option>
      <option value="B">Категория B</option>
      <option value="C">Категория C</option>
      <option value="D">Категория D</option>
      <option value="all">Все категории</option>
    </select>
    <button id="exportJsonBtn" class="export-btn" title="Скачать JSON с пометками выбранной категории">💾 Экспорт JSON</button>
    <button id="copyJsonBtn" class="export-btn" title="Скопировать JSON выбранной категории в буфер обмена">📋 Копировать</button>
    <button id="importJsonBtn" class="export-btn" title="Загрузить ранее сохранённый JSON файл с пометками">📂 Импорт</button>
    <input type="file" id="importJsonFileInput" accept=".json" style="display: none;">
  </div>
</section>

<!-- Combined Navigation & Card Meta Header (Replaces old separate top header & card meta panel) -->
<section class="nav-bar">
  <div class="nav-left-group">
    <button id="toggleSidebarBtn" class="nav-btn nav-btn-sub" title="Показать/скрыть список">☰ Список</button>
    <button id="firstBtn" class="nav-btn nav-btn-sub" title="Первая карточка">|←</button>
    <button id="prevBtn" class="nav-btn" title="Предыдущая (←, j)">← Предыдущая</button>
    <div class="counter-badge">
      <input type="number" id="jumpIndexInput" class="index-input" min="1" max="1" value="1"> / <span id="totalVisibleSpan">0</span>
    </div>
    <button id="nextBtn" class="nav-btn" title="Следующая (→, k)">Следующая →</button>
    <button id="lastBtn" class="nav-btn nav-btn-sub" title="Последняя карточка">→|</button>
  </div>

  <div class="nav-meta-group" id="navMetaGroup">
    <!-- Populated dynamically with Card ID, category, scope, deck title, tags from screenshot 2 -->
  </div>
</section>

<div class="layout-container">
  <!-- Sidebar -->
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-header">
      <span>НАЙДЕНО КАРТОЧЕК</span>
      <span id="sidebarCount">0</span>
    </div>
    <div class="card-list-scroll" id="cardListContainer">
      <!-- Items generated dynamically -->
    </div>
  </aside>

  <!-- Main Details View -->
  <main class="main-view" id="mainView">
    <!-- Active Card rendered here -->
  </main>
</div>

<script id="cards-data" type="application/json">
{cards_json_safe}
</script>

<script>
(function() {{
  const rawCards = JSON.parse(document.getElementById('cards-data').textContent);
  let filteredCards = [...rawCards];
  let currentIndex = 0;

  // Local storage for user decisions (saved persistently per card id)
  const DECISION_STORAGE_KEY = 'lerne_v1_audit_decisions';
  let decisions = {{}};
  try {{
    decisions = JSON.parse(localStorage.getItem(DECISION_STORAGE_KEY) || '{{}}');
  }} catch (e) {{
    decisions = {{}};
  }}

  function saveDecisions() {{
    try {{
      localStorage.setItem(DECISION_STORAGE_KEY, JSON.stringify(decisions));
    }} catch (e) {{}}
  }}

  // UI elements
  const searchInput = document.getElementById('searchInput');
  const searchClearBtn = document.getElementById('searchClearBtn');
  const categoryGroup = document.getElementById('categoryGroup');
  const reasonSelect = document.getElementById('reasonSelect');
  const decisionFilterSelect = document.getElementById('decisionFilterSelect');
  const scopeSelect = document.getElementById('scopeSelect');
  const mediaSelect = document.getElementById('mediaSelect');
  const statusSelect = document.getElementById('statusSelect');
  const resetFiltersBtn = document.getElementById('resetFiltersBtn');

  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const firstBtn = document.getElementById('firstBtn');
  const lastBtn = document.getElementById('lastBtn');
  const jumpIndexInput = document.getElementById('jumpIndexInput');
  const totalVisibleSpan = document.getElementById('totalVisibleSpan');
  const sidebar = document.getElementById('sidebar');
  const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
  const cardListContainer = document.getElementById('cardListContainer');
  const sidebarCount = document.getElementById('sidebarCount');
  const navMetaGroup = document.getElementById('navMetaGroup');
  const mainView = document.getElementById('mainView');

  let activeCategory = 'all';

  function escapeHtml(str) {{
    if (!str && str !== 0) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }}

  function setDecision(actionKey, value) {{
    if (filteredCards.length === 0) return;
    const card = filteredCards[currentIndex];
    const d = decisions[card.id] || {{ postpone: false, strict: false, fix: false, discard: false }};
    d[actionKey] = Boolean(value);
    d.category = card.category;
    d.deck_id = card.deck_id;
    d.deck_title = card.deck_title;

    if (!d.postpone && !d.strict && !d.fix && !d.discard) {{
      delete decisions[card.id];
    }} else {{
      decisions[card.id] = d;
    }}
    saveDecisions();

    // Sync input checked state
    const inputId = actionKey === 'postpone' ? 'checkPostpone' :
                    actionKey === 'strict' ? 'checkStrict' :
                    actionKey === 'fix' ? 'checkFix' : 'checkDiscard';
    const chk = document.getElementById(inputId);
    if (chk && chk.checked !== d[actionKey]) chk.checked = d[actionKey];

    // Sync label highlight classes
    document.getElementById('lblPostpone')?.classList.toggle('is-checked-postpone', !!d.postpone);
    document.getElementById('lblStrict')?.classList.toggle('is-checked-strict', !!d.strict);
    document.getElementById('lblFix')?.classList.toggle('is-checked-fix', !!d.fix);
    document.getElementById('lblDiscard')?.classList.toggle('is-checked-discard', !!d.discard);

    renderSidebarList();
  }}

  function toggleDecision(actionKey) {{
    if (filteredCards.length === 0) return;
    const card = filteredCards[currentIndex];
    const currentVal = Boolean(decisions[card.id]?.[actionKey]);
    setDecision(actionKey, !currentVal);
  }}

  function filterCards() {{
    const query = (searchInput.value || '').trim().toLowerCase();
    const reason = reasonSelect.value;
    const decFilter = decisionFilterSelect.value;
    const scope = scopeSelect.value;
    const media = mediaSelect.value;
    const status = statusSelect.value;

    filteredCards = rawCards.filter(card => {{
      // Category filter
      if (activeCategory !== 'all' && card.category !== activeCategory) {{
        return false;
      }}

      // Scope filter
      if (scope !== 'all' && card.scope !== scope) {{
        return false;
      }}

      // Media filter
      if (media === 'with_media' && !card.media.has_media) return false;
      if (media === 'no_media' && card.media.has_media) return false;

      // Status filter
      if (status === 'blocked' && !card.is_blocked) return false;
      if (status === 'has_v2' && !card.v2_result) return false;

      // Decision filter
      if (decFilter !== 'all') {{
        const d = decisions[card.id] || {{}};
        if (decFilter === 'postpone' && !d.postpone) return false;
        if (decFilter === 'strict' && !d.strict) return false;
        if (decFilter === 'fix' && !d.fix) return false;
        if (decFilter === 'discard' && !d.discard) return false;
        if (decFilter === 'unmarked' && (d.postpone || d.strict || d.fix || d.discard)) return false;
      }}

      // Reason filter
      if (reason !== 'all') {{
        const hasReason = card.diagnostics.some(d => d.code === reason) ||
                          card.warnings.some(w => w.code === reason);
        if (!hasReason) return false;
      }}

      // Search query (ID, front, back, context, deck title, reasons)
      if (query) {{
        const idMatch = String(card.id).includes(query);
        const deckMatch = String(card.deck_title).toLowerCase().includes(query) || String(card.deck_id).includes(query);
        const frontMatch = (card.front || '').toLowerCase().includes(query);
        const backMatch = (card.back || '').toLowerCase().includes(query);
        const contextMatch = (card.context || '').toLowerCase().includes(query);
        const diagMatch = card.diagnostics.some(d => d.code.toLowerCase().includes(query) || (d.message || '').toLowerCase().includes(query));
        if (!idMatch && !deckMatch && !frontMatch && !backMatch && !contextMatch && !diagMatch) {{
          return false;
        }}
      }}

      return true;
    }});

    currentIndex = 0;
    renderSidebarList();
    renderActiveCard();
  }}

  function renderSidebarList() {{
    sidebarCount.textContent = filteredCards.length;
    totalVisibleSpan.textContent = filteredCards.length;
    jumpIndexInput.max = Math.max(1, filteredCards.length);

    if (filteredCards.length === 0) {{
      cardListContainer.innerHTML = '<div class="no-results">Карточки не найдены</div>';
      return;
    }}

    let html = '';
    const maxItems = Math.min(filteredCards.length, 500);
    for (let i = 0; i < maxItems; i++) {{
      const c = filteredCards[i];
      const isSel = i === currentIndex ? 'selected' : '';
      const catClass = `item-cat-tag badge-cat-${{c.category.toLowerCase()}}`;
      const preview = escapeHtml((c.front || '').substring(0, 45).replace(/\\n/g, ' '));
      const d = decisions[c.id] || {{}};
      let decBadges = '';
      if (d.postpone) decBadges += '<span class="item-decision-pill" style="background:#451a03;color:#fde68a;">[Z] Отложена</span> ';
      if (d.strict) decBadges += '<span class="item-decision-pill" style="background:#1e3a8a;color:#93c5fd;">[X] Строгий парсер</span> ';
      if (d.fix) decBadges += '<span class="item-decision-pill" style="background:#042f2e;color:#99f6e4;">[C] Исправить</span> ';
      if (d.discard) decBadges += '<span class="item-decision-pill" style="background:#450a0a;color:#fca5a5;">[V] Не нужна</span> ';

      html += `
        <div class="card-list-item ${{isSel}}" data-idx="${{i}}">
          <div class="item-top">
            <span class="item-id">#${{c.id}}</span>
            <span class="${{catClass}}">${{c.category}}</span>
          </div>
          <div class="item-preview">${{preview || '(нет текста)'}}</div>
          ${{decBadges ? `<div>${{decBadges}}</div>` : ''}}
        </div>
      `;
    }}
    if (filteredCards.length > maxItems) {{
      html += `<div style="padding: 8px; font-size: 11px; color: var(--text-muted); text-align: center;">... и ещё ${{filteredCards.length - maxItems}} карточек</div>`;
    }}
    cardListContainer.innerHTML = html;

    cardListContainer.querySelectorAll('.card-list-item').forEach(item => {{
      item.addEventListener('click', () => {{
        const idx = parseInt(item.getAttribute('data-idx'), 10);
        goToIndex(idx);
      }});
    }});
  }}

  function updateSidebarSelection() {{
    const items = cardListContainer.querySelectorAll('.card-list-item');
    items.forEach((item, idx) => {{
      if (idx === currentIndex) {{
        item.classList.add('selected');
        item.scrollIntoView({{ block: 'nearest', behavior: 'smooth' }});
      }} else {{
        item.classList.remove('selected');
      }}
    }});
  }}

  function goToIndex(idx) {{
    if (filteredCards.length === 0) return;
    if (idx < 0) idx = 0;
    if (idx >= filteredCards.length) idx = filteredCards.length - 1;
    currentIndex = idx;
    jumpIndexInput.value = currentIndex + 1;
    updateSidebarSelection();
    renderActiveCard();
  }}

  function renderActiveCard() {{
    prevBtn.disabled = currentIndex <= 0;
    firstBtn.disabled = currentIndex <= 0;
    nextBtn.disabled = currentIndex >= filteredCards.length - 1;
    lastBtn.disabled = currentIndex >= filteredCards.length - 1;
    jumpIndexInput.value = filteredCards.length > 0 ? currentIndex + 1 : 0;

    if (filteredCards.length === 0) {{
      navMetaGroup.innerHTML = '';
      mainView.innerHTML = `
        <div class="no-results" style="margin-top: 40px;">
          <h2>Ничего не найдено</h2>
          <p style="margin-top: 6px;">Попробуйте изменить поисковый запрос или сбросить фильтры.</p>
        </div>
      `;
      return;
    }}

    const card = filteredCards[currentIndex];
    const catClass = `badge badge-cat-${{card.category.toLowerCase()}}`;
    const scopeLabel = card.scope === 'library' ? 'Library (Общая)' : 'TMA (Пользовательская)';

    // 1. RENDER TOP NAV META (Screenshot 2 info)
    navMetaGroup.innerHTML = `
      <div class="nav-card-id-block">
        <span>ID: #${{card.id}}</span>
        <button class="copy-btn" id="copyIdBtn" title="Копировать ID">Копировать</button>
      </div>
      <span class="${{catClass}}">${{escapeHtml(card.category_name)}}</span>
      <span class="badge badge-scope">${{scopeLabel}}</span>
      ${{card.media.has_media ? '<span class="badge badge-media">📁 Медиа</span>' : ''}}

      <div class="nav-deck-text" title="Колода: ${{escapeHtml(card.deck_title)}} (ID: ${{card.deck_id}})">
        Колода: <strong>${{escapeHtml(card.deck_title)}}</strong> (ID: ${{card.deck_id}})
        ${{card.tags ? ` · Теги: <strong>${{escapeHtml(card.tags)}}</strong>` : ''}}
        ${{card.deck_level ? ` · Уровень: <strong>${{escapeHtml(card.deck_level)}}</strong>` : ''}}
      </div>
    `;

    document.getElementById('copyIdBtn')?.addEventListener('click', () => {{
      navigator.clipboard.writeText(String(card.id));
      alert(`ID карточки #${{card.id}} скопирован.`);
    }});

    // 2. MEDIA SECTION
    let mediaHtml = '';
    if (card.media.has_media) {{
      const rows = [];
      if (card.media.audio_front) rows.push(`<tr><td>🎵 Аудио (Front)</td><td><a class="media-link" href="/api/media/${{escapeHtml(card.media.audio_front)}}" target="_blank" rel="noopener noreferrer">${{escapeHtml(card.media.audio_front)}}</a></td></tr>`);
      if (card.media.audio_back) rows.push(`<tr><td>🎧 Аудио (Back)</td><td><a class="media-link" href="/api/media/${{escapeHtml(card.media.audio_back)}}" target="_blank" rel="noopener noreferrer">${{escapeHtml(card.media.audio_back)}}</a></td></tr>`);
      if (card.media.image) rows.push(`<tr><td>🖼️ Изображение</td><td><a class="media-link" href="/api/media/${{escapeHtml(card.media.image)}}" target="_blank" rel="noopener noreferrer">${{escapeHtml(card.media.image)}}</a></td></tr>`);
      if (card.media.video_front) rows.push(`<tr><td>🎬 Видео (Front)</td><td><a class="media-link" href="/api/media/${{escapeHtml(card.media.video_front)}}" target="_blank" rel="noopener noreferrer">${{escapeHtml(card.media.video_front)}}</a></td></tr>`);
      if (card.media.video_back) rows.push(`<tr><td>🎬 Видео (Back)</td><td><a class="media-link" href="/api/media/${{escapeHtml(card.media.video_back)}}" target="_blank" rel="noopener noreferrer">${{escapeHtml(card.media.video_back)}}</a></td></tr>`);

      mediaHtml = `
        <div class="field-block">
          <div class="field-label">МЕДИАФАЙЛЫ (ССЫЛКИ БЕЗ СКАЧИВАНИЯ)</div>
          <table class="media-table">
            <thead><tr><th>Тип</th><th>Относительный путь</th></tr></thead>
            <tbody>${{rows.join('')}}</tbody>
          </table>
        </div>
      `;
    }}

    // 3. DECISION CHECKBOXES (Placed in Right Pane Footer with Hotkeys Z X C V)
    const currentDec = decisions[card.id] || {{}};
    const isPostpone = !!currentDec.postpone;
    const isStrict = !!currentDec.strict;
    const isFix = !!currentDec.fix;
    const isDiscard = !!currentDec.discard;

    const decisionCheckboxesHtml = `
      <div class="decision-bar">
        <span class="decision-title">Действие:</span>
        <label class="decision-checkbox-label ${{isPostpone ? 'is-checked-postpone' : ''}}" id="lblPostpone" title="Горячая клавиша: Z">
          <input type="checkbox" id="checkPostpone" ${{isPostpone ? 'checked' : ''}}>
          <span class="key-badge">Z</span>
          <span>отложить</span>
        </label>
        <label class="decision-checkbox-label ${{isStrict ? 'is-checked-strict' : ''}}" id="lblStrict" title="Горячая клавиша: X">
          <input type="checkbox" id="checkStrict" ${{isStrict ? 'checked' : ''}}>
          <span class="key-badge">X</span>
          <span>слишком строгий парсер или конвертор</span>
        </label>
        <label class="decision-checkbox-label ${{isFix ? 'is-checked-fix' : ''}}" id="lblFix" title="Горячая клавиша: C">
          <input type="checkbox" id="checkFix" ${{isFix ? 'checked' : ''}}>
          <span class="key-badge">C</span>
          <span>исправить карточку</span>
        </label>
        <label class="decision-checkbox-label ${{isDiscard ? 'is-checked-discard' : ''}}" id="lblDiscard" title="Горячая клавиша: V">
          <input type="checkbox" id="checkDiscard" ${{isDiscard ? 'checked' : ''}}>
          <span class="key-badge">V</span>
          <span>не нужна</span>
        </label>
      </div>
    `;

    // 4. RIGHT COLUMN (V2 / REASONS)
    let rightSideHtml = '';
    if (card.v2_result) {{
      const v2Formatted = escapeHtml(JSON.stringify(card.v2_result, null, 2));
      const warningsList = card.warnings.map(w => `
        <div class="reason-card is-warning">
          <div class="reason-code-title">⚠️ ${{escapeHtml(w.code)}}</div>
          <div class="reason-msg">${{escapeHtml(w.message)}}</div>
          ${{w.recommendation ? `<div class="reason-rec">✓ ${{escapeHtml(w.recommendation)}}</div>` : ''}}
        </div>
      `).join('');

      rightSideHtml = `
        <div class="pane">
          <div class="pane-header">
            <div class="pane-title">
              <span style="color: var(--accent-green);">✓</span>
              <span>ПРЕДЛАГАЕМЫЙ РЕЗУЛЬТАТ V2 (${{escapeHtml(card.v2_type || 'standard').toUpperCase()}})</span>
            </div>
            <button class="copy-btn" id="copyV2Btn">Копировать JSON V2</button>
          </div>
          <div class="pane-body">
            ${{decisionCheckboxesHtml}}

            <div class="status-banner success">
              <span>✓ Преобразование в V2 сформировано (Категория B)</span>
            </div>

            ${{warningsList ? `<div><div class="field-label" style="margin-bottom: 4px;">ПРИМЕНЁННЫЕ АВТОМАТИЧЕСКИЕ ПРАВИЛА</div>${{warningsList}}</div>` : ''}}

            <div class="field-block">
              <div class="field-label">КАНОНИЧЕСКИЙ PAYLOAD content_v2</div>
              <pre class="preserve-text json-box">${{v2Formatted}}</pre>
            </div>
          </div>
        </div>
      `;
    }} else {{
      const reasonsList = card.diagnostics.map(d => `
        <div class="reason-card">
          <div class="reason-code-title">⛔ ${{escapeHtml(d.code)}}</div>
          <div class="reason-msg">${{escapeHtml(d.message)}}</div>
          ${{d.path ? `<div class="reason-path">Путь: ${{escapeHtml(d.path)}}</div>` : ''}}
          <div class="reason-rec"><strong>Действие:</strong> ${{escapeHtml(d.recommendation)}}</div>
        </div>
      `).join('');

      rightSideHtml = `
        <div class="pane">
          <div class="pane-header">
            <div class="pane-title">
              <span style="color: var(--accent-red);">✕</span>
              <span>РЕЗУЛЬТАТ ПРЕОБРАЗОВАНИЯ V2</span>
            </div>
          </div>
          <div class="pane-body">
            ${{decisionCheckboxesHtml}}

            <div class="status-banner blocked">
              <span>✕ Преобразование невозможно (карточка заблокирована)</span>
            </div>

            <div class="field-block">
              <div class="field-label">ПРИЧИНЫ БЛОКИРОВКИ И РЕКОМЕНДАЦИИ ПО ИСПРАВЛЕНИЮ</div>
              <div class="reasons-list">
                ${{reasonsList || '<div class="reason-card"><div class="reason-msg">Неизвестная ошибка валидации</div></div>'}}
              </div>
            </div>
          </div>
        </div>
      `;
    }}

    // Metadata JSON if present
    let metaSectionHtml = '';
    if (card.metadata && Object.keys(card.metadata).length > 0) {{
      const metaFormatted = escapeHtml(JSON.stringify(card.metadata, null, 2));
      metaSectionHtml = `
        <div class="field-block">
          <div class="field-label">
            <span>МЕТАДАННЫЕ</span>
            <button class="copy-btn" id="copyMetaBtn">Копировать</button>
          </div>
          <pre class="preserve-text json-box" style="max-height: 100px;">${{metaFormatted}}</pre>
        </div>
      `;
    }}

    // 5. COMBINED SPLIT VIEW
    mainView.innerHTML = `
      <div class="split-view-grid">
        <!-- V1 Source Column -->
        <div class="pane">
          <div class="pane-header">
            <div class="pane-title">
              <span>📄 ИСХОДНАЯ КАРТОЧКА V1</span>
            </div>
            <div style="font-size: 11.5px; color: var(--text-sub);">
              Тип БД: <strong>${{escapeHtml(card.stored_type)}}</strong> | Детектор: <strong>${{escapeHtml(card.detected_type)}}</strong>
            </div>
          </div>
          <div class="pane-body">
            <div class="field-block">
              <div class="field-label">
                <span>FRONT (ЛИЦЕВАЯ СТОРОНА)</span>
                <button class="copy-btn" id="copyFrontBtn">Копировать</button>
              </div>
              <pre class="preserve-text">${{escapeHtml(card.front) || '<span class="empty-placeholder">(пусто)</span>'}}</pre>
            </div>

            <div class="field-block">
              <div class="field-label">
                <span>BACK (ОБРАТНАЯ СТОРОНА)</span>
                <button class="copy-btn" id="copyBackBtn">Копировать</button>
              </div>
              <pre class="preserve-text">${{escapeHtml(card.back) || '<span class="empty-placeholder">(пусто)</span>'}}</pre>
            </div>

            <div class="field-block">
              <div class="field-label">
                <span>CONTEXT</span>
                <button class="copy-btn" id="copyContextBtn">Копировать</button>
              </div>
              <pre class="preserve-text" style="max-height: 130px;">${{escapeHtml(card.context) || '<span class="empty-placeholder">(нет контекста)</span>'}}</pre>
            </div>

            ${{mediaHtml}}
            ${{metaSectionHtml}}
          </div>
        </div>

        <!-- V2 Result Column -->
        ${{rightSideHtml}}
      </div>
    `;

    // Hook up checkboxes
    const chkPostpone = document.getElementById('checkPostpone');
    const chkStrict = document.getElementById('checkStrict');
    const chkFix = document.getElementById('checkFix');
    const chkDiscard = document.getElementById('checkDiscard');

    chkPostpone?.addEventListener('change', (e) => setDecision('postpone', e.target.checked));
    chkStrict?.addEventListener('change', (e) => setDecision('strict', e.target.checked));
    chkFix?.addEventListener('change', (e) => setDecision('fix', e.target.checked));
    chkDiscard?.addEventListener('change', (e) => setDecision('discard', e.target.checked));

    // Copy buttons
    document.getElementById('copyFrontBtn')?.addEventListener('click', () => {{
      navigator.clipboard.writeText(card.front || '');
    }});
    document.getElementById('copyBackBtn')?.addEventListener('click', () => {{
      navigator.clipboard.writeText(card.back || '');
    }});
    document.getElementById('copyContextBtn')?.addEventListener('click', () => {{
      navigator.clipboard.writeText(card.context || '');
    }});
    document.getElementById('copyMetaBtn')?.addEventListener('click', () => {{
      navigator.clipboard.writeText(JSON.stringify(card.metadata, null, 2));
    }});
    document.getElementById('copyV2Btn')?.addEventListener('click', () => {{
      navigator.clipboard.writeText(JSON.stringify(card.v2_result, null, 2));
      alert('JSON V2 скопирован.');
    }});
  }}

  // Event Listeners
  prevBtn.addEventListener('click', () => goToIndex(currentIndex - 1));
  nextBtn.addEventListener('click', () => goToIndex(currentIndex + 1));
  firstBtn.addEventListener('click', () => goToIndex(0));
  lastBtn.addEventListener('click', () => goToIndex(filteredCards.length - 1));

  jumpIndexInput.addEventListener('change', () => {{
    const val = parseInt(jumpIndexInput.value, 10);
    if (!isNaN(val)) goToIndex(val - 1);
  }});

  jumpIndexInput.addEventListener('keydown', (e) => {{
    if (e.key === 'Enter') {{
      const val = parseInt(jumpIndexInput.value, 10);
      if (!isNaN(val)) goToIndex(val - 1);
    }}
  }});

  // Keyboard navigation & Action Hotkeys (Z, X, C, V)
  window.addEventListener('keydown', (e) => {{
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

    if (e.key === 'ArrowLeft' || e.key === 'j') {{
      e.preventDefault();
      goToIndex(currentIndex - 1);
    }} else if (e.key === 'ArrowRight' || e.key === 'k') {{
      e.preventDefault();
      goToIndex(currentIndex + 1);
    }} else if (e.code === 'KeyZ' || e.key === 'z' || e.key === 'Z' || e.key === 'я' || e.key === 'Я') {{
      e.preventDefault();
      toggleDecision('postpone');
    }} else if (e.code === 'KeyX' || e.key === 'x' || e.key === 'X' || e.key === 'ч' || e.key === 'Ч') {{
      e.preventDefault();
      toggleDecision('strict');
    }} else if (e.code === 'KeyC' || e.key === 'c' || e.key === 'C' || e.key === 'с' || e.key === 'С') {{
      e.preventDefault();
      toggleDecision('fix');
    }} else if (e.code === 'KeyV' || e.key === 'v' || e.key === 'V' || e.key === 'м' || e.key === 'М') {{
      e.preventDefault();
      toggleDecision('discard');
    }}
  }});

  // Toggle Sidebar
  toggleSidebarBtn.addEventListener('click', () => {{
    sidebar.classList.toggle('closed');
  }});

  // Search input
  let searchTimeout = null;
  searchInput.addEventListener('input', () => {{
    searchClearBtn.style.display = searchInput.value ? 'block' : 'none';
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(filterCards, 150);
  }});

  searchClearBtn.addEventListener('click', () => {{
    searchInput.value = '';
    searchClearBtn.style.display = 'none';
    filterCards();
  }});

  // Category buttons
  categoryGroup.querySelectorAll('.filter-tab').forEach(btn => {{
    btn.addEventListener('click', () => {{
      categoryGroup.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active', 'active-a', 'active-b', 'active-c', 'active-d'));
      const cat = btn.getAttribute('data-cat');
      activeCategory = cat;
      if (cat === 'all') btn.classList.add('active');
      else btn.classList.add(`active-${{cat.toLowerCase()}}`);
      filterCards();
    }});
  }});

  // Select dropdowns
  reasonSelect.addEventListener('change', filterCards);
  decisionFilterSelect.addEventListener('change', filterCards);
  scopeSelect.addEventListener('change', filterCards);
  mediaSelect.addEventListener('change', filterCards);
  statusSelect.addEventListener('change', filterCards);

  // Reset filters
  resetFiltersBtn.addEventListener('click', () => {{
    searchInput.value = '';
    searchClearBtn.style.display = 'none';
    activeCategory = 'all';
    categoryGroup.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active', 'active-a', 'active-b', 'active-c', 'active-d'));
    categoryGroup.querySelector('[data-cat="all"]').classList.add('active');
    reasonSelect.value = 'all';
    decisionFilterSelect.value = 'all';
    scopeSelect.value = 'all';
    mediaSelect.value = 'all';
    statusSelect.value = 'all';
    filterCards();
  }});

  // Export decisions to JSON file
  const exportCategorySelect = document.getElementById('exportCategorySelect');
  const exportBtn = document.getElementById('exportJsonBtn');
  const copyJsonBtn = document.getElementById('copyJsonBtn');
  const importBtn = document.getElementById('importJsonBtn');
  const importInput = document.getElementById('importJsonFileInput');

  const cardsById = new Map(rawCards.map(c => [String(c.id), c]));

  function getExportPayload() {{
    let targetCat = exportCategorySelect ? exportCategorySelect.value : 'A';
    if (targetCat === 'active') {{
      targetCat = activeCategory;
    }}

    // Filter rawCards to include ALL cards from the selected category (or all categories)
    const relevantCards = rawCards.filter(card => {{
      if (targetCat === 'all') return true;
      return card.category && card.category.toUpperCase() === targetCat.toUpperCase();
    }});

    let markedCount = 0;
    const actionCounts = {{ postpone: 0, strict: 0, fix: 0, discard: 0 }};
    const decisionsMap = {{}};

    const enrichedCards = relevantCards.map(card => {{
      const d = decisions[card.id] || {{}};
      const isPostpone = !!d.postpone;
      const isStrict = !!d.strict;
      const isFix = !!d.fix;
      const isDiscard = !!d.discard;
      const isMarked = isPostpone || isStrict || isFix || isDiscard;

      const actions = [];
      if (isPostpone) {{ actions.push('postpone'); actionCounts.postpone++; }}
      if (isStrict) {{ actions.push('strict'); actionCounts.strict++; }}
      if (isFix) {{ actions.push('fix'); actionCounts.fix++; }}
      if (isDiscard) {{ actions.push('discard'); actionCounts.discard++; }}

      if (isMarked) {{
        markedCount++;
        decisionsMap[card.id] = {{
          postpone: isPostpone,
          strict: isStrict,
          fix: isFix,
          discard: isDiscard,
          actions: actions,
          category: card.category,
          deck_id: card.deck_id,
          deck_title: card.deck_title
        }};
      }}

      return {{
        id: card.id,
        marked: isMarked,
        decision: {{
          postpone: isPostpone,
          strict: isStrict,
          fix: isFix,
          discard: isDiscard,
          actions: actions
        }},
        category: card.category,
        category_name: card.category_name,
        deck_id: card.deck_id,
        deck_title: card.deck_title,
        deck_level: card.deck_level,
        scope: card.scope,
        stored_type: card.stored_type,
        detected_type: card.detected_type,
        front: card.front,
        back: card.back,
        context: card.context,
        diagnostics: card.diagnostics,
        warnings: card.warnings,
        media: card.media,
        v2_result: card.v2_result
      }};
    }});

    // Sort: marked cards first (marked: true before marked: false), then by ID ascending
    enrichedCards.sort((a, b) => {{
      const aM = a.marked ? 1 : 0;
      const bM = b.marked ? 1 : 0;
      if (aM !== bM) return bM - aM;
      return a.id - b.id;
    }});

    const catLabel = targetCat === 'all' ? 'всех категорий' : `категории ${{targetCat.toUpperCase()}}`;
    const fileName = targetCat === 'all' ? 'lerne_audit_decisions_all.json' : `lerne_audit_decisions_cat_${{targetCat.toUpperCase()}}.json`;

    return {{
      target_category: targetCat.toUpperCase(),
      exported_at: new Date().toISOString(),
      summary: {{
        total_cards: enrichedCards.length,
        marked_cards: markedCount,
        unmarked_cards: enrichedCards.length - markedCount,
        by_action: actionCounts
      }},
      cat_label: catLabel,
      file_name: fileName,
      cards: enrichedCards,
      decisions: decisionsMap
    }};
  }}

  exportBtn?.addEventListener('click', () => {{
    const payload = getExportPayload();
    if (payload.cards.length === 0) {{
      alert(`Нет карточек для ${{payload.cat_label}}.`);
      return;
    }}
    const blob = new Blob([JSON.stringify(payload, null, 2)], {{ type: 'application/json' }});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = payload.file_name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }});

  copyJsonBtn?.addEventListener('click', () => {{
    const payload = getExportPayload();
    if (payload.cards.length === 0) {{
      alert(`Нет карточек для ${{payload.cat_label}}.`);
      return;
    }}
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
      .then(() => alert(`Скопировано карточек (${{payload.cat_label}}): всего ${{payload.summary.total_cards}} (из них с пометками: ${{payload.summary.marked_cards}}, в начале списка).`))
      .catch(() => alert('Не удалось скопировать в буфер.'));
  }});

  importBtn?.addEventListener('click', () => {{
    importInput?.click();
  }});

  importInput?.addEventListener('change', (e) => {{
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {{
      try {{
        const parsed = JSON.parse(event.target.result);
        let imported = {{}};
        if (parsed.cards && Array.isArray(parsed.cards)) {{
          for (const c of parsed.cards) {{
            if (c.marked && c.decision) {{
              imported[c.id] = {{
                postpone: !!c.decision.postpone,
                strict: !!c.decision.strict,
                fix: !!c.decision.fix,
                discard: !!c.decision.discard,
                category: c.category,
                deck_id: c.deck_id,
                deck_title: c.deck_title
              }};
            }}
          }}
        }} else if (parsed.decisions && typeof parsed.decisions === 'object') {{
          imported = parsed.decisions;
        }} else if (typeof parsed === 'object' && parsed !== null) {{
          imported = parsed;
        }}

        const count = Object.keys(imported).length;
        if (count > 0) {{
          decisions = {{ ...decisions, ...imported }};
          saveDecisions();
          renderActiveCard();
          renderSidebarList();
          alert(`Успешно загружено пометок: ${{count}} карточек.`);
        }} else {{
          alert('В файле не найдено отмеченных карточек.');
        }}
      }} catch (err) {{
        alert('Ошибка при чтении JSON: ' + err.message);
      }}
    }};
    reader.readAsText(file);
    importInput.value = '';
  }});

  // Initial load
  filterCards();
}})();
</script>
</body>
</html>
"""

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html_content, encoding='utf-8')
    print(f"HTML report successfully written: {output_path} ({output_path.stat().st_size / (1024 * 1024):.2f} MB)")


def main() -> int:
    output_path = REPO_ROOT / 'local' / 'test-data' / 'blocked_cards_viewer.html'
    cards_data = extract_blocked_cards_data()
    generate_html_viewer(cards_data, output_path)
    print("\n=== Generation Complete ===")
    print(f"File: {output_path.resolve()}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
