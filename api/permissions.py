"""Shared platform administrator policy; authentication stays with its callers."""
import os


def is_admin(user_id: int) -> bool:
    """Check the configured account ID, preserving the existing default admin."""
    try:
        admin_id = int(os.environ.get('ADMIN_USER_ID', '642478257'))
    except ValueError:
        return False
    return user_id == admin_id
