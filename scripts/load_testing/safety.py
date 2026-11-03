"""Security verification and safety guards for FastAPI load testing.

Enforces multi-layer protection to prevent load testing, seeding, or cleanup
from ever targeting production environments or databases.
"""
from __future__ import annotations

import os
import re
import sys
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit, urlunsplit


class SecurityError(Exception):
    """Raised when a security guard or safety validation fails."""
    pass


# Production domain and keyword patterns that are unconditionally forbidden
FORBIDDEN_HOST_PATTERNS = [
    re.compile(r"(^|\.)lerne\.app$", re.IGNORECASE),
    re.compile(r"(^|\.)vercel\.app$", re.IGNORECASE),
    re.compile(r"(^|\.)supabase\.co$", re.IGNORECASE),
    re.compile(r"(^|\.)supabase\.in$", re.IGNORECASE),
    re.compile(r"production", re.IGNORECASE),
    re.compile(r"(^|\-)prod(\-|\.|$)", re.IGNORECASE),
]

# Standard loopback hosts for local development
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1", "testserver"}

# Approved database names for testing
APPROVED_TEST_DB_PATTERNS = [
    re.compile(r"^lerne_tma_local$", re.IGNORECASE),
    re.compile(r"^.*test.*$", re.IGNORECASE),
    re.compile(r"^.*local.*$", re.IGNORECASE),
    re.compile(r"^.*loadtest.*$", re.IGNORECASE),
    re.compile(r"^.*perf.*$", re.IGNORECASE),
]


def is_production_environment() -> bool:
    """Checks whether the current process environment indicates production."""
    if os.environ.get("ENVIRONMENT", "").strip().lower() == "production":
        return True
    if os.environ.get("NODE_ENV", "").strip().lower() == "production":
        return True
    if os.environ.get("VERCEL_ENV", "").strip().lower() == "production":
        return True
    # Vercel cloud environment (outside unittest runner)
    if os.environ.get("VERCEL") == "1":
        if os.environ.get("ENVIRONMENT", "").strip().lower() in ("test", "local", "development"):
            return False
        if "unittest" in sys.modules or "pytest" in sys.modules:
            return False
        return True
    return False


def sanitize_url(url: str) -> str:
    """Strips credentials (user:pass) and query/fragment secrets from a URL."""
    try:
        parts = urlsplit(url)
        # Rebuild without username and password
        hostname = parts.hostname or ""
        host_str = f"[{hostname}]" if ":" in hostname else hostname
        port = f":{parts.port}" if parts.port else ""
        netloc = f"{host_str}{port}"
        return urlunsplit((parts.scheme, netloc, parts.path, "", ""))
    except Exception:
        return "[INVALID_URL]"


def sanitize_text(text: str) -> str:
    """Redacts tokens, secrets, passwords and credentials from text strings."""
    if not isinstance(text, str):
        return str(text)

    # Redact session tokens (la_... and lr_...)
    text = re.sub(r"\b(la|lr)_[A-Za-z0-9_-]{20,}\b", r"\1_[REDACTED]", text)
    # Redact Bearer tokens in headers
    text = re.sub(r"(Bearer\s+)[A-Za-z0-9_.\-]+", r"\1[REDACTED]", text, flags=re.IGNORECASE)
    # Redact passwords in connection URLs: postgresql://user:pass@host -> postgresql://user:[REDACTED]@host
    text = re.sub(r"://([^:]+):([^@]+)@", r"://\1:[REDACTED]@", text)
    # Redact secret key params
    text = re.sub(r"(secret|password|token|key)=([^&\s]+)", r"\1=[REDACTED]", text, flags=re.IGNORECASE)
    return text


def validate_target_url(
    target_url: str,
    in_process: bool = False,
    allowed_remote_hosts: Optional[List[str]] = None,
    confirm_isolated_remote: bool = False,
) -> str:
    """Validates that a target URL is strictly non-production and allowed.

    Returns the sanitized target URL if safe; raises SecurityError otherwise.
    """
    if is_production_environment():
        raise SecurityError(
            "Load testing is forbidden: process environment is marked as PRODUCTION (ENVIRONMENT/VERCEL/NODE_ENV)."
        )

    if in_process:
        return "http://testserver"

    if not target_url or not isinstance(target_url, str):
        raise SecurityError("Target URL must be a non-empty string.")

    try:
        parts = urlsplit(target_url.strip())
    except Exception as exc:
        raise SecurityError(f"Malformed target URL '{target_url}': {exc}") from exc

    if parts.scheme not in ("http", "https"):
        raise SecurityError(f"Forbidden URL scheme '{parts.scheme}'. Only http and https are permitted.")

    hostname = (parts.hostname or "").lower().rstrip(".")
    if not hostname:
        raise SecurityError("Target URL does not contain a valid hostname.")

    # 1. Absolute Blacklist: Production patterns
    for pattern in FORBIDDEN_HOST_PATTERNS:
        if pattern.search(hostname):
            raise SecurityError(
                f"FATAL: Target host '{hostname}' matches forbidden production pattern. Load testing denied."
            )

    # 2. Check for Loopback (always allowed for local dev)
    if hostname in LOOPBACK_HOSTS:
        return sanitize_url(target_url).rstrip("/")

    # 3. Remote / Non-loopback Host Verification
    env_allowed = os.environ.get("LERNE_LOAD_TEST_ALLOWED_HOSTS", "")
    allowed_set = {h.strip().lower() for h in env_allowed.split(",") if h.strip()}
    if allowed_remote_hosts:
        allowed_set.update(h.strip().lower() for h in allowed_remote_hosts if h.strip())

    if hostname not in allowed_set:
        raise SecurityError(
            f"Remote target host '{hostname}' is not in the allowed test hosts list. "
            "To permit remote testing on an isolated staging server, add the host via "
            "--allow-remote-host or LERNE_LOAD_TEST_ALLOWED_HOSTS."
        )

    # 4. Mandatory affirmative isolation confirmation for remote hosts
    env_confirm = os.environ.get("LERNE_LOAD_TEST_CONFIRM_REMOTE_ISOLATION", "").strip().lower() in ("1", "true", "yes")
    if not confirm_isolated_remote and not env_confirm:
        raise SecurityError(
            f"Remote test host '{hostname}' requires explicit affirmative isolation confirmation. "
            "Pass --confirm-isolated-remote or set LERNE_LOAD_TEST_CONFIRM_REMOTE_ISOLATION=1."
        )

    return sanitize_url(target_url).rstrip("/")


