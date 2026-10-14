"""Additive private storage; deliberately absent from api.models.create_all_tables."""
from peewee import (BigIntegerField, CharField, DateTimeField, ForeignKeyField,
                    IntegerField, TextField)
from api.models import BaseModel, TMAGameAttempt


class NPCMemory(BaseModel):
    id = CharField(primary_key=True, max_length=36)
    user_id = BigIntegerField()
    npc_id = CharField()
    event_id = CharField(max_length=100)
    source_attempt = ForeignKeyField(TMAGameAttempt, on_delete='CASCADE')
    fact = TextField()
    event_hash = CharField(max_length=64)
    value_code = CharField(max_length=100)
    source = CharField()
    confidence = CharField()
    occurred_at = DateTimeField()
    created_at = DateTimeField()
    updated_at = DateTimeField()
    expires_at = DateTimeField(null=True)
    revision = IntegerField(default=0)
    deleted_at = DateTimeField(null=True)  # tombstone prevents replay resurrection

    class Meta:
        table_name = 'tma_npc_memory'
        indexes = ((('user_id', 'npc_id', 'event_id'), True),
                   (('user_id', 'npc_id', 'updated_at'), False),
                   (('user_id', 'npc_id', 'value_code'), False))


class CommunicationResult(BaseModel):
    id = CharField(primary_key=True, max_length=36)
    user_id = BigIntegerField()
    source_attempt = ForeignKeyField(TMAGameAttempt, on_delete='CASCADE')
    task_id = CharField()
    source_version = IntegerField()
    npc_id = CharField()
    occurred_at = DateTimeField()
    task_definition = TextField()
    objective = TextField()
    model_analysis = TextField(null=True)
    processing_hash = CharField(max_length=64)
    created_at = DateTimeField()

    class Meta:
        table_name = 'tma_communication_result'
        indexes = ((('source_attempt', 'task_id'), True),
                   (('user_id', 'occurred_at'), False))


class GameCapture(BaseModel):
    """Opt-in at a new attempt, plus a non-content erasure barrier for old turns."""
    source_attempt = ForeignKeyField(TMAGameAttempt, primary_key=True, on_delete='CASCADE')
    user_id = BigIntegerField(index=True)
    started_at = DateTimeField()
    erased_at = DateTimeField(null=True)

    class Meta:
        table_name = 'tma_game_capture'


class GameInteraction(BaseModel):
    """Committed engine events only: no utterances, audio or model skill findings."""
    id = CharField(primary_key=True, max_length=73)
    user_id = BigIntegerField(index=True)
    source_attempt = ForeignKeyField(TMAGameAttempt, on_delete='CASCADE')
    source_version = IntegerField()
    request_id = CharField(max_length=36)
    task_id = CharField()
    kind = CharField()
    facts = TextField()
    created_at = DateTimeField()

    class Meta:
        table_name = 'tma_game_interaction'
        indexes = ((('source_attempt', 'request_id'), True),
                   (('source_attempt', 'source_version'), True))


MODELS = [NPCMemory, CommunicationResult, GameCapture, GameInteraction]
