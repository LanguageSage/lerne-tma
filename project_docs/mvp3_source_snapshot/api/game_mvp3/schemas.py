"""Trusted server inputs. None of these evidence-write models is exposed to clients."""
from datetime import datetime
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Code = Annotated[str, Field(min_length=1, max_length=100, pattern=r'^[a-zA-Z0-9_.:-]+$')]
Count = Annotated[int, Field(strict=True, ge=0, le=1000)]
Modality = Literal['text', 'speech_transcript', 'verified_audio', 'unknown']
SkillState = Literal['difficulty', 'with_help', 'independent']


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)


class MemoryFact(StrictModel):
    kind: Literal['encounter', 'topic', 'preference', 'promise', 'agreement', 'outcome']
    key: Code
    value: Code


class MemoryEvent(StrictModel):
    event_id: Code
    attempt_id: str = Field(min_length=36, max_length=36)
    fact: MemoryFact
    source: Literal['engine', 'user_statement', 'model_inference']
    # Source text is checked transiently, never stored in memory.
    evidence: str | None = Field(default=None, min_length=1, max_length=1000)
    expires_at: datetime | None = None

    @field_validator('expires_at')
    @classmethod
    def timezone_required(cls, value):
        if value is not None and value.tzinfo is None:
            raise ValueError('An explicit timezone is required')
        return value


class SkillEvidence(StrictModel):
    skill_id: Code
    state: SkillState
    event_ids: list[Code] = Field(min_length=1, max_length=20)
    modality: Modality
    source: Literal['engine'] = 'engine'

    @field_validator('event_ids')
    @classmethod
    def unique_events(cls, values):
        if len(set(values)) != len(values):
            raise ValueError('Duplicate evidence events')
        return values


class ServerObservation(StrictModel):
    """Only an authoritative task evaluator may supply this object."""
    modality: Modality = 'unknown'
    translation_count: Count | None = None
    other_help_count: Count | None = None
    support_tracking_complete: bool = Field(default=False, strict=True)
    task_event_ids: list[Code] = Field(default_factory=list, max_length=40)
    audio_stimulus_id: Code | None = None
    audio_comprehension_event_ids: list[Code] = Field(default_factory=list, max_length=20)
    skills: list[SkillEvidence] = Field(default_factory=list, max_length=20)

    @model_validator(mode='after')
    def consistent_events(self):
        if len(set(self.task_event_ids)) != len(self.task_event_ids):
            raise ValueError('Duplicate task events')
        if len({s.skill_id for s in self.skills}) != len(self.skills):
            raise ValueError('Duplicate skill evidence')
        if self.modality == 'verified_audio' and not self.audio_stimulus_id:
            raise ValueError('Verified audio requires an authoritative stimulus ID')
        if not set(self.audio_comprehension_event_ids) <= set(self.task_event_ids):
            raise ValueError('Audio evidence must reference recorded task events')
        if len(set(self.audio_comprehension_event_ids)) != len(self.audio_comprehension_event_ids):
            raise ValueError('Duplicate audio evidence events')
        for skill in self.skills:
            if not set(skill.event_ids) <= set(self.task_event_ids):
                raise ValueError('Skill evidence must reference recorded task events')
            if skill.modality != self.modality:
                raise ValueError('Inconsistent modality')
        if self.support_tracking_complete and (
                self.translation_count is None or self.other_help_count is None):
            raise ValueError('Complete support tracking requires all counters')
        return self


class ModelFinding(StrictModel):
    skill_id: Code
    state: SkillState
    confidence: float = Field(ge=0, le=1, allow_inf_nan=False, strict=True)
    evidence: list[str] = Field(min_length=1, max_length=4)

    @field_validator('evidence')
    @classmethod
    def bounded_spans(cls, values):
        if any(not v.strip() or len(v) > 300 for v in values):
            raise ValueError('Invalid evidence span')
        return values


class ModelAnalysis(StrictModel):
    schema_version: Literal[1]
    findings: list[ModelFinding] = Field(max_length=20)
