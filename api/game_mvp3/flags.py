"""Fail-closed pilot configuration. No DB initialization or client-selectable flag."""
import os


def isolated():
    return (os.getenv('GAME_MVP3_ISOLATED') == '1' and
            os.getenv('ENVIRONMENT', 'development').strip().lower() != 'production')


def enabled_for(user_id):
    if not isolated() or os.getenv('GAME_MVP3_ENABLED') != '1':
        return False
    # This preparation intentionally supports exactly one explicitly chosen account.
    value = os.getenv('GAME_MVP3_TEST_USER_ID', '')
    return (0 < len(value) <= 19 and value.isascii() and value.isdecimal() and
            0 < int(value) <= 9223372036854775807 and
            type(user_id) is int and user_id == int(value))
