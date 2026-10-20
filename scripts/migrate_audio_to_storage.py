"""Audio migration uses the same bounded, verified migration as images."""
if __package__:
    from .migrate_images_to_storage import main
else:
    from migrate_images_to_storage import main

if __name__ == '__main__':
    raise SystemExit(main(folder='audio', bucket='audio'))
