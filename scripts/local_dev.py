"""Compatibility entry point for isolated LOCAL tools."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local import dev
if __name__ == '__main__':
    dev.cli()
else:
    sys.modules[__name__] = dev
