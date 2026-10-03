import sys
sys.path.append('c:\\121\\Lerne_projekt\\tma')
from fastapi.testclient import TestClient
from api.main import app

client = TestClient(app)
resp = client.post("/api/auth/sync", json={"user_id": 642478257, "is_guest": False}, headers={"X-User-ID": "642478257"})
print(resp.status_code)
print(resp.json())
