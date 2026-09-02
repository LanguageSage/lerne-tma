"""
Language Service Facade (Single Point of Access / Backwards Compatibility).

This module re-exports components from:
- language_config: Language dictionaries, voices, and locales
- cefr_rubrics: Dual CEFR evaluation rubrics (DE, EN, NO)
- prompt_builders: Structured LLM prompt generators and presets
"""

from api.services.language_config import (
    NATIVE_LANGUAGES,
    TARGET_LANGUAGES,
    get_native_config,
    get_language_config,
    get_prompt_for_phrase,
)

from api.services.cefr_rubrics import (
    get_cefr_rubric,
)

from api.services.prompt_builders import (
    build_card_prompt,
    build_custom_directive_prompt,
    build_rule_explanation_prompt,
    build_trainer_prompt,
    build_quiz_prompt,
    get_system_presets,
)

__all__ = [
    "NATIVE_LANGUAGES",
    "TARGET_LANGUAGES",
    "get_native_config",
    "get_language_config",
    "get_prompt_for_phrase",
    "get_cefr_rubric",
    "build_card_prompt",
    "build_custom_directive_prompt",
    "build_rule_explanation_prompt",
    "build_trainer_prompt",
    "build_quiz_prompt",
    "get_system_presets",
]
