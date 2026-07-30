from api.database import init_proxies
from api import models
init_proxies()
from api.services.cards import get_cards_for_study

# Test the service function directly
result = get_cards_for_study(9, 912511925)
print(f'Cards for deck 9: {len(result)}')
if result:
    print(f'First card keys: {list(result[0].keys())}')
    print(f'First card: {result[0]}')

result = get_cards_for_study(8, 912511925)
print(f'Cards for deck 8: {len(result)}')
for c in result:
    print(f'  {c.get("id")}: front={c.get("front_text")}, back={c.get("back_text")}, context={c.get("context")}')