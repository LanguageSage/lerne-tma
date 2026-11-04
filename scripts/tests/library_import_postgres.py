"""Library import regression checks in the disposable PostgreSQL CI fixture."""
import json
from datetime import datetime
from unittest import TestCase
from unittest.mock import patch


def verify(models):
    from api.services import library_import

    assert models.tma_db.obj is models.lerne_db.obj
    db = models.tma_db
    owner, learner = 912001, 912002
    old_time = datetime(2020, 1, 1)
    expected_error = TestCase().assertRaisesRegex

    def seed(name, *, deck_deleted=False, card_deleted=False, matching=False):
        library = models.Deck.create(name=name, target_language='uk')
        deck = models.TMA_Deck.create(user_id=owner, name=name, is_deleted=deck_deleted,
                                      target_language='de', metadata='{"custom": 7}', updated_at=old_time)
        card = models.TMA_Card.create(deck=deck, front_text='Matching' if matching else 'Old',
                                      back_text='Local back', is_deleted=card_deleted, updated_at=old_time)
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
        models.Card.create(deck=library, front_text='Imported', back_text='Remote back')
        before = snapshot(*content)

        def fail_after_delete(*_):
            assert models.TMA_Card.get_or_none(models.TMA_Card.id == card.id) is None
            assert not models.TMAProgress.select().where(models.TMAProgress.card_id == card.id).exists()
            if force_trash:
                assert models.TMA_Deck.get_or_none(models.TMA_Deck.id == deck.id) is None
            raise RuntimeError('fixture failure after deletion')

        with patch.object(library_import, '_bulk_copy_cards_from_library', side_effect=fail_after_delete):
            with expected_error(Exception, 'fixture failure after deletion'):
                library_import.import_deck(library.id, owner, mode=mode, force_trash=force_trash)
        assert snapshot(*content) == before, (mode, force_trash)

        imported = library_import.import_deck(library.id, owner, mode=mode, force_trash=force_trash)
        assert (imported.id != deck.id) == force_trash
        assert not imported.is_deleted and imported.target_language == 'uk'
        assert json.loads(imported.metadata)['source_library_id'] == library.id
        cards = models.TMA_Card.select().where(models.TMA_Card.deck == imported)
        assert [item.front_text for item in cards] == ['Imported']
        assert not models.TMAProgress.select().where(models.TMAProgress.card_id == card.id).exists()
        assert snapshot(models.TMAReviewHistory)[0] == before[-1]

    library, deck, card = seed('Atomic incremental import', matching=True)
    models.Card.create(deck=library, front_text='Matching', back_text='Remote back',
                       updated_at=datetime(2021, 1, 1))
    models.Card.create(deck=library, front_text='Rejected insert', back_text='Remote back')
    before = snapshot(*content)
    db.execute_sql("""ALTER TABLE tma_card ADD CONSTRAINT import_fixture_insert
                      CHECK (front_text <> 'Rejected insert')""")
    try:
        with expected_error(Exception, 'import_fixture_insert'):
            library_import.import_deck(library.id, owner)
        assert snapshot(*content) == before
    finally:
        db.execute_sql('ALTER TABLE tma_card DROP CONSTRAINT import_fixture_insert')

    before_progress = snapshot(*progress)
    assert library_import.import_deck(library.id, owner).id == deck.id
    assert models.TMA_Card.get_by_id(card.id).back_text == 'Remote back'
    assert models.TMA_Card.select().where(models.TMA_Card.deck == deck).count() == 2
    assert snapshot(*progress) == before_progress

    # Reject the final deck write after a copy has inserted its cards.
    library = models.Deck.create(name='Atomic copy import')
    models.Card.create(deck=library, front_text='Copied card', back_text='Remote back')
    before = snapshot(*content)
    db.execute_sql("""ALTER TABLE tma_deck ADD CONSTRAINT import_fixture_metadata
                      CHECK (name <> 'Atomic copy import (v2)' OR strpos(metadata, 'source_library_id') = 0)""")
    try:
        with expected_error(Exception, 'import_fixture_metadata'):
            library_import.import_deck(library.id, owner, mode='copy')
        assert snapshot(*content) == before
    finally:
        db.execute_sql('ALTER TABLE tma_deck DROP CONSTRAINT import_fixture_metadata')

    print('PASS: PostgreSQL library import rollback after deletion, insert and metadata failures, '
          'successful retries and progress preservation', flush=True)
