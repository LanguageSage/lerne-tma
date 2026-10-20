"""Compatibility entry point. Preserve names and all V2/inline references."""
if __package__:
    from .migrate_images_to_storage import main
else:
    from migrate_images_to_storage import main

if __name__ == '__main__':
    raise SystemExit(main())
