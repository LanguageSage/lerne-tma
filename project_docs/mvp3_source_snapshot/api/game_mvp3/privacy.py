"""Explicit account deletion seam; not attached to account or dialogue lifecycle."""
from api.models import TMAGameAttempt
from .common import transaction
from .models import NPCMemory, CommunicationResult


def delete_user_data(user_id, *, include_source_attempts=False):
    """Erase MVP 3 data. Full Game erasure also deletes the source conversations."""
    with transaction(user_id):
        result = {
            'memories': NPCMemory.delete().where(NPCMemory.user_id == user_id).execute(),
            'results': CommunicationResult.delete().where(CommunicationResult.user_id == user_id).execute(),
            'attempts': 0,
        }
        if include_source_attempts:
            result['attempts'] = TMAGameAttempt.delete().where(TMAGameAttempt.user_id == user_id).execute()
        return result
