from api.database import init_proxies
from api import models
init_proxies()
from api.models import TMA_Deck, TMA_Card

for deck_id in [517, 400, 338]:
    d = TMA_Deck.get_or_none(TMA_Deck.id == deck_id)
    if d:
        name_safe = d.name.encode('ascii', 'ignore').decode()
        print('Deck {}: user_id={}, name={}, is_deleted={}'.format(deck_id, d.user_id, name_safe, d.is_deleted))