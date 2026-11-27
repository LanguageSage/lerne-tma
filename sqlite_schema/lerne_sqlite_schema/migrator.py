"""Shared SQLite connection, migration runner, and integrity verification."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
from importlib import resources
import json
from pathlib import Path
import sqlite3
from typing import Any, Optional, Union


class MigrationError(RuntimeError):
    """Raised when SQLite schema migrations fail checksum or version checks."""


class SchemaIntegrityError(RuntimeError):
    """Raised when SQLite integrity_check or foreign_key_check reports corruption."""


def _manifest_text() -> str:
    return resources.files("lerne_sqlite_schema").joinpath("schema_manifest.json").read_text(encoding="utf-8")


def _migration_sql(filename: str) -> bytes:
    return resources.files("lerne_sqlite_schema").joinpath("migrations", filename).read_bytes()


def load_manifest() -> dict[str, Any]:
    """Load and verify the canonical schema_manifest.json against packaged SQL files."""
    manifest = json.loads(_manifest_text())
    migrations = manifest.get("migrations")
    if not isinstance(migrations, list) or not migrations:
        raise MigrationError("Invalid schema_manifest.json: migrations list is empty")
    expected_version = 1
    for entry in migrations:
        version = entry.get("version")
        name = entry.get("name")
        filename = entry.get("filename")
        expected_sha = entry.get("sha256")
        if (
            type(version) is not int
            or version != expected_version
            or not isinstance(name, str)
            or not name
            or not isinstance(filename, str)
            or not filename.endswith(".sql")
            or not isinstance(expected_sha, str)
            or len(expected_sha) != 64
        ):
            raise MigrationError(f"Malformed migration entry in schema_manifest.json: {entry!r}")
        raw_sql = _migration_sql(filename)
        if b"\r" in raw_sql:
            raise MigrationError(f"Migration {filename} must use LF line endings")
        actual_sha = hashlib.sha256(raw_sql).hexdigest()
        if actual_sha != expected_sha:
            raise MigrationError(
                f"SHA-256 mismatch for migration {filename}: expected {expected_sha}, got {actual_sha}"
            )
        expected_version += 1
    if manifest.get("schema_version") != len(migrations):
        raise MigrationError("schema_manifest.json schema_version does not match migrations count")
    return manifest


def split_sql_statements(sql_text: str) -> list[str]:
    """Split a multi-statement SQL script cleanly without implicit COMMIT."""
    statements: list[str] = []
    buffer: list[str] = []
    for line in sql_text.splitlines(keepends=True):
        stripped = line.strip()
        if not buffer and (not stripped or stripped.startswith("--")):
            continue
        buffer.append(line)
        candidate = "".join(buffer)
        if sqlite3.complete_statement(candidate):
            cleaned = candidate.strip()
            if cleaned:
                statements.append(cleaned)
            buffer.clear()
    remainder = "".join(buffer).strip()
    if remainder and not all(not part.strip() or part.strip().startswith("--") for part in remainder.splitlines()):
        raise MigrationError(f"Incomplete SQL statement in migration: {remainder[:80]!r}")
    return statements


def open_sqlite(path: Union[str, Path], *, readonly: bool = False) -> sqlite3.Connection:
    """Open a SQLite connection configured with foreign_keys=ON and WAL mode."""
    target = str(path)
    is_memory = target == ":memory:" or target.startswith("file::memory:")
    if readonly:
        if is_memory:
            raise ValueError("Cannot open in-memory SQLite database as readonly")
        uri = Path(target).resolve().as_uri() + "?mode=ro"
        conn = sqlite3.connect(uri, uri=True, timeout=10.0, isolation_level=None)
    else:
        if not is_memory:
            Path(target).parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(target, timeout=10.0, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    if not readonly and not is_memory:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
    return conn


def verify_integrity(conn: sqlite3.Connection) -> dict[str, Any]:
    """Run PRAGMA integrity_check and PRAGMA foreign_key_check; fail closed on errors."""
    rows = [row[0] for row in conn.execute("PRAGMA integrity_check").fetchall()]
    if rows != ["ok"]:
        raise SchemaIntegrityError(f"SQLite integrity_check failed: {rows!r}")
    fk_rows = [tuple(row) for row in conn.execute("PRAGMA foreign_key_check").fetchall()]
    if fk_rows:
        raise SchemaIntegrityError(f"SQLite foreign_key_check failed: {fk_rows[:10]!r}")
    return {"integrity": "ok", "foreign_key_violations": 0}


def _schema_migrations_exists(conn: sqlite3.Connection) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
    ).fetchone()
    return row is not None


def _read_applied(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    if not _schema_migrations_exists(conn):
        return []
    rows = conn.execute(
        "SELECT version, name, sha256, applied_at FROM schema_migrations ORDER BY version"
    ).fetchall()
    return [dict(row) for row in rows]


def migration_status(conn: sqlite3.Connection) -> dict[str, Any]:
    """Return applied, pending, and latest versions without mutating the database."""
    manifest = load_manifest()
    applied = _read_applied(conn)
    applied_versions = {row["version"] for row in applied}
    pending = [m["version"] for m in manifest["migrations"] if m["version"] not in applied_versions]
    return {
        "schema_format": manifest.get("format"),
        "target_version": manifest["schema_version"],
        "current_version": max(applied_versions) if applied_versions else 0,
        "user_version": conn.execute("PRAGMA user_version").fetchone()[0],
        "applied": applied,
        "pending_versions": pending,
    }


def migrate(conn: sqlite3.Connection, *, verify: bool = True) -> dict[str, Any]:
    """Verify applied migrations and apply pending canonical migrations transactionally."""
    manifest = load_manifest()
    by_version = {entry["version"]: entry for entry in manifest["migrations"]}
    max_version = manifest["schema_version"]

    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
                applied_at TEXT NOT NULL
            )
            """
        )
        applied_rows = _read_applied(conn)
        applied_versions: set[int] = set()
        for row in applied_rows:
            ver = row["version"]
            if ver not in by_version:
                raise MigrationError(
                    f"Database contains unknown migration version {ver} (supported up to {max_version})"
                )
            expected = by_version[ver]
            if row["name"] != expected["name"] or row["sha256"] != expected["sha256"]:
                raise MigrationError(
                    f"Applied migration v{ver} ({row['name']}) checksum/name mismatch against manifest"
                )
            applied_versions.add(ver)

        applied_now: list[int] = []
        now_iso = datetime.now(timezone.utc).isoformat()
        for entry in manifest["migrations"]:
            ver = entry["version"]
            if ver in applied_versions:
                continue
            sql_text = _migration_sql(entry["filename"]).decode("utf-8")
            for stmt in split_sql_statements(sql_text):
                conn.execute(stmt)
            conn.execute(
                "INSERT INTO schema_migrations (version, name, sha256, applied_at) VALUES (?, ?, ?, ?)",
                (ver, entry["name"], entry["sha256"], now_iso),
            )
            applied_now.append(ver)

        conn.execute(f"PRAGMA user_version = {int(max_version)}")
        conn.execute("COMMIT")
    except Exception:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise

    if verify:
        verify_integrity(conn)
    return {
        "schema_version": max_version,
        "applied_now": applied_now,
        "total_applied": len(manifest["migrations"]),
    }
