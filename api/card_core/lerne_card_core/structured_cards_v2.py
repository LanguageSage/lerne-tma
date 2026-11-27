"""Canonical content contract for Structured Cards V2.

The Pydantic models are the schema owner; JSON Schema is derived from them.
Passports and grading policies retain their existing owners.
Cards compile deterministically to the existing DSL via structured_cards_legacy.py.
"""
import json
from typing import Annotated, ClassVar, Literal

from pydantic import (BaseModel, ConfigDict, Field, JsonValue,
                      TypeAdapter, ValidationInfo, field_validator, model_validator)
from pydantic_core import PydanticCustomError

from .answer_contract import GradingPolicy
from .deck_passport import validate_passport
from .native_v2_rules import enforce_rules


# Rust and ECMA regex engines agree on White_Space, unlike their \S shortcuts.
NonBlank = r'[^\p{White_Space}]'
Text = Annotated[str, Field(min_length=1, pattern=NonBlank)]
MAX_ANSWER_CHARACTERS = 4000
AnswerText = Annotated[Text, Field(max_length=MAX_ANSWER_CHARACTERS)]
AnswerVariants = Annotated[list[AnswerText], Field(max_length=20)]
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
    rules: ClassVar[tuple[dict, ...]] = ()

    @model_validator(mode='after')
    def native_v2_semantics(self):
        if self.rules:
            enforce_rules(self, self.rules)
        return self

    @classmethod
    def __get_pydantic_json_schema__(cls, core_schema, handler):
        schema = super().__get_pydantic_json_schema__(core_schema, handler)
        if cls.rules:
            schema = handler.resolve_ref_schema(schema)
            schema['x-rules'] = list(cls.rules)
        return schema


class Option(V2Model):
    text: Text
    correct: bool = False


OPTION_RULES = (
    dict(kind='unique', path=['options'], key='text', message='Options must have unique text'),
    dict(kind='count', path=['options'], where={'correct': [True]}, min=1,
         message='At least one correct option is required'),
)


class TextPart(V2Model):
    type: Literal['text']
    text: Annotated[str, Field(min_length=1)]  # Spaces between inline parts matter.


class InputPart(V2Model):
    type: Literal['input']
    answers: Texts

    rules = (dict(kind='unique', path=['answers'], message='Answers must be unique'),)


class ChoicePart(V2Model):
    model_config = ConfigDict(json_schema_extra={'x-normalize-choice': True})
    type: Literal['choice']
    options: Annotated[list[Option], Field(min_length=1)]
    distractors: Literal['auto'] | None = Field(default=None, exclude=True)
    rules = OPTION_RULES

    @model_validator(mode='before')
    @classmethod
    def normalize_choice(cls, value):
        if not isinstance(value, dict) or not isinstance(options := value.get('options'), list):
            return value
        if value.get('distractors') == 'auto' and len(options) != 1:
            raise ValueError('Legacy auto distractors require one option')
        if len(options) == 1 and isinstance(option := options[0], dict):
            return {**value, 'options': [{'correct': True, **option}]}
        return value


TrainerPart = Annotated[TextPart | InputPart | ChoicePart, Field(discriminator='type')]


class GapPart(V2Model):
    type: Literal['gap']
    option: Annotated[int, Field(ge=0)]  # Index of the correct bank item.


class InfoText(V2Model):
    type: Literal['task', 'source', 'example', 'text']
    text: Text


class InfoOptions(V2Model):
    type: Literal['options']
    items: Texts


Info = Annotated[InfoText | InfoOptions, Field(discriminator='type')]


ElementId = Annotated[str, Field(min_length=1, max_length=128, pattern=r'^[A-Za-z0-9_-]+$')]
Visibility = Literal['before_answer', 'after_answer']


class LayoutInfo(V2Model):
    id: ElementId
    type: Literal['info']
    index: Annotated[int, Field(ge=0)]  # Content has one owner: card.info.
    visibility: Visibility = 'before_answer'


