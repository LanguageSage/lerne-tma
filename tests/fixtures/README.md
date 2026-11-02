# Synthetic CI fixtures

Only fictional data and hand-authored schema examples belong here. No user
exports, credentials, databases, backups or generated test reports.

See [TEST_DATA](../../docs/TEST_DATA.md) for the scenario inventory, generation,
clean-clone requirements and production exclusion checks.

`generate_lessons.py --check` verifies the committed lesson JSON against its
standalone deterministic generator. It never reads `local/test-data/`.
