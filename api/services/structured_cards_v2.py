"""Opt-in authoring contract for Structured Cards V2.

The Pydantic models are the schema owner; JSON Schema is derived from them.
Passports and grading policies retain their existing owners.
Cards compile deterministically to the existing DSL via structured_cards_legacy.py.
"""
import json
from typing import Annotated, Literal

from pydantic import (BaseModel, ConfigDict, Field, JsonValue,
                      TypeAdapter, ValidationError, field_validator, model_validator)
from pydantic_core import PydanticCustomError

from api.services.answer_contract import GradingPolicy
from api.services.deck_passport import validate_passport


Text = Annotated[str, Field(min_length=1, pattern=r'\S')]
Texts = Annotated[list[Text], Field(min_length=1)]
Level = Literal['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
MAX_CARD_BYTES = 256 * 1024
MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
MAX_DOCUMENT_CARDS = 1000


def _canonical_json(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(',', ':'), allow_nan=False)


def _check_size(text: str | bytes, limit: int):
    size = len(text.encode('utf-8')) if isinstance(text, str) else len(text)
    if size > limit:
        raise PydanticCustomError('content_too_large',
                                  'UTF-8 JSON exceeds {limit} bytes', {'limit': limit})


class V2Model(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, allow_inf_nan=False,
                              revalidate_instances='always')


class Option(V2Model):
    text: Text
    correct: bool = False


def check_options(options):
    labels = [option.text for option in options]
    if len(set(labels)) != len(labels):
        raise ValueError('Options must have unique text')
    if not any(option.correct for option in options):
        raise ValueError('At least one correct option is required')
    return options


class TextPart(V2Model):
    type: Literal['text']
    text: Annotated[str, Field(min_length=1)]  # Spaces between inline parts matter.


class InputPart(V2Model):
    type: Literal['input']
    answers: Texts

    @field_validator('answers')
    @classmethod
    def valid_answers(cls, value):
        if len(set(value)) != len(value):
            raise ValueError('Answers must be unique')
        return value


class ChoicePart(V2Model):
    type: Literal['choice']
    options: Annotated[list[Option], Field(min_length=2)]
    _options = field_validator('options')(check_options)


TrainerPart = Annotated[TextPart | InputPart | ChoicePart, Field(discriminator='type')]


class GapPart(V2Model):
    type: Literal['gap']
    option: Annotated[int, Field(ge=0)]  # Index of the correct bank item.


class InfoText(V2Model):
    type: Literal['task', 'source', 'example']
    text: Text


class InfoOptions(V2Model):
    type: Literal['options']
    items: Texts


Info = Annotated[InfoText | InfoOptions, Field(discriminator='type')]


class TheoryData(V2Model):
    text: Text
    summary: str = ''


class StandardData(V2Model):
    prompt: Text
    answer: Text


class TrainerData(V2Model):
    parts: Annotated[list[TrainerPart], Field(min_length=1)]

    @field_validator('parts')
    @classmethod
    def has_gap(cls, value):
        if all(part.type == 'text' for part in value):
            raise ValueError('Trainer requires an input or choice part')
        return value


class QuizData(V2Model):
    prompt: Text
    options: Annotated[list[Option], Field(min_length=2)]
    _options = field_validator('options')(check_options)


class Pair(V2Model):
    left: Text
    right: Text


class MatchData(V2Model):
    pairs: Annotated[list[Pair], Field(min_length=2)]


class PuzzleData(V2Model):
    tokens: Texts  # Correct order, repeats allowed; array position identifies an item.
    translation: str = ''


class WordBankData(V2Model):
    options: Texts  # Repeated words are separate consumable items.
    parts: Annotated[list[Annotated[TextPart | GapPart, Field(discriminator='type')]],
                     Field(min_length=1)]

    @field_validator('parts')
    @classmethod
    def valid_references(cls, parts, info):
        seen, errors = set(), []
        for index, part in enumerate(parts):
            if part.type != 'gap':
                continue
            message = None
            if part.option in seen:
                message = 'Each gap must use a different bank item'
            elif 'options' in info.data and part.option >= len(info.data['options']):
                message = 'Gap references an absent bank item'
            if message:
                errors.append({'type': PydanticCustomError('gap_reference', message),
                               'loc': (index, 'gap', 'option'), 'input': part.option})
            seen.add(part.option)
        if errors:
            raise ValidationError.from_exception_data(cls.__name__, errors)
        if not seen:
            raise ValueError('Word Bank requires a gap')
        return parts


class FreeTextData(V2Model):
    prompt: Text
    sample_answer: Text  # A model answer, not an exact-match key.
    accepted_answers: list[Text] = Field(default_factory=list)
    grading_policy: GradingPolicy = Field(default_factory=lambda: GradingPolicy(mode='open_text'))

    @field_validator('grading_policy', mode='before')
    @classmethod
    def revalidate_policy(cls, value):
        return value.model_dump() if isinstance(value, GradingPolicy) else value

    @field_validator('accepted_answers')
    @classmethod
    def answer_variants(cls, value):
        if len(value) > 20 or any(len(item) > 4000 for item in value):
            raise ValueError('At most 20 nonblank answers of at most 4000 characters')
        return value


# Extension metadata must never become a shadow content/answer/passport payload.
CONTENT_KEYS = {'front', 'front_text', 'back', 'back_text', 'context', 'type', 'card_type',
                'data', 'parts', 'info', 'explanation', 'level', 'topics', 'cards',
                'accepted_answers', 'grading_policy', 'intro', 'pedagogy', 'passport',
                'text', 'prompt', 'answer', 'answers', 'options', 'pairs', 'tokens',
                'sample_answer', 'summary', 'translation'}


def check_metadata(value):
    if CONTENT_KEYS.intersection(value):
        raise ValueError('Content, answers and passport belong in their explicit fields')
    json.dumps(value, allow_nan=False)
    return value


class CardBase(V2Model):
    id: Text | None = None  # Author's reference only; never a database write target.
    info: list[Info] = Field(default_factory=list)
    explanation: str = ''  # Post-answer explanation, legacy CONTEXT.
    level: Level | None = None
    topics: list[Text] | None = None
    metadata: dict[str, JsonValue] = Field(default_factory=dict)
    _metadata = field_validator('metadata')(check_metadata)

    @model_validator(mode='after')
    def bounded_content(self):
        _check_size(_canonical_json(self.model_dump(mode='json')), MAX_CARD_BYTES)
        return self


class TheoryCard(CardBase):
    type: Literal['theory']
    data: TheoryData


class StandardCard(CardBase):
    type: Literal['standard']
    data: StandardData


class TrainerCard(CardBase):
    type: Literal['trainer']
    data: TrainerData


class QuizCard(CardBase):
    type: Literal['quiz']
    data: QuizData


class MatchCard(CardBase):
    type: Literal['match']
    data: MatchData


class PuzzleCard(CardBase):
    type: Literal['puzzle']
    data: PuzzleData


class WordBankCard(CardBase):
    type: Literal['word_bank']
    data: WordBankData


class FreeTextCard(CardBase):
    type: Literal['free_text']
    data: FreeTextData


Card = Annotated[TheoryCard | StandardCard | TrainerCard | QuizCard | MatchCard |
                 PuzzleCard | WordBankCard | FreeTextCard, Field(discriminator='type')]
CARD_ADAPTER = TypeAdapter(Card)


class Deck(V2Model):
    name: Text
    passport: dict[str, JsonValue] | None = None
    metadata: dict[str, JsonValue] = Field(default_factory=dict)
    _metadata = field_validator('metadata')(check_metadata)

    @field_validator('passport')
    @classmethod
    def existing_passport_contract(cls, value):
        if value is not None:
            errors = validate_passport(value)
            if errors:
                raise ValueError('; '.join(errors))
        return value


class Document(V2Model):
    schema_version: Literal[2]
    deck: Deck
    cards: Annotated[list[Card], Field(min_length=1, max_length=MAX_DOCUMENT_CARDS)]

    @field_validator('schema_version', mode='before')
    @classmethod
    def integer_version(cls, value):
        if type(value) is not int:
            raise ValueError('schema_version must be integer 2')
        return value

    @field_validator('cards')
    @classmethod
    def unique_ids(cls, value):
        ids = [card.id for card in value if card.id is not None]
        if len(set(ids)) != len(ids):
            raise ValueError('Card ids must be unique within the document')
        return value

    @model_validator(mode='after')
    def passport_card_ranges(self):
        stages = (self.deck.passport or {}).get('pedagogy', {}).get('stages', [])
        if any(stage.get('to_card', 0) > len(self.cards) for stage in stages):
            raise ValueError('Passport stage range exceeds document card count')
        _check_size(_canonical_json(self.model_dump(mode='json')), MAX_DOCUMENT_BYTES)
        return self


def validate_document(value) -> Document:
    """Validate without coercion or mutation; raise ValidationError with field paths."""
    return Document.model_validate(value)


def _load_json(text: str | bytes, limit: int):
    """Check raw size before parsing; duplicate keys cannot be detected on dicts."""
    _check_size(text, limit)
    if isinstance(text, bytes):
        text = text.decode('utf-8')

    def unique_keys(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f'Duplicate JSON key: {key}')
            result[key] = value
        return result

    def invalid_constant(value):
        raise ValueError(f'Invalid JSON constant: {value}')

    return json.loads(text, object_pairs_hook=unique_keys, parse_constant=invalid_constant)


def load_document(text: str | bytes) -> Document:
    """Strict JSON input: reject size, duplicate keys, NaN/Infinity and unknown fields."""
    return validate_document(_load_json(text, MAX_DOCUMENT_BYTES))


def validate_card(value) -> Card:
    """Validate one authored card through the same union used by Document."""
    return CARD_ADAPTER.validate_python(value)


def load_card(text: str | bytes) -> Card:
    return validate_card(_load_json(text, MAX_CARD_BYTES))


def normalize_card(value) -> dict:
    """Return a detached JSON value; add defaults, never trim/reorder/deduplicate."""
    return validate_card(value).model_dump(mode='json')
