"""Compatibility import; implementation belongs to lerne-card-core."""
import sys
from api.card_core.lerne_card_core import structured_cards_v2 as _implementation
sys.modules[__name__] = _implementation
