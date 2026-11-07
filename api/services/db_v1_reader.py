"""Safe read-only V1 card and deck extraction and migration dry-run from LOCAL PostgreSQL.

This module performs strictly read-only SELECT queries on the local database to
inspect legacy cards without applying migrations or mutating any table rows.
"""

from __future__ import annotations

import copy
import json
import logging
from typing import Any

from api.v1_to_v2_converter import (
    convert_v1_snapshot,
    format_dry_run_summary,
    run_v1_migration_dry_run,
)

logger = logging.getLogger(__name__)

# Real columns present in the legacy database (content_v2 is omitted as it does not exist yet).
_TMA_DECK_COLS: tuple[str, ...] = (
    'id',
    'name',
    'level',
    'topic',
    'metadata',
    'is_deleted',
    'position',
    'user_id',
    'target_language',
)

_LIB_DECK_COLS: tuple[str, ...] = (
    'id',
    'name',
    'level',
    'topic',
    'metadata',
    'is_deleted',
    'position',
    'target_language',
)

_CARD_COMMON_COLS: tuple[str, ...] = (
    'id',
    'deck_id',
    'front_text',
    'back_text',
    'context',
    'image_path',
    'audio_path',
    'audio_back_path',
    'video_front_path',
    'video_back_path',
    'tags',
    'topics',
    'card_type',
    'metadata',
    'position',
    'is_deleted',
)


def check_local_db_availability() -> dict[str, Any]:
    """Check connectivity to the local database in a strictly read-only manner."""
    try:
        from api import models
        with models.tma_db.connection_context():
            cursor = models.tma_db.execute_sql('SELECT 1')
            cursor.fetchone()
            tables = models.tma_db.get_tables()
            tma_cards = models.tma_db.execute_sql('SELECT COUNT(*) FROM tma_card').fetchone()[0]
            tma_decks = models.tma_db.execute_sql('SELECT COUNT(*) FROM tma_deck').fetchone()[0]
            lib_cards = models.tma_db.execute_sql('SELECT COUNT(*) FROM card').fetchone()[0]
            lib_decks = models.tma_db.execute_sql('SELECT COUNT(*) FROM deck').fetchone()[0]
            return {
                'available': True,
                'tables': tables,
                'counts': {
                    'tma_decks': tma_decks,
                    'tma_cards': tma_cards,
                    'library_decks': lib_decks,
                    'library_cards': lib_cards,
                },
                'error': None,
            }
    except Exception as exc:
        return {
            'available': False,
            'tables': [],
            'counts': {'tma_decks': 0, 'tma_cards': 0, 'library_decks': 0, 'library_cards': 0},
            'error': str(exc),
        }


def fetch_v1_snapshot_from_db(
    scope: str = 'tma',
    *,
    include_deleted: bool = False,
    limit_cards: int | None = None,
) -> dict[str, Any]:
    """Safely fetch a `{decks, cards}` snapshot from LOCAL PostgreSQL without altering data.

    Parameters:
    - scope: 'tma' (study cards), 'library' (shared library cards), or 'all'
    - include_deleted: whether to include soft-deleted cards (is_deleted=True)
    - limit_cards: optional integer to limit card count for fast checking
    """
    if scope not in ('tma', 'library', 'all'):
        raise ValueError(f"Invalid scope {scope!r}; must be 'tma', 'library', or 'all'")

    from api import models

    with models.tma_db.connection_context():
        decks: list[dict[str, Any]] = []
        cards: list[dict[str, Any]] = []

        if scope in ('tma', 'all'):
            where_deck = '' if include_deleted else 'WHERE is_deleted = false'
            cur = models.tma_db.execute_sql(
                f"SELECT {', '.join(_TMA_DECK_COLS)} FROM tma_deck {where_deck} ORDER BY id ASC"
            )
            for row in cur.fetchall():
                d = dict(zip(_TMA_DECK_COLS, row))
                d['scope'] = 'tma'
                decks.append(d)

            where_card = '' if include_deleted else 'WHERE is_deleted = false'
            limit_clause = f'LIMIT {limit_cards}' if (limit_cards and scope == 'tma') else ''
            cur = models.tma_db.execute_sql(
                f"SELECT {', '.join(_CARD_COMMON_COLS)} FROM tma_card {where_card} "
                f"ORDER BY deck_id ASC, position ASC, id ASC {limit_clause}"
            )
            for row in cur.fetchall():
                c = dict(zip(_CARD_COMMON_COLS, row))
                c['scope'] = 'tma'
                cards.append(c)

        if scope in ('library', 'all'):
            where_deck = '' if include_deleted else 'WHERE is_deleted = false'
            cur = models.tma_db.execute_sql(
                f"SELECT {', '.join(_LIB_DECK_COLS)} FROM deck {where_deck} ORDER BY id ASC"
            )
            for row in cur.fetchall():
                d = dict(zip(_LIB_DECK_COLS, row))
                d['scope'] = 'library'
                decks.append(d)

            where_card = '' if include_deleted else 'WHERE is_deleted = false'
            limit_clause = f'LIMIT {limit_cards}' if (limit_cards and scope == 'library') else ''
            cur = models.tma_db.execute_sql(
                f"SELECT {', '.join(_CARD_COMMON_COLS)} FROM card {where_card} "
                f"ORDER BY deck_id ASC, position ASC, id ASC {limit_clause}"
            )
            for row in cur.fetchall():
                c = dict(zip(_CARD_COMMON_COLS, row))
                c['scope'] = 'library'
                cards.append(c)

    return {
        'scope': scope,
        'decks': decks,
        'cards': cards,
    }


