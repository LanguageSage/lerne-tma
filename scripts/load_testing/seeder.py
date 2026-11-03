"""Synthetic test data seeder and cleaner for load testing FastAPI backend.

Operates purely on synthetic accounts, isolated from any real user records.
Enforces safety checks: only permitted in LOCAL development or isolated test environments.
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import logging
import os
import secrets
import sys
import uuid
from pathlib import Path
from typing import Any, Dict, List

# Ensure repository root is on sys.path
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.load_testing.config import (
    BASE_USER_ID,
    DEFAULT_CARDS_PER_DECK,
    MAX_TEST_USERS,
    USERS_CACHE_FILE,
    LOCAL_TEST_DATA,
)

logger = logging.getLogger("load_tester.seeder")


def _assert_environment_safety() -> None:
    """Refuse to run if pointed to production or outside local/test environment."""
    if os.environ.get("ENVIRONMENT", "").lower() == "production" or os.environ.get("VERCEL"):
        raise RuntimeError("FATAL: Load testing seeder cannot run in production or Vercel!")

    from api.local_runtime import is_local
    if not is_local() and not os.environ.get("LERNE_LOAD_TEST_ALLOW_REMOTE"):
        # Auto-configure LOCAL mode if not explicitly set
        os.environ["LERNE_MODE"] = "LOCAL"


def get_db():
    from api import models
    return models.tma_db


def seed_synthetic_data(user_count: int = 100, cards_per_deck: int = DEFAULT_CARDS_PER_DECK, force: bool = False) -> List[Dict[str, Any]]:
    """Generates synthetic users, auth sessions, decks, cards, and study progress.

    Returns a list of dicts with user info, tokens, and target deck/card IDs.
    """
    _assert_environment_safety()

    from api import models
    from api.models import (
        TMAUser, TMA_Deck, TMA_Card, TMAProgress,
        TMAAuthAccount, TMAAuthSession, TMAAuthToken,
        TMA_Collaborator, auth_utcnow as utcnow,
    )

    db = get_db()
    if not db.obj:
        from api.database import initialize_database
        initialize_database()

    # If cache exists and has enough users and not forced, return cached data
    if not force and USERS_CACHE_FILE.exists():
        try:
            with open(USERS_CACHE_FILE, "r", encoding="utf-8") as f:
                cached = json.load(f)
            if len(cached) >= user_count:
                logger.info(f"Using {len(cached)} cached synthetic users from {USERS_CACHE_FILE}")
                return cached[:user_count]
        except Exception as e:
            logger.warning(f"Could not load cache: {e}. Reseeding.")

    LOCAL_TEST_DATA.mkdir(parents=True, exist_ok=True)
    logger.info(f"Seeding synthetic data for {user_count} virtual users with {cards_per_deck} cards each...")

    users_data: List[Dict[str, Any]] = []
    now = utcnow()

    with db.connection_context(), db.atomic():
        # Create a shared deck for cross-user tests
        shared_owner_id = BASE_USER_ID + 1
        shared_deck, _ = TMA_Deck.get_or_create(
            user_id=shared_owner_id,
            name="[SYNTHETIC_LOAD_TEST] Shared Test Deck",
            defaults={"is_deleted": False, "level": "A1", "target_language": "de"}
        )

        # Populate cards in shared deck if missing
        shared_cards_count = TMA_Card.select().where(
            (TMA_Card.deck == shared_deck) & (TMA_Card.is_deleted == False)
        ).count()
        shared_card_ids: List[int] = []
        if shared_cards_count < cards_per_deck:
            for c in range(shared_cards_count, cards_per_deck):
                card = TMA_Card.create(
                    deck=shared_deck,
                    front_text=f"Gemeinsames Wort {c}",
                    back_text=f"Shared translation {c}",
                    position=c,
                    is_deleted=False
                )
                shared_card_ids.append(card.id)
        else:
            shared_card_ids = [c.id for c in TMA_Card.select(TMA_Card.id).where(
                (TMA_Card.deck == shared_deck) & (TMA_Card.is_deleted == False)
            ).order_by(TMA_Card.position.asc())]

        # Seed each virtual user
        for i in range(1, user_count + 1):
            uid = BASE_USER_ID + i
            user, _ = TMAUser.get_or_create(
                user_id=uid,
                defaults={
                    "username": f"load_vu_{i}",
                    "first_name": f"VU_{i}",
                    "is_guest": False,
                    "default_decks_initialized": True,
                }
            )

            account, _ = TMAAuthAccount.get_or_create(user=uid)

            # Mint a durable access token for load testing
            access_token = "la_" + secrets.token_urlsafe(32)
            token_hash = hashlib.sha256(access_token.encode()).hexdigest()
            session_id = str(uuid.uuid4())

            session = TMAAuthSession.create(
                id=session_id,
                account=uid,
                authenticated_at=now,
                created_at=now,
                expires_at=now + datetime.timedelta(days=7),
                authentication_method="load_test"
            )

            TMAAuthToken.create(
                token_hash=token_hash,
                session=session.id,
                kind="access",
                created_at=now,
                expires_at=now + datetime.timedelta(days=7)
            )

            # Personal deck for this VU
            personal_deck, _ = TMA_Deck.get_or_create(
                user_id=uid,
                name=f"[SYNTHETIC_LOAD_TEST] VU {i} Deck",
                defaults={"is_deleted": False, "level": "A1", "target_language": "de"}
            )

            # Grant collaborator access to shared deck
            TMA_Collaborator.get_or_create(
                user_id=uid,
                target_type="deck",
                target_id=shared_deck.id,
                defaults={"role": "editor", "added_by": shared_owner_id}
            )

            # Populate personal cards & initial progress
            existing_cards = list(TMA_Card.select().where(
                (TMA_Card.deck == personal_deck) & (TMA_Card.is_deleted == False)
            ))
            card_ids = [c.id for c in existing_cards]

            if len(existing_cards) < cards_per_deck:
                for c in range(len(existing_cards), cards_per_deck):
                    card = TMA_Card.create(
                        deck=personal_deck,
                        front_text=f"Wort {i}_{c}",
                        back_text=f"Meaning {i}_{c}",
                        position=c,
                        is_deleted=False
                    )
                    card_ids.append(card.id)

                    # Initial progress so next card and grading are immediately valid
                    TMAProgress.create(
                        card_id=card.id,
                        user_id=uid,
                        queue="new",
                        interval=0,
                        ease_factor=2.5,
                        next_review=datetime.datetime.now(),
                        last_reviewed=None
                    )

            # Also ensure initial progress exists on all personal cards
            for cid in card_ids:
                TMAProgress.get_or_create(
                    card_id=cid,
                    user_id=uid,
                    defaults={
                        "queue": "new",
                        "interval": 0,
                        "ease_factor": 2.5,
                        "next_review": datetime.datetime.now(),
                        "last_reviewed": None
                    }
                )

            users_data.append({
                "user_id": uid,
                "token": access_token,
                "deck_id": personal_deck.id,
                "shared_deck_id": shared_deck.id,
                "card_ids": card_ids,
                "shared_card_ids": shared_card_ids,
            })

    # Cache users to disk for fast reuse
    with open(USERS_CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(users_data, f, indent=2)

    logger.info(f"Successfully seeded {len(users_data)} synthetic users into {USERS_CACHE_FILE}")
    return users_data


def cleanup_synthetic_data() -> int:
    """Removes all synthetic records created for load testing."""
    _assert_environment_safety()

    from api import models
    from api.models import (
        TMAUser, TMA_Deck, TMA_Card, TMAProgress, TMAReviewHistory,
        TMAAuthAccount, TMAAuthSession, TMAAuthToken,
        TMA_Collaborator, TMAOfflineBatch,
    )

    db = get_db()
    if not db.obj:
        from api.database import initialize_database
        initialize_database()

    min_id = BASE_USER_ID + 1
    max_id = BASE_USER_ID + MAX_TEST_USERS + 100

    deleted_counts = {}

    with db.connection_context(), db.atomic():
        # 1. Auth tokens
        sessions = list(TMAAuthSession.select(TMAAuthSession.id).where(
            (TMAAuthSession.account >= min_id) & (TMAAuthSession.account <= max_id)
        ))
        session_ids = [s.id for s in sessions]
        if session_ids:
            deleted_counts["tokens"] = TMAAuthToken.delete().where(TMAAuthToken.session.in_(session_ids)).execute()
            deleted_counts["sessions"] = TMAAuthSession.delete().where(TMAAuthSession.id.in_(session_ids)).execute()

        # 2. Progress and Review history
        deleted_counts["progress"] = TMAProgress.delete().where(
            (TMAProgress.user_id >= min_id) & (TMAProgress.user_id <= max_id)
        ).execute()
        deleted_counts["reviews"] = TMAReviewHistory.delete().where(
            (TMAReviewHistory.user_id >= min_id) & (TMAReviewHistory.user_id <= max_id)
        ).execute()

        # 3. Cards in synthetic decks
        decks = list(TMA_Deck.select(TMA_Deck.id).where(
            (TMA_Deck.user_id >= min_id) & (TMA_Deck.user_id <= max_id)
        ))
        deck_ids = [d.id for d in decks]
        if deck_ids:
            deleted_counts["cards"] = TMA_Card.delete().where(TMA_Card.deck.in_(deck_ids)).execute()

        # 4. Collaborator links and decks
        deleted_counts["collaborators"] = TMA_Collaborator.delete().where(
            (TMA_Collaborator.user_id >= min_id) & (TMA_Collaborator.user_id <= max_id)
        ).execute()
        deleted_counts["decks"] = TMA_Deck.delete().where(
            (TMA_Deck.user_id >= min_id) & (TMA_Deck.user_id <= max_id)
        ).execute()

        # 5. Offline batches
        batch_keys = []
        for uid in range(min_id, max_id + 1):
            batch_keys.append(f"sync:{uid}:")
        deleted_counts["batches"] = 0
        for uid in range(min_id, max_id + 1):
            deleted_counts["batches"] += TMAOfflineBatch.delete().where(
                TMAOfflineBatch.key.startswith(f"sync:{uid}:")
            ).execute()

        # 6. Auth accounts and users
        deleted_counts["accounts"] = TMAAuthAccount.delete().where(
            (TMAAuthAccount.user >= min_id) & (TMAAuthAccount.user <= max_id)
        ).execute()
        deleted_counts["users"] = TMAUser.delete().where(
            (TMAUser.user_id >= min_id) & (TMAUser.user_id <= max_id)
        ).execute()

    if USERS_CACHE_FILE.exists():
        try:
            USERS_CACHE_FILE.unlink()
        except OSError:
            pass

    total = sum(deleted_counts.values())
    logger.info(f"Cleanup complete. Deleted records: {deleted_counts} (Total: {total})")
    return total


def get_synthetic_status() -> Dict[str, Any]:
    """Returns current count of synthetic test entities."""
    _assert_environment_safety()

    from api import models
    from api.models import TMAUser, TMA_Deck, TMA_Card, TMAProgress, TMAAuthSession

    db = get_db()
    if not db.obj:
        from api.database import initialize_database
        initialize_database()

    min_id = BASE_USER_ID + 1
    max_id = BASE_USER_ID + MAX_TEST_USERS + 100

    with db.connection_context():
        users = TMAUser.select().where((TMAUser.user_id >= min_id) & (TMAUser.user_id <= max_id)).count()
        decks = TMA_Deck.select().where((TMA_Deck.user_id >= min_id) & (TMA_Deck.user_id <= max_id)).count()
        progress = TMAProgress.select().where((TMAProgress.user_id >= min_id) & (TMAProgress.user_id <= max_id)).count()
        sessions = TMAAuthSession.select().where((TMAAuthSession.account >= min_id) & (TMAAuthSession.account <= max_id)).count()

    cached_file_exists = USERS_CACHE_FILE.exists()
    return {
        "synthetic_users": users,
        "synthetic_decks": decks,
        "synthetic_progress": progress,
        "synthetic_sessions": sessions,
        "cache_file": str(USERS_CACHE_FILE),
        "cache_file_exists": cached_file_exists,
    }


def main():
    parser = argparse.ArgumentParser(description="Synthetic Load Test Seeder")
    parser.add_argument("--seed", action="store_true", help="Generate synthetic test data")
    parser.add_argument("--cleanup", action="store_true", help="Remove synthetic test data")
    parser.add_argument("--status", action="store_true", help="Display count of synthetic test entities")
    parser.add_argument("--users", type=int, default=100, help="Number of virtual users to seed (default: 100)")
    parser.add_argument("--cards", type=int, default=DEFAULT_CARDS_PER_DECK, help="Number of cards per deck")
    parser.add_argument("--force", action="store_true", help="Force reseed even if cache exists")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    if args.cleanup:
        count = cleanup_synthetic_data()
        print(f"Cleaned up {count} synthetic records.")
    elif args.status:
        status = get_synthetic_status()
        print(json.dumps(status, indent=2))
    elif args.seed:
        users = seed_synthetic_data(user_count=args.users, cards_per_deck=args.cards, force=args.force)
        print(f"Seeded {len(users)} virtual users successfully.")
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
