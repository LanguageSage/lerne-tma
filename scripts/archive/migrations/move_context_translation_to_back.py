import argparse
import os
import re
import sqlite3
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from playhouse.db_url import connect as connect_db_url


ROOT = Path(__file__).resolve().parent.parent
LOCAL_DB = ROOT / "api" / "data" / "tma.db"


def split_translation_context(raw_context: str) -> tuple[str, str]:
    text = (raw_context or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        return "", ""

    field_match = re.match(
        r"(?is)^\s*Поле\s*3:\s*(.*?)(?:\n\s*Поле\s*4:\s*|\Z)(.*)$",
        text,
    )
    if field_match:
        translation = field_match.group(1).strip()
        rest = field_match.group(2).strip()
        return translation, rest

    translation_match = re.match(r"(?is)^\s*Перевод:\s*([^\n]+)(?:\n(.*))?$", text)
    if translation_match:
        translation = translation_match.group(1).strip()
        rest = (translation_match.group(2) or "").strip()
        return translation, rest

    quoted_match = re.match(r"^\s*[«„\"](.+?)[»“\"](.*)$", text, flags=re.S)
    if quoted_match:
        translation = quoted_match.group(1).strip()
        rest = quoted_match.group(2).lstrip(" .—-:\n\t").strip()
        return translation, rest

    lines = text.split("\n")
    collected = [lines[0].strip()]
    consumed = 1
    terminal = (".", "!", "?", ":", "…", "»", "\"")

    while consumed < len(lines):
        current = collected[-1].strip()
        next_line = lines[consumed].strip()
        if not next_line:
            break
        first_char = next_line[0]
        looks_like_continuation = first_char.islower() or first_char in ",;-/"
        if current.endswith(terminal) or not looks_like_continuation or consumed >= 3:
            break
        collected.append(next_line)
        consumed += 1

    translation = " ".join(line for line in collected if line).strip()
    rest = "\n".join(lines[consumed:]).strip()
    return translation, rest


def iter_candidates(fetch_all):
    rows = fetch_all(
        """
        SELECT id, front_text, back_text, context
        FROM tma_card
        WHERE COALESCE(LENGTH(TRIM(back_text)), 0) = 0
          AND COALESCE(LENGTH(TRIM(context)), 0) > 0
        ORDER BY id
        """
    )
    for card_id, front, _back, context in rows:
        translation, new_context = split_translation_context(context)
        if translation:
            yield card_id, front, translation, new_context


def safe_preview(value: str, max_len: int) -> str:
    return ascii((value or "")[:max_len])


def run_cloud(dry_run: bool, limit: int | None):
    load_dotenv(ROOT / ".env")
    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        raise RuntimeError("SUPABASE_DB_URL is not set")

    db = connect_db_url(url)
    try:
        candidates = list(iter_candidates(lambda sql: db.execute_sql(sql).fetchall()))
        if limit:
            candidates = candidates[:limit]

        print(f"cloud candidates: {len(candidates)}")
        for card_id, front, translation, new_context in candidates[:10]:
            print(f"- {card_id}: {safe_preview(front, 60)} -> {safe_preview(translation, 90)}; context left {len(new_context)} chars")

        if dry_run or not candidates:
            return

        now = datetime.now()
        with db.atomic():
            for card_id, _front, translation, new_context in candidates:
                db.execute_sql(
                    """
                    UPDATE tma_card
                    SET back_text = %s,
                        context = %s,
                        updated_at = %s
                    WHERE id = %s
                    """,
                    [translation, new_context, now, card_id],
                )
        print(f"cloud updated: {len(candidates)}")
    finally:
        db.close()


def run_local(dry_run: bool, limit: int | None):
    conn = sqlite3.connect(LOCAL_DB)
    try:
        candidates = list(iter_candidates(lambda sql: conn.execute(sql).fetchall()))
        if limit:
            candidates = candidates[:limit]

        print(f"local candidates: {len(candidates)}")
        for card_id, front, translation, new_context in candidates[:10]:
            print(f"- {card_id}: {safe_preview(front, 60)} -> {safe_preview(translation, 90)}; context left {len(new_context)} chars")

        if dry_run or not candidates:
            return

        now = datetime.now().isoformat(sep=" ", timespec="seconds")
        with conn:
            conn.executemany(
                """
                UPDATE tma_card
                SET back_text = ?,
                    context = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                [(translation, new_context, now, card_id) for card_id, _front, translation, new_context in candidates],
            )
        print(f"local updated: {len(candidates)}")
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["cloud", "local"], required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()

    dry_run = not args.apply
    if args.target == "cloud":
        run_cloud(dry_run=dry_run, limit=args.limit)
    else:
        run_local(dry_run=dry_run, limit=args.limit)


if __name__ == "__main__":
    main()
