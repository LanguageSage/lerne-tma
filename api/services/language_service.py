"""Compatibility facade over lerne-card-core.language_service and runtime prompt_builders."""
from api.card_core.lerne_card_core.language_service import (
    NATIVE_LANGUAGES,
    TARGET_LANGUAGES,
    get_native_config,
    get_language_config,
    get_prompt_for_phrase,
    get_cefr_rubric,
    build_card_prompt,
    build_custom_directive_prompt,
    build_rule_explanation_prompt,
    build_trainer_prompt,
    build_quiz_prompt,
    build_match_prompt,
    build_puzzle_prompt,
    build_word_bank_prompt,
    build_free_text_prompt,
    __all__,
)
from api.services.prompt_builders import get_system_presets