class LayoutExercise(V2Model):
    id: ElementId
    type: Literal['exercise']  # Content/answers have one owner: card.data.


class LayoutImage(V2Model):
    id: ElementId
    type: Literal['image']
    path: Annotated[str, Field(max_length=1024, pattern=r'^images/[A-Za-z0-9_-][A-Za-z0-9_.-]*$')]
    alt: str = ''
    caption: str = ''
    visibility: Visibility = 'before_answer'


LayoutElement = Annotated[LayoutInfo | LayoutExercise | LayoutImage, Field(discriminator='type')]


class TheoryData(V2Model):
    text: Text
    summary: str = ''


class StandardData(V2Model):
    prompt: Text
    answer: str = ''


class TrainerData(V2Model):
    back_note: str = ''
    parts: Annotated[list[TrainerPart], Field(min_length=1)]

    rules = (dict(kind='count', path=['parts'], where={'type': ['input', 'choice']},
                  min=1, message='Trainer requires an input or choice part'),)


class QuizData(V2Model):
    back_note: str = ''
    prompt: str
    options: Annotated[list[Option], Field(min_length=2)]
    rules = OPTION_RULES


class Pair(V2Model):
    left: Text
    right: Text


class MatchData(V2Model):
    back_note: str = ''
    pairs: Annotated[list[Pair], Field(min_length=2)]


class PuzzleData(V2Model):
    tokens: Texts  # Correct order, repeats allowed; array position identifies an item.
    translation: Annotated[Text, Field(json_schema_extra={'x-legacy-blank': True})]

    @model_validator(mode='before')
    @classmethod
    def read_missing_translation(cls, value, info: ValidationInfo):
        if (info.context or {}).get('stored_card') and isinstance(value, dict) and 'translation' not in value:
            return {**value, 'translation': ''}
        return value

    @field_validator('translation', mode='wrap')
    @classmethod
    def read_blank_translation(cls, value, handler, info: ValidationInfo):
        if (info.context or {}).get('stored_card') and isinstance(value, str) and not value.strip():
            return value
        return handler(value)


class WordBankData(V2Model):
    options: Texts  # Repeated words are separate consumable items.
    parts: Annotated[list[Annotated[TextPart | GapPart, Field(discriminator='type')]],
                     Field(min_length=1)]

    rules = (
        dict(kind='count', path=['parts'], where={'type': ['gap']},
             min=1, message='Word Bank requires a gap'),
        dict(kind='references', path=['parts'], where={'type': ['gap']}, key='option',
             target=['options'], code='gap_reference', at=['gap', 'option'],
             message='Invalid bank item reference', duplicate='Each gap must use a different bank item',
             missing='Gap references an absent bank item'),
    )


class FreeTextData(V2Model):
    prompt: Text
    sample_answer: Text  # A model answer, not an exact-match key.
    accepted_answers: AnswerVariants = Field(default_factory=list)
    grading_policy: GradingPolicy = Field(default_factory=lambda: GradingPolicy(mode='open_text'))

    @field_validator('grading_policy', mode='before')
    @classmethod
    def revalidate_policy(cls, value):
        return value.model_dump() if isinstance(value, GradingPolicy) else value


class EditableGradingPolicy(GradingPolicy):
    mode: Literal['controlled_text', 'exact'] = 'controlled_text'
    typo_tolerance: bool = False


class EditableTextData(V2Model):
    source_text: AnswerText
    correct_text: AnswerText
    accepted_answers: AnswerVariants = Field(default_factory=list)
    grading_policy: EditableGradingPolicy = Field(default_factory=EditableGradingPolicy)
    rules = (dict(kind='distinct_text', fields=[['source_text'], ['correct_text']],
                  message='Editable Text source and correction must differ'),)

    @field_validator('grading_policy', mode='before')
    @classmethod
    def revalidate_policy(cls, value):
        return value.model_dump() if isinstance(value, GradingPolicy) else value


