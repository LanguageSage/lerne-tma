"""Shared SHA-256 canonical digest and TMAOfflineBatch idempotency receipts.

Uses the exact canonical JSON serialization (`sort_keys=True, ensure_ascii=False,
separators=(',', ':')`) shared by `cards-v2:*`, `text-update:*`,
`folder-text-update:*`, `author-document-update:*`, and `ai:*` receipts.
`offline_sync.py` and `study.py` intentionally retain their historical JSON
serialization to preserve existing `TMAOfflineBatch` receipts and avoid false 409s.
"""
import hashlib
import json

from fastapi import HTTPException

from api.models import TMAOfflineBatch


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(',', ':')).encode('utf-8')).hexdigest()


def batch_digest(value):
    """Historical JSON digest used by offline_sync and study grade receipts."""
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode('utf-8')).hexdigest()


def _claim_receipt(key, payload_hash, conflict_detail=None):
    inserted = list(TMAOfflineBatch.insert(key=key, payload_hash=payload_hash, response='')
                    .on_conflict_ignore().returning(TMAOfflineBatch.key).execute())
    receipt = TMAOfflineBatch.get_by_id(key)
    if not inserted:
        if receipt.payload_hash != payload_hash:
            raise HTTPException(409, conflict_detail or {'code': 'request_changed'})
        return receipt, json.loads(receipt.response)
    return receipt, None


def finish_receipt(receipt, result):
    receipt.response = json.dumps(result, ensure_ascii=False)
    receipt.save(only=[type(receipt).response])
    return result
