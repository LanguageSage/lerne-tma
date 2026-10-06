"""Shared deck/folder maintenance payload; no SRS or server fields."""
from pydantic import BaseModel, ConfigDict, Field, StrictStr
from typing import Literal
from uuid import UUID


class TextUpdateCard(BaseModel):
    model_config = ConfigDict(extra='forbid')
    number: int = Field(gt=0, strict=True)
    card_id: int | None = Field(default=None, gt=0, le=2147483647, strict=True)
    deck_id: int | None = Field(default=None, gt=0, le=2147483647, strict=True)
    front: StrictStr = Field(max_length=100000)
    back: StrictStr = Field(max_length=100000)
    context: StrictStr = Field(max_length=100000)
    topics: StrictStr = Field(max_length=10000)
    level: Literal['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] | None = None
    card_type: Literal['standard', 'trainer', 'quiz', 'match', 'free_text', 'puzzle', 'word_bank']


class TextUpdatePreviewRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    cards: list[TextUpdateCard] = Field(min_length=1, max_length=5000)


class TextUpdateApplyRequest(TextUpdatePreviewRequest):
    preview_token: str = Field(pattern=r'^[a-f0-9]{64}$')
    request_id: UUID
    include_new: bool = Field(default=False, strict=True)