def validate_database_safety(db=None) -> Dict[str, Any]:
    """Validates that the database connection is strictly an isolated local or test DB.

    Refuses to proceed if connected to production or unapproved database names/hosts.
    """
    if is_production_environment():
        raise SecurityError("Database access rejected: process is in PRODUCTION environment.")

    # Check SUPABASE_DB_URL if present
    supabase_url = os.environ.get("SUPABASE_DB_URL", "")
    if supabase_url:
        try:
            parsed = urlsplit(supabase_url)
            host = (parsed.hostname or "").lower()
            for pattern in FORBIDDEN_HOST_PATTERNS:
                if pattern.search(host):
                    raise SecurityError(
                        f"Database safety check failed: SUPABASE_DB_URL points to forbidden host '{host}'."
                    )
        except SecurityError:
            raise
        except Exception:
            pass

    if db is None:
        from api import models
        db = models.tma_db

    try:
        from peewee import Proxy
        if isinstance(db, Proxy) and getattr(db, "obj", None) is not None:
            db_obj = db.obj
        else:
            db_obj = db
    except Exception:
        db_obj = db

    if db_obj is None:
        raise SecurityError("Database proxy is uninitialized.")

    driver_name = getattr(db_obj, "_driver_name", getattr(type(db_obj), "__name__", "unknown"))

    # 1. SQLite: must be in-memory or in local/test-data
    if "sqlite" in driver_name.lower():
        db_path = getattr(db_obj, "database", "")
        if db_path not in (":memory:", ""):
            path_str = str(db_path).replace("\\", "/").lower()
            if "test-data" not in path_str and "test" not in path_str and "local" not in path_str:
                raise SecurityError(
                    f"SQLite database path '{db_path}' must reside in local/test-data or test directory."
                )
        return {"driver": "sqlite", "database": str(db_path), "host": "local"}

    # 2. PostgreSQL: check host and actual database name via SQL
    if "postgres" in driver_name.lower():
        connect_params = getattr(db_obj, "connect_params", {})
        host = (connect_params.get("host") or getattr(db_obj, "host", "") or "").lower()

        # Check host safety
        env_allowed = os.environ.get("LERNE_LOAD_TEST_ALLOWED_HOSTS", "")
        allowed_hosts = LOOPBACK_HOSTS | {h.strip().lower() for h in env_allowed.split(",") if h.strip()}

        for pattern in FORBIDDEN_HOST_PATTERNS:
            if pattern.search(host):
                raise SecurityError(f"PostgreSQL host '{host}' matches forbidden production pattern.")

        if host not in allowed_hosts and not os.environ.get("LERNE_LOAD_TEST_ALLOW_REMOTE"):
            raise SecurityError(f"PostgreSQL host '{host}' is neither loopback nor an allowed test host.")

        # Determine actual database name by querying the database engine directly
        actual_db_name = None
        try:
            with db_obj.connection_context():
                cursor = db_obj.execute_sql("SELECT current_database()")
                row = cursor.fetchone()
                if row:
                    actual_db_name = row[0]
        except Exception as exc:
            raise SecurityError(f"Could not verify database identity via current_database(): {exc}") from exc

        if not actual_db_name:
            raise SecurityError("current_database() returned empty result.")

        # Match actual database name against approved test patterns
        matched = any(pat.match(actual_db_name) for pat in APPROVED_TEST_DB_PATTERNS)
        if not matched:
            raise SecurityError(
                f"FATAL: Connected database '{actual_db_name}' is NOT an approved test database. "
                "Permitted database names must match: lerne_tma_local, *test*, *local*, *loadtest*, *perf*."
            )

        return {"driver": "postgresql", "database": actual_db_name, "host": host}

    # Unknown driver
    raise SecurityError(f"Unrecognized database driver '{driver_name}' for load testing.")
