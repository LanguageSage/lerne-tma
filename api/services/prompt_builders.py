"""Runtime wrapper delegating pure prompt builders to lerne-card-core."""
from api.card_core.lerne_card_core import prompt_builders as _core
from api.card_core.lerne_card_core.prompt_builders import *  # noqa: F401,F403
from api.card_core.lerne_card_core.prompt_builders import _LEVEL_PRESETS, _names


def get_system_presets(target_lang: str = "de", native_lang: str = None) -> list:
    if not native_lang:
        try:
            from api import models
            native_rec = models.TMASetting.get_or_none(models.TMASetting.key == "NATIVE_LANGUAGE")
            native_lang = native_rec.value if native_rec else "ru"
        except Exception:
            native_lang = "ru"
    return _core.get_system_presets(target_lang=target_lang, native_lang=native_lang)
