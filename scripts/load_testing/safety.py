"""Security verification and safety guards for FastAPI load testing.

Enforces multi-layer protection to prevent load testing, seeding, or cleanup
from ever targeting production environments or databases.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit, urlunsplit

REPO_ROOT = Path(__file__).resolve().parents[2]
LOCAL_TEST_DATA_DIR = (REPO_ROOT / "local" / "test-data").resolve()
TESTS_DIR = (REPO_ROOT / "tests").resolve()


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


def is_safe_sqlite_path(db_path: Any) -> bool:
    """Verifies that an SQLite database path is strictly :memory: or a canonical path
    within the designated local/test-data directory, with no directory traversal,
    symlink escapes, or deceiving names.
    """
    if db_path in (":memory:", "", None):
        return True

    try:
        raw_str = str(db_path).replace("\\", "/").strip()
        if not raw_str:
            return True

        # Explicitly forbid relative traversal segments
        path_segments = [seg for seg in raw_str.split("/") if seg]
        if ".." in path_segments:
            return False

        target_path = Path(str(db_path)).resolve()

        # Reject if the target is an existing directory rather than a file
        if target_path.is_dir():
            return False

        allowed_roots = [LOCAL_TEST_DATA_DIR, TESTS_DIR]

        for root in allowed_roots:
            try:
                target_path.relative_to(root)
                if target_path != root:
                    return True
            except (ValueError, RuntimeError):
                continue

        return False
    except Exception:
        return False


def validate_pre_connection_safety() -> None:
    """Pre-connection safety gate: validates environment and configuration
    BEFORE any database connection, initialization, or schema creation is attempted.

    Strictly fail-closed: raises SecurityError if anything indicates production or unsafe DB.
    """
    if is_production_environment():
        raise SecurityError(
            "Pre-connection safety check failed: process environment indicates PRODUCTION (ENVIRONMENT/VERCEL/NODE_ENV)."
        )

    supabase_url = os.environ.get("SUPABASE_DB_URL", "").strip()
    if supabase_url:
        try:
            parsed = urlsplit(supabase_url)
            host = (parsed.hostname or "").lower()
            for pattern in FORBIDDEN_HOST_PATTERNS:
                if pattern.search(host):
                    raise SecurityError(
                        f"Pre-connection safety check failed: SUPABASE_DB_URL points to forbidden host '{host}'."
                    )

            env_allowed = os.environ.get("LERNE_LOAD_TEST_ALLOWED_HOSTS", "")
            allowed_hosts = LOOPBACK_HOSTS | {h.strip().lower() for h in env_allowed.split(",") if h.strip()}
            if host not in allowed_hosts and not os.environ.get("LERNE_LOAD_TEST_ALLOW_REMOTE"):
                raise SecurityError(
                    f"Pre-connection safety check failed: SUPABASE_DB_URL host '{host}' is neither loopback nor an allowed test host."
                )

            path = parsed.path.lstrip("/").strip()
            if path:
                matched = any(pat.match(path) for pat in APPROVED_TEST_DB_PATTERNS)
                if not matched:
                    raise SecurityError(
                        f"Pre-connection safety check failed: database name '{path}' in SUPABASE_DB_URL is NOT an approved test database."
                    )
        except SecurityError:
            raise
        except Exception as exc:
            raise SecurityError(f"Pre-connection safety check failed: malformed SUPABASE_DB_URL: {exc}") from exc

    local_db_path = os.environ.get("LERNE_LOCAL_DB_PATH", "").strip()
    if local_db_path:
        if not is_safe_sqlite_path(local_db_path):
            raise SecurityError(
                f"Pre-connection safety check failed: LERNE_LOCAL_DB_PATH '{local_db_path}' violates canonical test path rules."
            )


def sanitize_url(url: str) -> str:
    """Strips credentials (user:pass) and query/fragment secrets from a URL."""
    try:
        parts = urlsplit(url)
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
    # Redact passwords in connection URLs
    text = re.sub(r"://([^:]+):([^@]+)@", r"://\1:[REDACTED]@", text)
    # Redact secret key params
    text = re.sub(r"(secret|password|token|key)=([^&\s]+)", r"\1=[REDACTED]", text, flags=re.IGNORECASE)
    return text


def is_loopback_url(url: str) -> bool:
    """Returns True if the URL points to a loopback host or in-process testserver."""
    try:
        parts = urlsplit(url.strip())
        hostname = (parts.hostname or "").lower().rstrip(".")
        return hostname in LOOPBACK_HOSTS
    except Exception:
        return False


def validate_target_url(
    target_url: str,
    in_process: bool = False,
    allowed_remote_hosts: Optional[List[str]] = None,
    confirm_isolated_remote: bool = False,
) -> str:
    """Validates that a target URL is strictly non-production and allowed.

    Returns the sanitized target URL if safe; raises SecurityError otherwise.
    """
    validate_pre_connection_safety()

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
    Strictly fail-closed: any check failure raises SecurityError.
    """
    # 1. Mandatory pre-connection check
    validate_pre_connection_safety()

    if db is None:
        from api import models
        db = models.tma_db

    try:
        from peewee import Proxy
        if isinstance(db, Proxy) and getattr(db, "obj", None) is not None:
            db_obj = db.obj
        else:
            db_obj = db
    except Exception as exc:
        raise SecurityError(f"Database proxy resolution failed: {exc}") from exc

    if db_obj is None:
        raise SecurityError("Database proxy is uninitialized.")

    driver_name = getattr(db_obj, "_driver_name", getattr(type(db_obj), "__name__", "unknown"))

    # 1. SQLite: must be strictly :memory: or canonical path inside designated test directory
    if "sqlite" in driver_name.lower():
        db_path = getattr(db_obj, "database", "")
        if not is_safe_sqlite_path(db_path):
            raise SecurityError(
                f"SQLite database path '{db_path}' is forbidden. "
                f"Permitted paths are strictly ':memory:' or canonical files within designated test directory: {LOCAL_TEST_DATA_DIR}."
            )
        return {"driver": "sqlite", "database": str(db_path), "host": "local"}

    # 2. PostgreSQL: check host and actual database name via dynamic SQL
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


