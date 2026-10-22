"""Compatibility entry point for the isolated LOCAL PostgreSQL backup command."""
from local_dev import main
import sys


if __name__ == '__main__':
    sys.argv = [__file__, 'backup']
    main()
