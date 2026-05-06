import os
import re

base_path = 'c:\\121\\Lerne_projekt\\tma\\api'
services_file = os.path.join(base_path, 'services.py')
output_dir = os.path.join(base_path, 'services')

if not os.path.exists(output_dir):
    os.makedirs(output_dir)

with open(services_file, 'r', encoding='utf-8') as f:
    content = f.read()

# Shared header (imports)
header = """import os
import datetime
import logging
import json
from ..models import TMA_Deck, TMA_Card, TMAProgress, TMAReviewHistory, Deck, Card, tma_db, TMAMedia
from .. import srs
from peewee import fn, JOIN
from functools import lru_cache

logger = logging.getLogger(__name__)
"""

def extract_funcs(content, names):
    extracted = ""
    for name in names:
        # Find function definition and its body
        pattern = re.compile(r"def " + name + r"\(.*?\):.*?(\n(?=[a-zA-Z#@])|\Z)", re.DOTALL)
        # Using a more robust approach: find def name, then find next def or end of file
        start = content.find(f"def {name}(")
        if start == -1: continue
        
        # Find end of function by looking at indentation
        lines = content[start:].split('\n')
        func_lines = [lines[0]]
        for line in lines[1:]:
            if line.strip() == "" or line.startswith(' ') or line.startswith('\t'):
                func_lines.append(line)
            else:
                break
        extracted += '\n'.join(func_lines) + '\n\n'
    return extracted

# 1. Utils Service
utils_funcs = ['merge_tags', 'add_to_history']
with open(os.path.join(output_dir, 'utils.py'), 'w', encoding='utf-8') as f:
    f.write(header + "\n" + extract_funcs(content, utils_funcs))

# 2. Media Service
media_funcs = ['_build_media_exists_map', '_check_media_exists', 'resolve_media_url']
with open(os.path.join(output_dir, 'media.py'), 'w', encoding='utf-8') as f:
    f.write(header + "\n" + extract_funcs(content, media_funcs))

# 3. Cards Service
cards_funcs = ['save_card', 'delete_card', 'get_cards_for_study', 'get_next_card']
cards_content = header + "\nfrom .media import resolve_media_url, _build_media_exists_map\nfrom .utils import add_to_history\n\n" + extract_funcs(content, cards_funcs)
with open(os.path.join(output_dir, 'cards.py'), 'w', encoding='utf-8') as f:
    f.write(cards_content)

# 4. Decks Service
decks_funcs = ['ensure_starter_decks', 'get_active_decks', 'get_external_decks', 'import_deck', 'import_deck_from_json', 'delete_deck', 'sync_deck_with_library', 'promote_to_library', 'reset_deck_progress', 'get_community_content']
decks_content = header + "\nfrom .utils import merge_tags, add_to_history\n\n" + extract_funcs(content, decks_funcs)
# Fix import_deck call in ensure_starter_decks (internal reference)
# Since they are in the same file, it's fine.
with open(os.path.join(output_dir, 'decks.py'), 'w', encoding='utf-8') as f:
    f.write(decks_content)

# 5. Study Service
study_funcs = ['update_card_progress']
study_content = header + "\n" + extract_funcs(content, study_funcs)
with open(os.path.join(output_dir, 'study.py'), 'w', encoding='utf-8') as f:
    f.write(study_content)

# 6. __init__.py for easy access
init_content = """from .decks import *
from .cards import *
from .study import *
from .media import *
from .utils import *
"""
with open(os.path.join(output_dir, '__init__.py'), 'w', encoding='utf-8') as f:
    f.write(init_content)

print("Split services.py into modular files successfully.")
