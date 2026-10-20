"""Local console perimeter through the real app; only disposable SQLite/files."""
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from peewee import SqliteDatabase

from api import models
from tools.admin import server
from tools.admin.routers import backups


LOCAL = "http://127.0.0.1:8050"
EVIL = "https://attacker.example"


class LocalAdminSecurityTests(unittest.TestCase):
    def setUp(self):
        # No lifespan/startup or real DB access, even if the guard regresses.
        self.previous_overrides = server.app.dependency_overrides.copy()
        self.database_access = Mock(side_effect=AssertionError("Request reached database dependency"))
        server.app.dependency_overrides[server.db_session_scope] = lambda: self.database_access()
        self.addCleanup(self.restore_overrides)
        self.client = self.make_client()

    def restore_overrides(self):
        server.app.dependency_overrides.clear()
        server.app.dependency_overrides.update(self.previous_overrides)

    def make_client(self, host="127.0.0.1"):
        client = TestClient(server.app, base_url=LOCAL, client=(host, 50000))
        self.addCleanup(client.close)
        return client

    def test_ui_and_static_open_locally_without_login(self):
        server.app.dependency_overrides[server.db_session_scope] = lambda: None
        for authority in ("127.0.0.1:8050", "localhost:8050"):
            for path, marker in (("/", "tab-users"), ("/static/js/app.js", "checkServerHeartbeat")):
                with self.subTest(authority=authority, path=path):
                    response = self.client.get(f"http://{authority}{path}")
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertIn(marker, response.text)
                    self.assertEqual(response.headers["x-frame-options"], "DENY")
                    self.assertIn("no-store", response.headers["cache-control"])

    def test_every_api_rejects_foreign_and_missing_sources_before_dependencies(self):
        # Includes all routers, media routes outside /api/admin, and future API routes.
        routes = [route for route in server.app.routes
                  if isinstance(route, APIRoute) and route.path.startswith("/api/")]
        self.assertGreater(len(routes), 60)
        for route in routes:
            path = re.sub(r"\{[^}]+\}", "1", route.path)
            for method in route.methods:
                for headers in ({"Origin": EVIL}, {}, {"Origin": "null"},
                                {"Sec-Fetch-Site": "cross-site"},
                                {"Referer": EVIL + "/page"}):
                    with self.subTest(method=method, path=path, headers=headers):
                        response = self.client.request(method, path, headers=headers)
                        self.assertEqual(response.status_code, 403, response.text)
                        self.assertNotIn("access-control-allow-origin", response.headers)
        self.database_access.assert_not_called()

    def test_rebinding_and_unexpected_authorities_are_denied(self):
        for host in ("attacker.example:8050", "127.0.0.1.attacker.example:8050",
                     "localhost.attacker.example:8050", "localhost", "127.0.0.1:8000",
                     "192.168.1.2:8050", "0.0.0.0:8050", "localhost:8050@attacker.example"):
            with self.subTest(host=host):
                response = self.client.get("/", headers={"Host": host, "Origin": LOCAL,
                    "X-Forwarded-Host": "127.0.0.1:8050", "X-Forwarded-For": "127.0.0.1"})
                self.assertEqual(response.status_code, 403)
        self.database_access.assert_not_called()

    def test_remote_or_unknown_peers_are_denied_even_with_local_headers(self):
        for host in ("192.168.1.2", "203.0.113.5", "::", "testclient"):
            with self.subTest(host=host):
                response = self.make_client(host).get("/", headers={
                    "Origin": LOCAL, "X-Forwarded-For": "127.0.0.1", "Forwarded": "for=127.0.0.1"})
                self.assertEqual(response.status_code, 403)
        self.database_access.assert_not_called()

    def test_other_local_ports_schemes_and_lookalike_sources_are_denied(self):
        for origin in ("http://localhost:5173", "http://127.0.0.1:8000", "https://localhost:8050",
                       LOCAL + ".attacker.example", LOCAL + "/", LOCAL + " " + EVIL):
            with self.subTest(origin=origin):
                response = self.client.post("/api/admin/purge-deleted", headers={"Origin": origin})
                self.assertEqual(response.status_code, 403)
        # Same-site differs from same-origin: another localhost port is untrusted.
        for site in ("cross-site", "same-site"):
            response = self.client.post("/api/admin/purge-deleted", headers={
                "Origin": LOCAL, "Sec-Fetch-Site": site})
            self.assertEqual(response.status_code, 403)
        self.database_access.assert_not_called()

    def test_duplicate_security_headers_and_malformed_referrers_are_denied(self):
        for name, values in (("Host", ("127.0.0.1:8050", "evil.example:8050")),
                             ("Origin", (LOCAL, EVIL)), ("Referer", (LOCAL, EVIL)),
                             ("Sec-Fetch-Site", ("same-origin", "cross-site"))):
            with self.subTest(name=name):
                response = self.client.get("/", headers=[(name, value) for value in values])
                self.assertEqual(response.status_code, 403)
        response = self.client.get("/api/admin/users", headers={"Referer": "http://[invalid"})
        self.assertEqual(response.status_code, 403)
        self.database_access.assert_not_called()

    def test_cors_preflight_only_allows_admin_origins_methods_and_headers(self):
        for origin in (LOCAL, "http://localhost:8050"):
            for method in ("GET", "POST", "PUT", "DELETE"):
                with self.subTest(origin=origin, method=method):
                    response = self.client.options("/api/admin/cards/1", headers={
                        "Origin": origin, "Access-Control-Request-Method": method,
                        "Access-Control-Request-Headers": "Content-Type"})
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.headers["access-control-allow-origin"], origin)
                    self.assertNotIn("access-control-allow-credentials", response.headers)
        response = self.client.options("/api/admin/cards/1", headers={
            "Origin": EVIL, "Access-Control-Request-Method": "DELETE"})
        self.assertEqual(response.status_code, 403)
        for extra in ({"Access-Control-Request-Method": "PATCH"},
                      {"Access-Control-Request-Headers": "X-Unneeded-Header"}):
            response = self.client.options("/api/admin/cards/1", headers={
                "Origin": LOCAL, "Access-Control-Request-Method": "POST", **extra})
            self.assertEqual(response.status_code, 400)
        self.database_access.assert_not_called()

    def test_local_source_evidence_allows_json_and_multipart(self):
        server.app.dependency_overrides[server.db_session_scope] = lambda: None
        # Empty IDs exercise real request validation without a database.
        for headers in ({"Origin": LOCAL}, {"Origin": "http://localhost:8050"},
                        {"Referer": LOCAL + "/"}, {"Sec-Fetch-Site": "same-origin"}):
            with self.subTest(headers=headers):
                response = self.client.post("/api/admin/users/batch-delete",
                                            headers=headers, json={"user_ids": []})
                self.assertEqual(response.status_code, 400)
                self.assertIn("ID", response.json()["detail"])
                with patch.object(backups, "get_effective_backup_dir") as filesystem:
                    response = self.client.post("/api/admin/backups/upload", headers=headers,
                        files={"file": ("invalid.txt", b"test", "text/plain")})
                    self.assertEqual(response.status_code, 400)
                    filesystem.assert_not_called()
        # A trusted Referer cannot override an explicit opaque/foreign Origin.
        response = self.client.post("/api/admin/users/batch-delete", json={"user_ids": []},
                                    headers={"Origin": "null", "Referer": LOCAL + "/"})
        self.assertEqual(response.status_code, 403)


