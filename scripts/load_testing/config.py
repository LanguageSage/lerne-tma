"""Configuration constants and defaults for load testing suite."""
from pathlib import Path

# Base user ID namespace for synthetic load test accounts to avoid any collision
BASE_USER_ID = 980000000
MAX_TEST_USERS = 120

# Standard concurrency tiers as specified in task requirements
DEFAULT_CONCURRENCY_TIERS = [1, 10, 50, 100]

# Default test duration per tier in seconds
DEFAULT_STAGE_DURATION = 15.0

# Network and server defaults
DEFAULT_TARGET_URL = "http://127.0.0.1:8000"
DEFAULT_TIMEOUT = 10.0
DEFAULT_THINK_TIME = 0.0  # 0 for max stress test, or > 0 for paced user simulation

# Data defaults
DEFAULT_CARDS_PER_DECK = 30

# File paths in ignored local/test-data/ directory
REPO_ROOT = Path(__file__).resolve().parents[2]
LOCAL_TEST_DATA = REPO_ROOT / "local" / "test-data"
USERS_CACHE_FILE = LOCAL_TEST_DATA / "load_test_users.json"
RESULTS_DIR = LOCAL_TEST_DATA / "load_test_results"

# Supported scenarios
SCENARIO_STUDY = "study"
SCENARIO_READ = "read"
SCENARIO_SYNC = "sync"
SCENARIO_MIXED = "mixed"

ALL_SCENARIOS = (SCENARIO_STUDY, SCENARIO_READ, SCENARIO_SYNC, SCENARIO_MIXED)
