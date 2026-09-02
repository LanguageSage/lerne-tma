import os
import json
import time
import logging
from typing import Dict, Any, Optional, List

logger = logging.getLogger('admin.task_manager')

ADMIN_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE_FILE = os.path.join(ADMIN_DIR, 'admin_task_state.json')

# In-memory active task registry
active_tasks: Dict[str, Dict[str, Any]] = {}


def load_task_checkpoint() -> Optional[Dict[str, Any]]:
    """Loads the last saved task state checkpoint from admin_task_state.json if valid."""
    if not os.path.exists(STATE_FILE):
        return None
    try:
        with open(STATE_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            if isinstance(data, dict) and data.get('task_id'):
                return data
    except Exception as e:
        logger.error(f'Failed to read task checkpoint from {STATE_FILE}: {e}')
    return None


def save_task_checkpoint(task_data: Dict[str, Any]) -> bool:
    """Safely saves task state checkpoint to disk (atomic write with .tmp rename)."""
    if not task_data:
        return False
    try:
        clean_data = dict(task_data)
        clean_data['saved_at'] = time.time()
        
        # Limit stored logs to last 100 lines to prevent unbounded JSON file growth
        if 'logs' in clean_data and isinstance(clean_data['logs'], list):
            clean_data['logs'] = clean_data['logs'][-100:]
            
        # Avoid storing giant dry_run arrays in checkpoint
        if 'dry_run_results' in clean_data and isinstance(clean_data['dry_run_results'], list):
            if len(clean_data['dry_run_results']) > 30:
                clean_data['dry_run_results'] = clean_data['dry_run_results'][:30]

        tmp_file = f'{STATE_FILE}.tmp'
        with open(tmp_file, 'w', encoding='utf-8') as f:
            json.dump(clean_data, f, ensure_ascii=False, indent=2)
            
        if os.path.exists(STATE_FILE):
            os.replace(tmp_file, STATE_FILE)
        else:
            os.rename(tmp_file, STATE_FILE)
        return True
    except Exception as e:
        logger.error(f'Failed to save task checkpoint to {STATE_FILE}: {e}')
        return False


def clear_task_checkpoint() -> bool:
    """Removes or resets the task state checkpoint file."""
    try:
        if os.path.exists(STATE_FILE):
            os.remove(STATE_FILE)
        return True
    except Exception as e:
        logger.error(f'Failed to clear task checkpoint {STATE_FILE}: {e}')
        return False


def register_task(task_id: str, initial_data: Dict[str, Any]):
    """Registers an active task into in-memory store and writes initial checkpoint."""
    active_tasks[task_id] = initial_data
    save_task_checkpoint(initial_data)


def get_task(task_id: str) -> Optional[Dict[str, Any]]:
    """Fetches task state from memory or falls back to disk checkpoint if task_id matches."""
    if task_id in active_tasks:
        return active_tasks[task_id]
    
    ckpt = load_task_checkpoint()
    if ckpt and ckpt.get('task_id') == task_id:
        active_tasks[task_id] = ckpt
        return ckpt
    return None


def update_task_progress(
    task_id: str,
    status: Optional[str] = None,
    current_deck_idx: Optional[int] = None,
    current_deck_id: Optional[str] = None,
    current_deck_name: Optional[str] = None,
    current_card_idx: Optional[int] = None,
    current_card_id: Optional[int] = None,
    current_card_text: Optional[str] = None,
    processed_cards: Optional[int] = None,
    processed_decks: Optional[int] = None,
    log_msg: Optional[str] = None
):
    """Updates task progress in memory and persists checkpoint."""
    task = get_task(task_id)
    if not task:
        return

    if status:
        task['status'] = status
    if current_deck_idx is not None:
        task['current_deck_idx'] = current_deck_idx
    if current_deck_id is not None:
        task['current_deck_id'] = str(current_deck_id)
    if current_deck_name is not None:
        task['current_deck_name'] = str(current_deck_name)
    if current_card_idx is not None:
        task['current_card_idx'] = current_card_idx
    if current_card_id is not None:
        task['current_card_id'] = current_card_id
    if current_card_text is not None:
        task['current_card'] = str(current_card_text)
    if processed_cards is not None:
        task['processed_cards'] = processed_cards
    if processed_decks is not None:
        task['processed_decks'] = processed_decks
    if log_msg:
        if 'logs' not in task:
            task['logs'] = []
        task['logs'].append(log_msg)

    save_task_checkpoint(task)
