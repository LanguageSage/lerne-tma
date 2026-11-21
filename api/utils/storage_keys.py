"""Compatibility import; implementation belongs to lerne-card-core."""
import sys
from api.card_core.lerne_card_core import storage_keys as _implementation
sys.modules[__name__] = _implementation
