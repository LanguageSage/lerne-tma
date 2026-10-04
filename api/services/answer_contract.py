"""Versioned answer result and the single owner of grading-policy defaults."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class GradingPolicy(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    mode: Literal['exact', 'controlled_text', 'open_text'] = 'controlled_text'
    typo_tolerance: bool = True
    semantic_equivalence: bool = True
    grammar_requires_retry: bool = True
    case_sensitive: bool = False
    punctuation_sensitive: bool = False
    max_retries: int = Field(default=3, ge=1, le=10)


class AnswerEvaluation(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    schema_version: Literal[1] = 1
    verdict: Literal['correct', 'accepted_minor', 'needs_retry', 'incorrect', 'unavailable']
    accepted: bool
    error_type: Literal['typo', 'orthography', 'punctuation', 'grammar', 'word_order',
                        'word_choice', 'meaning', 'missing_content', 'extra_content', 'other'] | None = None
    error_code: str | None = Field(default=None, max_length=100, pattern=r'^[a-z][a-z0-9_.]*$')
    severity: Literal['none', 'minor', 'major'] = 'none'
    target_relevance: Literal['none', 'secondary', 'primary'] = 'none'
    corrected_answer: str | None = Field(default=None, max_length=4000)
    hint: str | None = Field(default=None, max_length=300)
    explanation: str | None = Field(default=None, max_length=500)
    evaluator: Literal['exact', 'rules', 'ai']
    confidence: float = Field(default=1.0, ge=0, le=1)

    @model_validator(mode='after')
    def consistent_result(self):
        if self.accepted != (self.verdict in ('correct', 'accepted_minor')):
            raise ValueError('accepted/verdict mismatch')
        if self.verdict in ('correct', 'unavailable'):
            if self.error_type is not None or self.severity != 'none':
                raise ValueError('correct/unavailable cannot carry a learner error')
        elif self.error_type is None or self.severity == 'none':
            raise ValueError('learner errors require a type and severity')
        if self.verdict == 'accepted_minor' and (
            self.error_type not in ('typo', 'orthography', 'punctuation')
            or self.severity != 'minor' or self.target_relevance == 'primary'
        ):
            raise ValueError('only secondary surface errors can be accepted')
        if self.verdict == 'needs_retry' and not (self.hint and self.hint.strip()):
            raise ValueError('retry requires a hint')
        return self


def unavailable(evaluator='ai'):
    return AnswerEvaluation(verdict='unavailable', accepted=False, evaluator=evaluator, confidence=0.0)