# Extension metadata must never become a shadow content/answer/passport payload.
CONTENT_KEYS = {'front', 'front_text', 'back', 'back_text', 'context', 'type', 'card_type',
                'image', 'image_path',
                'data', 'parts', 'info', 'explanation', 'level', 'topics', 'cards',
                'accepted_answers', 'grading_policy', 'intro', 'pedagogy', 'passport',
                'text', 'prompt', 'answer', 'answers', 'options', 'pairs', 'tokens', 'back_note',
                'sample_answer', 'source_text', 'correct_text', 'summary', 'translation'}


METADATA_RULE = dict(kind='reserved_keys', path=['metadata'], keys=sorted(CONTENT_KEYS),
                     message='Content, answers and passport belong in their explicit fields')


class CardBase(V2Model):
    id: Text | None = None  # Author's reference only; never a database write target.
    image: Text | None = None  # Relative image filename resolved by the author import.
    info: list[Info] = Field(default_factory=list)
    layout: Annotated[list[LayoutElement], Field(min_length=1, max_length=500)] | None = None
    explanation: str = ''  # Post-answer explanation, legacy CONTEXT.
    level: Level | None = None
    topics: list[Text] | None = None
    metadata: dict[str, JsonValue] = Field(default_factory=dict)
    rules = (
        METADATA_RULE,
        dict(kind='unique', path=['layout'], key='id', message='Layout element IDs must be unique'),
        dict(kind='count', path=['layout'], where={'type': ['exercise']}, min=1, max=1,
             message='Layout must contain exactly one exercise'),
        dict(kind='references', path=['layout'], where={'type': ['info']}, key='index',
             target=['info'], complete=True, message='Layout must reference every info block exactly once'),
        dict(kind='json_bytes', max=MAX_CARD_BYTES,
             message=f'UTF-8 JSON exceeds {MAX_CARD_BYTES} bytes', code='content_too_large'),
    )


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

    rules = (*CardBase.rules,
             dict(kind='visible_text', path=['data', 'prompt'], alternative=['info'],
                  where={'type': ['task', 'source']},
                  selection=dict(path=['layout'], key='index',
                                 where={'type': ['info'], 'visibility': ['before_answer']}),
                  message='Quiz requires a prompt or a task/source block'))


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


class EditableTextCard(CardBase):
    type: Literal['editable_text']
    data: EditableTextData


Card = Annotated[TheoryCard | StandardCard | TrainerCard | QuizCard | MatchCard |
                 PuzzleCard | WordBankCard | FreeTextCard | EditableTextCard, Field(discriminator='type')]
CARD_ADAPTER = TypeAdapter(Card)
SchemaVersion = Literal[2]


class ContentV2(V2Model):
    schema_version: SchemaVersion
    card: Card

    @field_validator('schema_version', mode='before')
    @classmethod
    def strict_version(cls, value):
        return require_integer_version(value)


def require_integer_version(value):
    if type(value) is not int:
        raise ValueError('schema_version must be integer 2')
    return value


class Deck(V2Model):
    name: Text
    passport: dict[str, JsonValue] | None = None
    metadata: dict[str, JsonValue] = Field(default_factory=dict)
    rules = (METADATA_RULE,)

    @field_validator('passport')
    @classmethod
    def existing_passport_contract(cls, value):
        if value is not None:
            errors = validate_passport(value)
            if errors:
                raise ValueError('; '.join(errors))
        return value


class Document(V2Model):
    schema_version: SchemaVersion
    deck: Deck
    cards: Annotated[list[Card], Field(max_length=MAX_DOCUMENT_CARDS)]

    @field_validator('schema_version', mode='before')
    @classmethod
    def integer_version(cls, value):
        return require_integer_version(value)

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
        if not self.cards and not self.deck.passport:
            raise ValueError('An empty document requires a deck passport')
        if self.cards and any(stage.get('to_card', 0) > len(self.cards) for stage in stages):
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
