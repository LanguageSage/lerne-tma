"""Library import regression checks in the disposable PostgreSQL CI fixture."""
import json
from datetime import datetime
from unittest import TestCase
from unittest.mock import patch


def verify(models):
    from api.services import library_import
    from scripts.tests.native_fixture import content as v2_content

    assert models.tma_db.obj is models.lerne_db.obj
    db = models.tma_db
    owner, learner = 912001, 912002
    old_time = datetime(2020, 1, 1)
    expected_error = TestCase().assertRaisesRegex

    for uid in (owner, learner):
        models.TMAUser.get_or_create(user_id=uid, defaults={'is_guest': False, 'default_decks_initialized': True})

    def seed(name, *, deck_deleted=False, card_deleted=False, matching=False):
        library = models.TMA_Deck.create(scope='library', name=name, target_language='uk')
        deck = models.TMA_Deck.create(scope='personal', user_id=owner, name=name, is_deleted=deck_deleted,
                                      target_language='de', metadata='{"custom": 7}', updated_at=old_time)
        card = models.TMA_Card.create(deck=deck, content_v2=v2_content('Matching' if matching else 'Old', 'Local back'),
                                      card_type=None, is_deleted=card_deleted, updated_at=old_time)
        for user_id in (owner, learner):
            models.TMAProgress.create(card_id=card.id, user_id=user_id, queue='review',
                                      interval=17, repetitions=4, flag=3, want_to_learn=True)
            models.TMAReviewHistory.create(card_id=card.id, user_id=user_id, rating=3, scheduled_interval=17)
        return library, deck, card

    def snapshot(*tables):
        return [list(table.select().order_by(table._meta.primary_key).dicts()) for table in tables]

    content = (models.TMA_Deck, models.TMA_Card, models.TMAProgress, models.TMAReviewHistory)
    progress = (models.TMAProgress, models.TMAReviewHistory)

    for mode, force_trash in (('replace', False), ('merge', False), ('merge', True)):
        library, deck, card = seed(f'Atomic import {mode} {force_trash}', deck_deleted=force_trash,
                                   card_deleted=mode == 'merge')
        models.TMA_Card.create(deck=library, content_v2=v2_content('Imported', 'Remote back'), card_type=None)
        before = snapshot(*content)

        def fail_after_copy(*_args, **_kwargs):
            active = list(models.TMA_Card.select().where(
                models.TMA_Card.deck == deck.id, models.TMA_Card.is_deleted == False))
            assert [c.content_v2['card']['data']['prompt'] for c in active] == ['Imported']
            if force_trash:
                assert not models.TMA_Deck.get_by_id(deck.id).is_deleted
            raise RuntimeError('fixture failure after copy')

        with patch('api.services.collaborative_service.touch_deck_and_parent_folders', side_effect=fail_after_copy):
            with expected_error(Exception, 'fixture failure after copy'):
                library_import.import_deck(library.id, owner, mode=mode, force_trash=force_trash)
        assert snapshot(*content) == before, (mode, force_trash)

        imported = library_import.import_deck(library.id, owner, mode=mode, force_trash=force_trash)
        assert imported.id == deck.id
        assert not imported.is_deleted and imported.target_language == 'uk'
        assert json.loads(imported.metadata)['source_library_id'] == library.id
        cards = models.TMA_Card.select().where(
            models.TMA_Card.deck == imported, models.TMA_Card.is_deleted == False)
        assert [item.content_v2['card']['data']['prompt'] for item in cards] == ['Imported']
        assert snapshot(models.TMAReviewHistory)[0] == before[-1]
        assert snapshot(models.TMAProgress)[0] == before[-2]

    library, deck, card = seed('Atomic incremental import', matching=True)
    models.TMA_Card.create(deck=library, content_v2=v2_content('Matching', 'Local back'),
                           card_type=None, image_path='synthetic.webp', updated_at=datetime(2021, 1, 1))
    models.TMA_Card.create(deck=library, content_v2=v2_content('Rejected insert', 'Remote back'), card_type=None)
    before = snapshot(*content)
    db.execute_sql(f"""ALTER TABLE tma_card ADD CONSTRAINT import_fixture_insert
                       CHECK (deck_id <> {int(deck.id)} OR content_v2->'card'->'data'->>'prompt' <> 'Rejected insert')""")
    try:
        with expected_error(Exception, 'import_fixture_insert'):
            library_import.import_deck(library.id, owner)
        assert snapshot(*content) == before
    finally:
        db.execute_sql('ALTER TABLE tma_card DROP CONSTRAINT import_fixture_insert')

    before_progress = snapshot(*progress)
    assert library_import.import_deck(library.id, owner).id == deck.id
    assert models.TMA_Card.get_by_id(card.id).image_path == 'synthetic.webp'
    assert models.TMA_Card.select().where(models.TMA_Card.deck == deck).count() == 2
    assert snapshot(*progress) == before_progress

    # Reject the final deck write after a copy has inserted its cards.
    library = models.TMA_Deck.create(scope='library', name='Atomic copy import')
    models.TMA_Card.create(deck=library, content_v2=v2_content('Copied card', 'Remote back'), card_type=None)
    before = snapshot(*content)
    db.execute_sql("""ALTER TABLE tma_deck ADD CONSTRAINT import_fixture_metadata
                      CHECK (name <> 'Atomic copy import (v2)' OR strpos(metadata, 'source_library_id') = 0)""")
    try:
        with expected_error(Exception, 'import_fixture_metadata'):
            library_import.import_deck(library.id, owner, mode='copy')
        assert snapshot(*content) == before
    finally:
        db.execute_sql('ALTER TABLE tma_deck DROP CONSTRAINT import_fixture_metadata')

    print('PASS: PostgreSQL library import rollback after copy, insert and metadata failures, '
          'successful retries and progress preservation', flush=True)
