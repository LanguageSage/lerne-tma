import os
import datetime
import logging
import json
from ..models import TMA_Deck, TMA_Card, TMAProgress, TMAReviewHistory, Deck, Card, tma_db, TMAMedia
from .. import srs
from peewee import fn, JOIN
from functools import lru_cache

logger = logging.getLogger(__name__)

def merge_tags(local_tags_str, remote_tags_str):
    try:
        local_tags = json.loads(local_tags_str) if local_tags_str else []
        if not isinstance(local_tags, list): local_tags = []
    except: local_tags = []
    try:
        remote_tags = json.loads(remote_tags_str) if remote_tags_str else []
        if not isinstance(remote_tags, list): remote_tags = []
    except: remote_tags = []
    
    merged = list(set(local_tags + remote_tags))
    return json.dumps(merged)


def add_to_history(history_str, message):
    try:
        history = json.loads(history_str) if history_str else []
        if not isinstance(history, list): history = []
    except: history = []
    
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    entry = f"{timestamp}: {message}"
    history.insert(0, entry)
    return json.dumps(history[:10])