class LocalAdminOperationsTests(unittest.TestCase):
    def setUp(self):
        self.previous_db = (models.tma_db.obj, models.lerne_db.obj)
        self.previous_overrides = server.app.dependency_overrides.copy()
        server.app.dependency_overrides[server.db_session_scope] = lambda: None
        self.db = SqliteDatabase(":memory:", thread_safe=False, check_same_thread=False)
        models.tma_db.initialize(self.db)
        models.lerne_db.initialize(self.db)
        self.addCleanup(self.restore_database)
        self.db.create_tables([models.TMAUser, models.TMA_Folder, models.TMA_Deck,
            models.TMA_Card, models.TMAProgress, models.TMAReviewHistory,
            models.TMA_Collaborator, models.TMAFeedback, models.TMACustomPrompt,
            models.TMAUserPrompt, models.TMALinkedSession])
        self.user = models.TMAUser.create(user_id=101, first_name="Synthetic user")
        self.deck = models.TMA_Deck.create(user_id=101, name="Synthetic deck")
        self.card = models.TMA_Card.create(deck=self.deck, front_text="Test", back_text="Test")
        self.client = TestClient(server.app, base_url=LOCAL, client=("127.0.0.1", 50000),
                                 headers={"Origin": LOCAL})
        self.addCleanup(self.client.close)

    def restore_database(self):
        self.db.close()
        models.tma_db.initialize(self.previous_db[0])
        models.lerne_db.initialize(self.previous_db[1])
        server.app.dependency_overrides.clear()
        server.app.dependency_overrides.update(self.previous_overrides)

    def test_foreign_delete_preserves_records_and_local_delete_still_works(self):
        for path in (f"/api/admin/cards/{self.card.id}", f"/api/admin/decks/{self.deck.id}",
                     "/api/admin/users/101"):
            with self.subTest(path=path):
                response = self.client.delete(path, headers={"Origin": EVIL})
                self.assertEqual(response.status_code, 403)
        self.assertFalse(models.TMA_Card.get_by_id(self.card.id).is_deleted)
        self.assertFalse(models.TMA_Deck.get_by_id(self.deck.id).is_deleted)
        self.assertTrue(models.TMAUser.select().exists())
        response = self.client.get("/api/admin/users")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.client.delete(f"/api/admin/cards/{self.card.id}").status_code, 200)
        self.assertTrue(models.TMA_Card.get_by_id(self.card.id).is_deleted)
        self.assertEqual(self.client.delete(f"/api/admin/decks/{self.deck.id}").status_code, 200)
        self.assertTrue(models.TMA_Deck.get_by_id(self.deck.id).is_deleted)
        response = self.client.delete("/api/admin/users/101")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(models.TMAUser.select().exists())
        self.assertFalse(models.TMA_Deck.select().exists())
        self.assertFalse(models.TMA_Card.select().exists())

    def test_backup_upload_download_inspect_create_and_delete_remain_local(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(backups, "get_effective_backup_dir", return_value=directory), \
                patch("tools.admin.services.backup_service.get_all_backup_search_dirs", return_value=[directory]), \
                patch.object(backups, "get_all_backup_search_dirs", return_value=[directory]):
            payload = b'{"users": [], "decks": [], "cards": []}'
            upload = {"file": ("synthetic.json", payload, "application/json")}
            response = self.client.post("/api/admin/backups/upload", files=upload, headers={"Origin": EVIL})
            self.assertEqual(response.status_code, 403)
            self.assertFalse(list(Path(directory).iterdir()))
            response = self.client.post("/api/admin/backups/upload", files=upload)
            self.assertEqual(response.status_code, 200, response.text)
            for path in ("/api/admin/backups/download/synthetic.json",
                         "/api/admin/backups/inspect?filename=synthetic.json"):
                self.assertEqual(self.client.get(path, headers={"Origin": EVIL}).status_code, 403)
                self.assertEqual(self.client.get(path).status_code, 200)
            response = self.client.post("/api/admin/backups/create")
            self.assertEqual(response.status_code, 200, response.text)
            self.assertTrue((Path(directory) / response.json()["filename"]).is_file())
            path = "/api/admin/backups/synthetic.json"
            self.assertEqual(self.client.delete(path, headers={"Origin": EVIL}).status_code, 403)
            self.assertTrue((Path(directory) / "synthetic.json").exists())
            self.assertEqual(self.client.delete(path).status_code, 200)
            self.assertFalse((Path(directory) / "synthetic.json").exists())


if __name__ == "__main__":
    unittest.main()
