"""Server-owned, versioned teaching definitions; no client-defined comparability."""
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Mapping


@dataclass(frozen=True)
class Skill:
    id: str
    name: str
    description: str
    type: str
    modalities: tuple[str, ...] = ('text', 'speech_transcript', 'verified_audio')


@dataclass(frozen=True)
class Task:
    id: str
    name: str
    language: str
    situation_id: str
    difficulty: str | None
    rubric_version: str
    equivalence_group: str | None
    skills: tuple[str, ...]


@dataclass(frozen=True)
class Catalog:
    """Extend with reviewed definitions for any language, NPC and world."""
    tasks: Mapping[str, Task]
    skills: Mapping[str, Skill]
    memory_values: Mapping[tuple[str, str], tuple[str, ...]]
    statement_terms: Mapping[str, tuple[str, ...]] = field(default_factory=dict)

    def __post_init__(self):
        # Defensive copies: callers cannot mutate a rubric after registration.
        for name in ('tasks', 'skills', 'memory_values', 'statement_terms'):
            object.__setattr__(self, name, MappingProxyType(dict(getattr(self, name))))
        for key, task in self.tasks.items():
            if key != task.id or any(s not in self.skills for s in task.skills):
                raise ValueError('Invalid task/skill catalog')
        for key, skill in self.skills.items():
            if key != skill.id:
                raise ValueError('Invalid skill catalog')


SKILLS = [
    Skill('express_request', 'Выразить просьбу', 'Сформулировать понятную просьбу.', 'communication'),
    Skill('ask_clarification', 'Задать уточняющий вопрос', 'Уточнить недостающую информацию.', 'communication'),
    Skill('explain_situation', 'Объяснить ситуацию', 'Сообщить существенные обстоятельства.', 'communication'),
    Skill('answer_question', 'Ответить на вопрос', 'Дать подходящий ответ собеседнику.', 'communication'),
    Skill('repair_misunderstanding', 'Исправить недопонимание', 'Переформулировать смысл.', 'communication'),
    Skill('explain_reason', 'Объяснить причину', 'Обосновать просьбу или решение.', 'communication'),
    Skill('complete_conversation', 'Завершить разговор', 'Самостоятельно добиться результата.', 'communication'),
    Skill('listening_comprehension', 'Понять обращённую речь', 'Понять речь при проверяемом аудиостимуле.',
          'listening', ('verified_audio',)),
]
DEFAULT_CATALOG = Catalog(
    tasks={'library_balcony_book_v1': Task(
        'library_balcony_book_v1', 'Найти подходящую книгу', 'de', 'library_balcony_book_v1',
        'library-basic-v1', 'communication-v1', None,
        ('express_request', 'answer_question', 'complete_conversation'))},
    skills={s.id: s for s in SKILLS},
    memory_values={
        ('encounter', 'meeting'): ('visited',),
        ('topic', 'subject'): ('gardening', 'cooking', 'travel'),
        ('preference', 'subject'): ('gardening', 'cooking', 'travel'),
        ('promise', 'action'): ('return_book',),
        ('agreement', 'action'): ('return_book',),
        ('outcome', 'result'): ('success', 'other_book', 'failed', 'abandoned'),
    },
    statement_terms={
        'gardening': ('gemüse', 'garten', 'gardening'),
        'cooking': ('kochen', 'cooking'),
        'travel': ('reise', 'travel'),
    })
