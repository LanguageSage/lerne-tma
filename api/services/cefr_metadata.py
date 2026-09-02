"""Helpers for storing CEFR classification details in card metadata."""

from __future__ import annotations

import datetime
import json
from typing import Any, Dict, Optional


VALID_CEFR_LEVELS = {"A1", "A2", "B1", "B2", "C1", "C2"}
LOCAL_CLASSIFIER_VERSION = "de-local-rules-v1"


def parse_card_metadata(raw_metadata: Any) -> Dict[str, Any]:
    if isinstance(raw_metadata, dict):
        return dict(raw_metadata)
    if not raw_metadata:
        return {}
    if isinstance(raw_metadata, str):
        try:
            parsed = json.loads(raw_metadata)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def serialize_card_metadata(metadata: Dict[str, Any]) -> str:
    return json.dumps(metadata or {}, ensure_ascii=False)


def get_cefr_metadata(raw_metadata: Any) -> Optional[Dict[str, Any]]:
    metadata = parse_card_metadata(raw_metadata)
    cefr = metadata.get("cefr")
    return cefr if isinstance(cefr, dict) else None


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()


def _normalize_level(level: Any) -> Optional[str]:
    if not level:
        return None
    value = str(level).upper().strip()
    return value if value in VALID_CEFR_LEVELS else None


def _normalize_confidence(confidence: Any) -> Optional[float]:
    try:
        value = float(confidence)
    except (TypeError, ValueError):
        return None
    return max(0.0, min(1.0, round(value, 3)))


def normalize_cefr_payload(payload: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    payload = payload or {}
    normalized: Dict[str, Any] = {
        "level": _normalize_level(payload.get("level")),
        "source": str(payload.get("source") or "unknown").strip() or "unknown",
        "classified_at": payload.get("classified_at") or _now_iso(),
    }

    confidence = _normalize_confidence(payload.get("confidence"))
    if confidence is not None:
        normalized["confidence"] = confidence

    for key in ("reason", "reason_short", "classifier_version"):
        value = payload.get(key)
        if value is not None and str(value).strip():
            normalized[key] = str(value).strip()

    for key in ("grammar_features", "vocabulary_features"):
        value = payload.get(key)
        if isinstance(value, list):
            normalized[key] = value

    return normalized


def merge_cefr_metadata(raw_metadata: Any, payload: Optional[Dict[str, Any]]) -> str:
    metadata = parse_card_metadata(raw_metadata)
    metadata["cefr"] = normalize_cefr_payload(payload)
    return serialize_card_metadata(metadata)


def build_local_cefr_payload(local_result: Dict[str, Any], source: str = "local") -> Dict[str, Any]:
    return normalize_cefr_payload({
        "level": local_result.get("level"),
        "source": source,
        "confidence": local_result.get("confidence"),
        "reason": local_result.get("reason"),
        "reason_short": local_result.get("reason_short"),
        "grammar_features": local_result.get("grammar_features"),
        "vocabulary_features": local_result.get("vocabulary_features"),
        "classifier_version": LOCAL_CLASSIFIER_VERSION,
    })


def build_manual_cefr_payload(level: Any) -> Dict[str, Any]:
    return normalize_cefr_payload({
        "level": level,
        "source": "manual",
        "confidence": 1.0,
        "reason": "Установлен вручную пользователем",
        "reason_short": "вручную",
    })


def build_ai_cefr_payload(level: Any, reason: Optional[str] = None, source: str = "ai") -> Dict[str, Any]:
    return normalize_cefr_payload({
        "level": level,
        "source": source,
        "confidence": 1.0 if _normalize_level(level) else 0.0,
        "reason": reason or "Уровень определён AI-классификатором",
        "reason_short": source,
    })


def build_cleared_cefr_payload(local_result: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    local_result = local_result or {}
    return normalize_cefr_payload({
        "level": None,
        "source": "cleared",
        "confidence": local_result.get("confidence"),
        "reason": local_result.get("reason") or "CEFR очищен: локальный классификатор не уверен",
        "reason_short": "не уверенно",
        "classifier_version": LOCAL_CLASSIFIER_VERSION,
    })