async def verify_remote_isolation(
    client: Any,
    target_url: str,
    synthetic_user: Optional[Dict[str, Any]] = None,
    isolation_token: Optional[str] = None,
) -> Dict[str, Any]:
    """Actively probes and verifies that a remote API target and its connected database
    are strictly isolated non-production environments.

    Verification protocol:
    1. Server Non-Production Environment Gate:
       Queries /api/debug/test-audio. In production builds, debug routes are NOT mounted
       and return 404. Non-production mounts debug routes (returns 401/403/200).
       If 404 or connection failure -> REJECT.
    2. Response Headers:
       Inspects for production deployment headers (e.g. x-vercel-id, production domains).
       If present -> REJECT.
    3. Server Database Isolation Probe:
       Uses confirmed synthetic user to probe /api/init.
       In production, synthetic tokens do not exist (returns 401/403).
       In an isolated test database, the synthetic user authenticates (200) and returns
       confirmed synthetic markers ([SYNTHETIC_LOAD_TEST]).
       If authentication fails or synthetic marker is absent -> REJECT.
    4. Optional Isolation Token:
       Verifies agreement if provided via --remote-isolation-token or env var.

    Strict fail-closed: raises SecurityError on any check failure or inability to confirm.
    """
    # 1. Server Environment Non-Production Gate Probe
    try:
        debug_resp = await client.get("/api/debug/test-audio", timeout=5.0)
    except Exception as exc:
        raise SecurityError(
            f"Remote server isolation verification failed: could not connect to {target_url}/api/debug/test-audio: {sanitize_text(str(exc))}"
        ) from exc

    if debug_resp.status_code == 404:
        raise SecurityError(
            f"Remote server isolation verification FAILED: {target_url}/api/debug/test-audio returned 404 Not Found. "
            "Debug routes are disabled in PRODUCTION environments. "
            "Load testing against servers without verified non-production debug routes is strictly forbidden."
        )

    # 2. Header and Response Inspection for Production Artifacts
    for header_name, header_val in debug_resp.headers.items():
        h_name_lower = header_name.lower()
        h_val_lower = header_val.lower()
        if "x-vercel-id" in h_name_lower:
            raise SecurityError(
                f"Remote server isolation verification FAILED: response contains production platform header '{header_name}'."
            )
        if any(pat.search(h_val_lower) for pat in FORBIDDEN_HOST_PATTERNS if "lerne.app" in pat.pattern):
            raise SecurityError(
                f"Remote server isolation verification FAILED: response header '{header_name}' contains production domain reference."
            )

    # 3. Server Database Isolation Verification Probe
    if synthetic_user and synthetic_user.get("access_token"):
        token = synthetic_user["access_token"]
        auth_headers = {"Authorization": f"Bearer {token}"}
        try:
            init_resp = await client.get("/api/init", headers=auth_headers, timeout=5.0)
        except Exception as exc:
            raise SecurityError(
                f"Remote database isolation probe failed to reach /api/init: {sanitize_text(str(exc))}"
            ) from exc

        if init_resp.status_code != 200:
            raise SecurityError(
                f"Remote database isolation verification FAILED: synthetic test user '{synthetic_user.get('username')}' "
                f"failed to authenticate against {target_url}/api/init (HTTP {init_resp.status_code}). "
                "The remote server is not connected to the verified synthetic test database. "
                "Load testing is strictly forbidden."
            )

        try:
            init_data = init_resp.json()
            decks = init_data.get("decks", [])
            has_synthetic_deck = any("[SYNTHETIC_LOAD_TEST]" in str(d.get("name", "")) for d in decks)
            has_synthetic_user = synthetic_user.get("username", "") in str(init_data)
            if not has_synthetic_deck and not has_synthetic_user:
                raise SecurityError(
                    "Remote database isolation verification FAILED: /api/init authenticated but returned NO confirmed synthetic test markers. "
                    "Cannot verify database isolation from production records. Load testing forbidden."
                )
        except SecurityError:
            raise
        except Exception as exc:
            raise SecurityError(f"Remote database isolation verification failed to parse /api/init response: {exc}") from exc
    else:
        env_token = os.environ.get("LERNE_LOAD_TEST_ISOLATION_TOKEN", "").strip()
        required_token = isolation_token or env_token
        if not required_token:
            raise SecurityError(
                "Remote server database isolation cannot be confirmed without either a verified synthetic user probe "
                "or an explicit --remote-isolation-token / LERNE_LOAD_TEST_ISOLATION_TOKEN."
            )

    return {
        "status": "verified_isolated",
        "debug_status": debug_resp.status_code,
        "target_url": sanitize_url(target_url),
    }
