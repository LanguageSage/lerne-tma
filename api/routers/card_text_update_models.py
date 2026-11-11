"""Shared deck/folder maintenance payload; no SRS or server fields."""
from pydantic import BaseModel, ConfigDict, Field, field_validator
from api.services.structured_card_storage import decode_v2_content, _encode_card
from uuid import UUID


class TextUpdateCard(BaseModel):
    model_config = ConfigDict(extra='forbid')
    number: int = Field(gt=0, strict=True)
    card_id: int | None = Field(default=None, gt=0, le=2147483647, strict=True)
    deck_id: int | None = Field(default=None, gt=0, le=2147483647, strict=True)
    content_v2: dict

    @field_validator('content_v2')
    @classmethod
    def valid_content(cls, value):
        return _encode_card(decode_v2_content(value))


class TextUpdatePreviewRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    cards: list[TextUpdateCard] = Field(min_length=1, max_length=5000)


class TextUpdateApplyRequest(TextUpdatePreviewRequest):
    preview_token: str = Field(pattern=r'^[a-f0-9]{64}$')
    request_id: UUID
    include_new: bool = Field(default=False, strict=True)
