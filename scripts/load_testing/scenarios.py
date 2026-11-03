"""Scenario definitions for virtual users: study, read, sync, and mixed."""
from __future__ import annotations

import datetime
import random
import time
import uuid
from typing import Any, Dict, List, Optional
import httpx

from scripts.load_testing.metrics import RequestSample, StageMetrics


class BaseScenario:
    def __init__(self, user_info: Dict[str, Any], metrics: StageMetrics, think_time: float = 0.0):
        self.user_info = user_info
        self.user_id: int = user_info["user_id"]
        self.token: str = user_info["token"]
        self.deck_id: int = user_info["deck_id"]
        self.card_ids: List[int] = user_info.get("card_ids", [])
        self.metrics = metrics
        self.think_time = think_time

    def headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
            "User-Agent": f"LerneLoadTester/1.0 (VU {self.user_id})",
        }

    async def _send(
        self, client: httpx.AsyncClient, method: str, path: str, endpoint_label: str,
        scenario_name: str, **kwargs
    ) -> Optional[httpx.Response]:
        url = path
        start = time.perf_counter()
        status_code = 0
        error_msg = None
        response = None

        self.metrics.record_connection_start()
        try:
            response = await client.request(method, url, headers=self.headers(), **kwargs)
            status_code = response.status_code
            if status_code >= 400:
                error_msg = f"HTTP_{status_code}"
        except httpx.ConnectTimeout:
            error_msg = "ConnectTimeout"
        except httpx.ReadTimeout:
            error_msg = "ReadTimeout"
        except httpx.PoolTimeout:
            error_msg = "PoolTimeout"
        except httpx.ConnectError as exc:
            error_msg = f"ConnectError({type(exc).__name__})"
        except httpx.RemoteProtocolError:
            error_msg = "RemoteProtocolError"
        except Exception as exc:
            error_msg = f"{type(exc).__name__}: {str(exc)[:50]}"
        finally:
            duration_ms = (time.perf_counter() - start) * 1000.0
            self.metrics.record_connection_end()
            self.metrics.record(RequestSample(
                endpoint=endpoint_label,
                scenario=scenario_name,
                status_code=status_code,
                duration_ms=round(duration_ms, 2),
                error=error_msg,
            ))

        if self.think_time > 0:
            import asyncio
            await asyncio.sleep(self.think_time)

        return response


class StudyScenario(BaseScenario):
    """Executes study workflows: GET /decks/{id}/next and POST /study/grade."""

    async def run_step(self, client: httpx.AsyncClient):
        scenario_name = "study"

        # 1. GET next card
        next_resp = await self._send(
            client,
            "GET",
            f"/api/decks/{self.deck_id}/next?review_context=scheduled",
            endpoint_label="GET /decks/{id}/next",
            scenario_name=scenario_name,
        )

        card_id = None
        if next_resp and next_resp.status_code == 200:
            try:
                data = next_resp.json()
                if isinstance(data, dict):
                    card_id = data.get("id") or data.get("card_id")
            except Exception:
                pass

        # Fallback to known card from synthetic deck if deck finished or queue empty
        if not card_id and self.card_ids:
            card_id = random.choice(self.card_ids)

        if not card_id:
            return

        # 2. POST grade
        grade_payload = {
            "card_id": card_id,
            "deck_id": self.deck_id,
            "grade": random.choice([0, 1, 2, 3]),
            "is_extended": False,
            "learn_more": False,
            "review_context": "scheduled",
            "exclude_ids": [],
            "return_next": True,
        }

        await self._send(
            client,
            "POST",
            "/api/study/grade",
            endpoint_label="POST /study/grade",
            scenario_name=scenario_name,
            json=grade_payload,
        )


class ReadCardsScenario(BaseScenario):
    """Executes card reading workflows: GET /decks/{id}/cards and GET /study/card/{id}."""

    async def run_step(self, client: httpx.AsyncClient):
        scenario_name = "read"

        # 1. Read deck cards list
        cards_resp = await self._send(
            client,
            "GET",
            f"/api/decks/{self.deck_id}/cards",
            endpoint_label="GET /decks/{id}/cards",
            scenario_name=scenario_name,
        )

        card_id = None
        if cards_resp and cards_resp.status_code == 200:
            try:
                cards = cards_resp.json()
                if isinstance(cards, list) and cards:
                    card_id = random.choice(cards).get("id")
            except Exception:
                pass

        if not card_id and self.card_ids:
            card_id = random.choice(self.card_ids)

        if not card_id:
            return

        # 2. Read single card study view
        await self._send(
            client,
            "GET",
            f"/api/study/card/{card_id}",
            endpoint_label="GET /study/card/{id}",
            scenario_name=scenario_name,
        )


class SyncScenario(BaseScenario):
    """Executes offline sync workflows: GET /sync/v2/pull and POST /sync/v2/push."""

    async def run_step(self, client: httpx.AsyncClient):
        scenario_name = "sync"

        # 1. GET pull offline changes
        await self._send(
            client,
            "GET",
            "/api/sync/v2/pull",
            endpoint_label="GET /sync/v2/pull",
            scenario_name=scenario_name,
        )

        # 2. POST push offline changes
        card_id = random.choice(self.card_ids) if self.card_ids else 1
        now_iso = datetime.datetime.now().isoformat()
        push_payload = {
            "request_id": str(uuid.uuid4()),
            "folders": [],
            "decks": [],
            "cards": [],
            "progress": [
                {
                    "card_id": card_id,
                    "queue": "review",
                    "interval": 1,
                    "ease_factor": 2.5,
                    "repetitions": 1,
                    "lapses": 0,
                    "step_index": 0,
                    "next_review": now_iso,
                    "last_reviewed": now_iso,
                    "flag": 0,
                    "want_to_learn": False,
                }
            ],
            "reviews": [
                {
                    "card_id": card_id,
                    "rating": 2,
                    "is_extended": False,
                    "review_context": "scheduled",
                    "review_time": now_iso,
                    "scheduled_interval": 1,
                }
            ],
        }

        await self._send(
            client,
            "POST",
            "/api/sync/v2/push",
            endpoint_label="POST /sync/v2/push",
            scenario_name=scenario_name,
            json=push_payload,
        )


class MixedScenario(BaseScenario):
    """Mixes study (50%), read (35%), and sync (15%) to simulate realistic user usage."""

    def __init__(self, user_info: Dict[str, Any], metrics: StageMetrics, think_time: float = 0.0):
        super().__init__(user_info, metrics, think_time)
        self.study = StudyScenario(user_info, metrics, think_time)
        self.read = ReadCardsScenario(user_info, metrics, think_time)
        self.sync = SyncScenario(user_info, metrics, think_time)

    async def run_step(self, client: httpx.AsyncClient):
        roll = random.random()
        if roll < 0.50:
            await self.study.run_step(client)
        elif roll < 0.85:
            await self.read.run_step(client)
        else:
            await self.sync.run_step(client)


def create_scenario(name: str, user_info: Dict[str, Any], metrics: StageMetrics, think_time: float = 0.0) -> BaseScenario:
    scenarios = {
        "study": StudyScenario,
        "read": ReadCardsScenario,
        "sync": SyncScenario,
        "mixed": MixedScenario,
    }
    cls = scenarios.get(name.lower())
    if not cls:
        raise ValueError(f"Unknown scenario '{name}'. Supported: {list(scenarios.keys())}")
    return cls(user_info, metrics, think_time)
