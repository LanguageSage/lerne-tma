"""Owner data erasure and transactional account cleanup; no dialogue side effects."""
from api.models import TMAGameAttempt
from .common import transaction, utcnow
from .models import NPCMemory, CommunicationResult, GameCapture, GameInteraction


def delete_user_data(user_id, *, include_source_attempts=False):
    """Erase MVP 3 data. Full Game erasure also deletes the source conversations."""
    with transaction(user_id):
        # Retain only an attempt erasure barrier, never reprocess an erased dialogue.
        GameCapture.update(erased_at=utcnow()).where(
            GameCapture.user_id == user_id).execute()
        GameInteraction.delete().where(GameInteraction.user_id == user_id).execute()
        result = {
            'memories': NPCMemory.delete().where(NPCMemory.user_id == user_id).execute(),
            'results': CommunicationResult.delete().where(CommunicationResult.user_id == user_id).execute(),
            'attempts': 0,
        }
        if include_source_attempts:
            result['attempts'] = TMAGameAttempt.delete().where(TMAGameAttempt.user_id == user_id).execute()
        return result


def erase_deleted_account(user_id):
    """Called in the account transaction, even when collection has been switched off."""
    from api.models import tma_db
    if 'tma_game_capture' in tma_db.obj.get_tables():
        return delete_user_data(user_id, include_source_attempts=True)
