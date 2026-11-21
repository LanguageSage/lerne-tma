"""Compatibility import; implementation belongs to lerne-card-core."""
import sys
from api.card_core.lerne_card_core import cefr_metadata as _implementation
sys.modules[__name__] = _implementation