def categorize_migration_fixes(report: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Categorize diagnostic reasons into safe automatic fixes vs. manual fixes."""
    automatic_fixes: list[dict[str, Any]] = []
    manual_fixes: list[dict[str, Any]] = []

    # Automatic fix patterns
    warn_by_code = report.get('warnings_by_code', {})
    if 'implicit_free_text_policy' in warn_by_code:
        info = warn_by_code['implicit_free_text_policy']
        automatic_fixes.append({
            'code': 'implicit_free_text_policy',
            'count': info['count'],
            'affected_card_ids': info['card_ids'],
            'description': 'Отсутствие grading_policy у карточек @free автоматически преобразуется в controlled_text '
                           '(100% эквивалентность с V1 evaluate_deterministic).',
        })
    if 'legacy_translation_card_type_normalized' in warn_by_code:
        info = warn_by_code['legacy_translation_card_type_normalized']
        automatic_fixes.append({
            'code': 'legacy_translation_card_type_normalized',
            'count': info['count'],
            'affected_card_ids': info['card_ids'],
            'description': "Устаревший тип колонки 'translation' у стандартных карточек безопасно нормализуется в 'standard'.",
        })
    if 'shared_card_position' in warn_by_code:
        info = warn_by_code['shared_card_position']
        automatic_fixes.append({
            'code': 'shared_card_position',
            'count': info['count'],
            'affected_card_ids': info['card_ids'],
            'description': 'Неуникальные значения position (дефолт 0) в колоде безопасно ре-индексируются по порядку '
                           'ORDER BY position ASC, id ASC.',
        })

    # Manual fixes: each blocked code in reasons
    reasons = report.get('reasons', {})
    for code, info in reasons.items():
        desc = info.get('sample_message', code)
        recommendation = 'Требуется ручное исправление перед миграцией.'
        if code == 'empty_back':
            recommendation = 'Карточки без обратной стороны (ответа). Требуется указать перевод или преобразовать в @theory.'
        elif code == 'card_type_mismatch':
            recommendation = 'Сохранённый card_type конфликтует с синтаксисом карточки. Требуется согласовать тип с контентом.'
        elif code == 'unmarked_preamble_before_directive':
            recommendation = 'Текст инструкции размещён внутри блока ::exercise перед директивой (@puzzle/@match). Обернуть в ::task.'
        elif code == 'unconverted_blank_placeholder':
            recommendation = 'Стандартная карточка содержит плейсхолдер ___ без разметки [[пропуск]] или {выбор}.'
        elif code == 'invalid_trainer_structure':
            recommendation = 'Некорректная разметка тренажёра (например, меньше двух вариантов ответа в части выбора).'
        elif code == 'invalid_quiz_structure':
            recommendation = 'Некорректная разметка квиза (нет вариантов ответа или не отмечен правильный ответ).'
        elif code == 'invalid_context_directive':
            recommendation = 'Поле context содержит некорректные директивы или повреждённый текст (например, полный дамп генерации).'
        elif code == 'invalid_tags':
            recommendation = 'Синтаксическая ошибка в поле tags.'
        elif code == 'conflicting_level_sources':
            recommendation = 'Конфликтующие уровни CEFR в разных источниках карточки (например, в тегах указаны одновременно A1 и B1).'

        manual_fixes.append({
            'code': code,
            'count': info['count'],
            'affected_card_ids': info.get('card_ids', []),
            'affected_deck_ids': info.get('deck_ids', []),
            'sample_message': desc,
            'recommendation': recommendation,
        })

    return {
        'automatic': automatic_fixes,
        'manual': manual_fixes,
    }


def run_local_db_migration_dry_run(
    scope: str = 'all',
    *,
    include_deleted: bool = False,
    allow_shared_positions: bool = True,
    include_payloads: bool = False,
) -> dict[str, Any]:
    """Execute mass dry-run on real LOCAL PostgreSQL data without mutating the database."""
    db_status = check_local_db_availability()
    if not db_status['available']:
        return {
            'ok': False,
            'db_available': False,
            'error': db_status.get('error'),
            'message': 'LOCAL PostgreSQL is not reachable; live database check was not executed.',
            'scopes': {},
            'combined': {},
            'fixes': {'automatic': [], 'manual': []},
        }

    scopes_to_run = ['tma', 'library'] if scope == 'all' else [scope]
    scope_reports: dict[str, Any] = {}

    total_decks = 0
    total_cards = 0
    total_converted = 0
    total_blocked = 0
    total_warnings = 0
    all_reasons: dict[str, dict[str, Any]] = {}
    all_warnings: dict[str, dict[str, Any]] = {}
    overall_invariants = {
        'source_unmodified': True,
        'id_uniqueness_ok': True,
        'order_preserved': True,
        'metadata_preserved': True,
        'media_links_preserved': True,
        'v2_valid': True,
    }

    for s in scopes_to_run:
        snapshot = fetch_v1_snapshot_from_db(scope=s, include_deleted=include_deleted)
        rep = run_v1_migration_dry_run(
            snapshot,
            include_converted_payloads=include_payloads,
            allow_shared_positions=allow_shared_positions,
        )
        scope_reports[s] = rep
        total_decks += rep['total_decks']
        total_cards += rep['total_cards']
        total_converted += rep['converted_count']
        total_blocked += rep['blocked_count']
        total_warnings += rep['warning_count']

        for inv_k, inv_v in rep.get('invariants', {}).items():
            if not inv_v:
                overall_invariants[inv_k] = False

        for code, info in rep.get('reasons', {}).items():
            if code not in all_reasons:
                all_reasons[code] = {
                    'count': 0,
                    'severity': 'ERROR',
                    'card_ids': [],
                    'deck_ids': [],
                    'sample_message': info.get('sample_message', ''),
                }
            all_reasons[code]['count'] += info['count']
            for cid in info.get('card_ids', []):
                if cid not in all_reasons[code]['card_ids']:
                    all_reasons[code]['card_ids'].append(cid)
            for did in info.get('deck_ids', []):
                if did not in all_reasons[code]['deck_ids']:
                    all_reasons[code]['deck_ids'].append(did)

        for code, info in rep.get('warnings_by_code', {}).items():
            if code not in all_warnings:
                all_warnings[code] = {
                    'count': 0,
                    'severity': 'WARNING',
                    'card_ids': [],
                    'deck_ids': [],
                    'sample_message': info.get('sample_message', ''),
                }
            all_warnings[code]['count'] += info['count']
            for cid in info.get('card_ids', []):
                if cid not in all_warnings[code]['card_ids']:
                    all_warnings[code]['card_ids'].append(cid)
            for did in info.get('deck_ids', []):
                if did not in all_warnings[code]['deck_ids']:
                    all_warnings[code]['deck_ids'].append(did)

    combined_summary = {
        'ok': total_blocked == 0 and all(overall_invariants.values()),
        'total_decks': total_decks,
        'total_cards': total_cards,
        'converted_count': total_converted,
        'blocked_count': total_blocked,
        'warning_count': total_warnings,
        'reasons': all_reasons,
        'warnings_by_code': all_warnings,
        'invariants': overall_invariants,
    }

    fixes = categorize_migration_fixes(combined_summary)

    return {
        'ok': combined_summary['ok'],
        'db_available': True,
        'include_deleted': include_deleted,
        'allow_shared_positions': allow_shared_positions,
        'scope': scope,
        'scopes': scope_reports,
        'combined': combined_summary,
        'fixes': fixes,
    }


def format_db_dry_run_summary(report: dict[str, Any]) -> str:
    """Format a human-readable summary of the real database dry-run findings."""
    if not report.get('db_available'):
        return f"=== LOCAL Database Dry-Run: NOT AVAILABLE ===\nError: {report.get('error', 'unknown error')}"

    lines: list[str] = []
    combined = report.get('combined', {})
    status = 'READY FOR MIGRATION' if combined.get('ok') else 'BLOCKED (manual fixes required)'
    lines.append(f"=== LOCAL Database V1 -> V2 Migration Readiness [{status}] ===")
    lines.append(f"Scope: {report.get('scope', 'all')} (include_deleted={report.get('include_deleted', False)})")
    lines.append(
        f"Total Decks: {combined.get('total_decks', 0)} | "
        f"Total Cards: {combined.get('total_cards', 0)} | "
        f"Ready (Converted): {combined.get('converted_count', 0)} ({(combined.get('converted_count', 0) / max(1, combined.get('total_cards', 1)) * 100):.1f}%) | "
        f"Blocked: {combined.get('blocked_count', 0)} | "
        f"Warnings: {combined.get('warning_count', 0)}"
    )

    invariants = combined.get('invariants', {})
    inv_str = ', '.join(f"{k}={'OK' if v else 'FAIL'}" for k, v in invariants.items())
    lines.append(f"Invariants: {inv_str}")

    scopes = report.get('scopes', {})
    for s_name, s_rep in scopes.items():
        s_pct = (s_rep.get('converted_count', 0) / max(1, s_rep.get('total_cards', 1))) * 100
        lines.append(
            f"  [{s_name.upper()}] Decks: {s_rep.get('total_decks', 0)} | "
            f"Cards: {s_rep.get('total_cards', 0)} | "
            f"Ready: {s_rep.get('converted_count', 0)} ({s_pct:.1f}%) | "
            f"Blocked: {s_rep.get('blocked_count', 0)} | "
            f"Warnings: {s_rep.get('warning_count', 0)}"
        )

    fixes = report.get('fixes', {})
    auto_fixes = fixes.get('automatic', [])
    if auto_fixes:
        lines.append('\n--- Safe Automatic Fixes (Applied Cleanly Without Data Loss) ---')
        for fix in auto_fixes:
            lines.append(f"  * {fix['code']} ({fix['count']} cards): {fix['description']}")

    manual_fixes = fixes.get('manual', [])
    if manual_fixes:
        lines.append('\n--- Blocked Issues Requiring Manual Decision/Fix ---')
        for fix in sorted(manual_fixes, key=lambda x: -x['count']):
            c_ids = fix.get('affected_card_ids', [])
            c_preview = ', '.join(str(cid) for cid in c_ids[:10])
            if len(c_ids) > 10:
                c_preview += f", ... (+{len(c_ids) - 10} more)"
            lines.append(f"  * {fix['code']} ({fix['count']} cards, e.g. IDs: [{c_preview}]):")
            lines.append(f"      Problem: {fix['sample_message']}")
            lines.append(f"      Action:  {fix['recommendation']}")

    return '\n'.join(lines)


def main(argv: list[str] | None = None) -> int:
    """CLI entrypoint for running safe LOCAL database V1 -> V2 migration dry-run."""
    import argparse
    from pathlib import Path
    import sys

    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8')

    parser = argparse.ArgumentParser(description='Safe read-only LOCAL PostgreSQL migration dry-run.')
    parser.add_argument(
        '--scope',
        choices=['tma', 'library', 'all'],
        default='all',
        help='Scope of cards to inspect: tma (study), library (library cards), or all (default)',
    )
    parser.add_argument(
        '--include-deleted',
        action='store_true',
        help='Include soft-deleted cards and decks in the dry run',
    )
    parser.add_argument(
        '--strict-positions',
        action='store_true',
        help='Fail on shared/duplicate position values within a deck instead of auto-normalizing with warning',
    )
    parser.add_argument(
        '--summary',
        action='store_true',
        help='Print human-readable summary',
    )
    parser.add_argument(
        '--report-out',
        type=Path,
        default=None,
        help='Optional path to write full JSON report',
    )
    parser.add_argument(
        '--include-payloads',
        action='store_true',
        help='Include converted content_v2 payloads in the report JSON',
    )
    args = parser.parse_args(argv)

    report = run_local_db_migration_dry_run(
        scope=args.scope,
        include_deleted=args.include_deleted,
        allow_shared_positions=not args.strict_positions,
        include_payloads=args.include_payloads,
    )

    report_json = json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False)
    if args.report_out:
        args.report_out.write_text(report_json + '\n', encoding='utf-8')
        if args.summary:
            print(format_db_dry_run_summary(report))
        else:
            print(report_json)
    elif args.summary:
        print(format_db_dry_run_summary(report))
    else:
        print(report_json)

    if not report.get('db_available'):
        return 2
    return 0 if report.get('ok') else 1


if __name__ == '__main__':
    raise SystemExit(main())
