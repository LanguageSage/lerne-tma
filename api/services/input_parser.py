"""Compatibility import; implementation belongs to lerne-card-core."""
import sys
from api.card_core.lerne_card_core import input_parser as _implementation
sys.modules[__name__] = _implementation
