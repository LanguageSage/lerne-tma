"""Synthetic migration 96 regressions; invoked inside the disposable PG runner."""
import json
from unittest.mock import patch
from uuid import uuid4


def verify(control):
    from fastapi import HTTPException
    from peewee import IntegrityError, PostgresqlDatabase
    from api import models
    from api.migrations import (MigrationError, run_card_source_migration,
                                run_library_cards_v2_migration,
                                run_structured_cards_v2_migration, run_unified_cards_migration)
    from api.services import library_import
    from api.services.collaborative_service import get_effective_user_role
    from structured_cards_http import _native_examples

    name = 'unified_storage_test_' + uuid4().hex
    control.execute_sql(f'CREATE DATABASE {name}')
    db = PostgresqlDatabase(name, **control.connect_params)
    previous = models.tma_db.obj, models.lerne_db.obj
    models.tma_db.initialize(db)
    models.lerne_db.initialize(db)
    try:
        db.create_tables([models.LibraryCategory, models.Deck, models.Card, models.TMAUser,
                          models.TMA_Folder, models.TMA_Deck, models.TMA_Card, models.TMACardNote,
                          models.TMAProgress, models.TMAReviewHistory, models.TMA_Collaborator])
        run_structured_cards_v2_migration(db)
        run_library_cards_v2_migration(db)
        run_card_source_migration(db)
        db.execute_sql('ALTER TABLE card ADD COLUMN image_data BYTEA,ADD COLUMN creator_id BIGINT')
        db.execute_sql('ALTER TABLE deck ADD COLUMN author_name TEXT')
        # Reproduce the deployed pre-96 deck catalog, not the new ORM fields.
        db.execute_sql('ALTER TABLE tma_deck DROP COLUMN scope,DROP COLUMN category_id,DROP COLUMN is_default')
        db.execute_sql("""INSERT INTO tma_deck(id,user_id,name,is_deleted,is_inbox,is_pinned,
            position,created_at,metadata) VALUES (123,7,'Personal',false,false,false,0,now(),'{}')""")
        models.TMAUser.create(user_id=7, is_guest=False, default_decks_initialized=True)
        root_category = models.LibraryCategory.create(name='Synthetic root')
        category = models.LibraryCategory.create(name='Synthetic category', parent=root_category)
        library = models.Deck.create(name='Synthetic library', category=category, is_default=True)
        db.execute_sql('UPDATE deck SET author_name=%s WHERE id=%s', ('Synthetic author', library.id))
        samples = _native_examples()
        assert len(samples) == 9
        for order, content in enumerate(samples.values(), 1):
            models.Card.create(deck=library, content_v2=content, card_type=None, position=order,
                               image_path=f'images/synthetic-{order}.webp',
                               audio_path=f'audio/synthetic-{order}.mp3')
        db.execute_sql("UPDATE card SET image_data=%s,creator_id=7 WHERE position=1", (b'synthetic embedded image',))
        personal = models.TMA_Card.create(id=987, deck=123, content_v2=samples['standard'], card_type=None)
        note = models.TMACardNote.create(id=str(uuid4()), card=personal, user_id=7, text='Keep this synthetic note')
        models.TMAProgress.create(card_id=personal.id, user_id=7, queue='review', interval=42)

        raw = db.execute_sql

        def fail_late(sql, *args, **kwargs):
            if sql.startswith('INSERT INTO tma_card(deck_id,'):
                raise RuntimeError('Synthetic copy failure')
            return raw(sql, *args, **kwargs)

        with patch.object(db, 'execute_sql', side_effect=fail_late):
            try:
                run_unified_cards_migration(db)
            except RuntimeError as error:
                assert str(error) == 'Synthetic copy failure'
            else:
                raise AssertionError('Migration failure was swallowed')
        assert 'scope' not in {c.name for c in db.get_columns('tma_deck')}
        assert not raw('SELECT 1 FROM tma_migration_history WHERE migration_id=96').fetchone()
        assert models.TMA_Card.select().count() == 1
        assert models.Card.select().count() == 9
        result = run_unified_cards_migration(db)
        assert result['library_cards'] == 9 and result['library_decks'] == 1
        assert run_unified_cards_migration(db)['applied'] is False
        migrated = models.TMA_Deck.get(models.TMA_Deck.scope == 'library')
        assert migrated.id != library.id and migrated.category_id == category.id and migrated.is_default
        assert migrated.user_id is None and migrated.folder_id is None
        assert json.loads(migrated.metadata)['author_name'] == 'Synthetic author'
        assert models.TMACardNote.get_by_id(note.id).card_id == 987
        assert models.TMAProgress.get(card_id=987, user_id=7).interval == 42
        assert models.TMA_Card.get_by_id(987).deck_id == 123

        imported = library_import.import_deck(migrated.id, 7, mode='copy')
        copied = list(models.TMA_Card.select().where(models.TMA_Card.deck == imported.id).order_by(models.TMA_Card.position))
        assert len(copied) == 9 and imported.scope == 'personal' and imported.category_id is None
        assert {c.content_v2['card']['type'] for c in copied} == samples.keys()
        for order, card in enumerate(copied, 1):
            assert card.image_path == f'images/synthetic-{order}.webp'
            assert card.audio_path == f'audio/synthetic-{order}.mp3'
        assert bytes(copied[0].image_data) == b'synthetic embedded image'
        assert not models.TMAProgress.select().where(models.TMAProgress.card_id.in_([c.id for c in copied])).exists()
        assert not models.TMACardNote.select().where(models.TMACardNote.card.in_([c.id for c in copied])).exists()
        assert get_effective_user_role(7, 'deck', migrated.id) is None
        try:
            library_import.import_deck(123, 7)
        except HTTPException as error:
            assert error.status_code == 404
        else:
            raise AssertionError('Personal deck accepted as library source')

        original = copied[0].content_v2
        changed = json.loads(json.dumps(original))
        changed['card']['explanation'] += ' independent source edit'
        models.TMA_Card.update(content_v2=changed).where(models.TMA_Card.deck == migrated.id,
            models.TMA_Card.position == 1).execute()
        assert models.TMA_Card.get_by_id(copied[0].id).content_v2 == original
        for values in ({'scope': 'library', 'user_id': 7}, {'scope': 'personal'},
                       {'scope': 'personal', 'user_id': 7, 'category_id': category.id},
                       {'scope': 'other', 'user_id': 7}):
            try:
                with db.atomic():
                    models.TMA_Deck.create(name='Invalid synthetic placement', **values)
            except IntegrityError:
                pass
            else:
                raise AssertionError(f'Invalid placement accepted: {values}')
        models.LibraryCategory.delete().where(models.LibraryCategory.id == root_category.id).execute()
        assert not models.LibraryCategory.select().exists()
        assert models.TMA_Deck.get_by_id(migrated.id).category_id is None
        assert models.TMA_Card.select().where(models.TMA_Card.deck == migrated.id).count() == 9
        raw('ALTER TABLE tma_deck DROP CONSTRAINT tma_deck_scope_owner_check')
        try:
            run_unified_cards_migration(db)
        except MigrationError:
            pass
        else:
            raise AssertionError('Migration accepted drift')
        print('PASS: migration96 rollback/retry/counts/9 types/categories/notes/media/ACL/independent copies/constraints')
        return True
    finally:
        db.close()
        models.tma_db.initialize(previous[0])
        models.lerne_db.initialize(previous[1])
        control.execute_sql(f'DROP DATABASE {name}')


def verify_restored(control, binaries, dump, admin_root, output, *, browser=True):
    """Explicit private-data rehearsal; never an input to unattended CI."""
    import os
    from pathlib import Path
    import subprocess
    import sys
    from peewee import PostgresqlDatabase
    from api.migrations import (run_card_rating_migration, run_card_source_migration,
                                run_unified_cards_migration)
    from tools.native_v2_rehearsal import fingerprints

    name = 'rehearsal_unified96'
    assert control.database == 'postgres' and control.connect_params['host'] == '127.0.0.1'
    control.execute_sql(f'CREATE DATABASE {name}')
    for role in ('anon', 'authenticated', 'service_role', 'postgres'):
        control.execute_sql(f'CREATE ROLE {role}')
    env = dict(os.environ, PGHOST='127.0.0.1', PGPORT=str(control.connect_params['port']),
               PGUSER='cards_test', PGSSLMODE='disable', PGOPTIONS='-c max_parallel_maintenance_workers=0')
    suffix = '.exe' if os.name == 'nt' else ''
    with (output / 'unified-restore.log').open('wb') as log:
        subprocess.run([str(binaries / ('pg_restore' + suffix)), '--single-transaction', '--exit-on-error',
                        '--no-owner', '--no-acl', '--dbname', name, str(dump)], env=env, stdout=log,
                       stderr=log, check=True, timeout=180, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    db = PostgresqlDatabase(name, **control.connect_params)
    try:
        run_card_rating_migration(db)
        run_card_source_migration(db)
        before = fingerprints(db)
        personal_decks = dict(db.execute_sql('SELECT id,row_to_json(d) FROM tma_deck d ORDER BY id'))
        personal_cards = db.execute_sql("SELECT encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex') FROM tma_card c ORDER BY c.id").fetchall()
        old_decks = db.execute_sql('SELECT id,row_to_json(d) FROM deck d ORDER BY id').fetchall()
        optional = {'id', 'deck_id', 'cloud_id', 'reserve', 'reserve_topic', 'collected_at', 'want_to_learn', 'share_id'}
        fields = [c.name for c in db.get_columns('card') if c.name not in optional]
        projection = ','.join('c.' + field for field in fields)
        old_cards = db.execute_sql(f'''SELECT d.ord,{projection} FROM card c JOIN
            (SELECT id,row_number() OVER (ORDER BY id) ord FROM deck) d ON d.id=c.deck_id ORDER BY c.id''').fetchall()
        result = run_unified_cards_migration(db)
        assert result['applied'] and result['library_cards'] == len(old_cards)
        assert not run_unified_cards_migration(db)['applied']
        after = fingerprints(db)
        changed = {'public.tma_card', 'public.tma_deck', 'public.tma_migration_history'}
        assert {k: v for k, v in before.items() if k not in changed} == {k: v for k, v in after.items() if k not in changed}
        actual_cards = db.execute_sql("""SELECT encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex')
            FROM tma_card c JOIN tma_deck d ON d.id=c.deck_id WHERE d.scope='personal' ORDER BY c.id""").fetchall()
        assert actual_cards == personal_cards, 'Personal card IDs/content/media changed'
        new_decks = db.execute_sql("SELECT id,row_to_json(d) FROM tma_deck d WHERE scope='library' ORDER BY id").fetchall()
        mapping = {old[0]: new[0] for old, new in zip(old_decks, new_decks, strict=True)}
        for (_, old), (_, new) in zip(old_decks, new_decks, strict=True):
            if old.get('author_name') is not None:
                metadata = json.loads(old['metadata'] or '{}')
                metadata['author_name'] = old['author_name']
                old['metadata'] = json.dumps(metadata, ensure_ascii=False)
            assert {k: v for k, v in old.items() if k not in {'id', 'cloud_id', 'author_name'}} == {
                k: new[k] for k in old if k not in {'id', 'cloud_id', 'author_name'}}
        for identifier, actual in db.execute_sql("SELECT id,row_to_json(d) FROM tma_deck d WHERE scope='personal'"):
            expected = personal_decks[identifier]
            try:
                metadata = json.loads(expected['metadata'] or '{}')
                if isinstance(metadata, dict) and metadata.get('source_library_id') in mapping:
                    metadata['source_library_id'] = mapping[metadata['source_library_id']]
                    expected['metadata'] = json.dumps(metadata, ensure_ascii=False)
            except (ValueError, TypeError):
                pass
            assert {k: actual[k] for k in expected} == expected
        new_cards = db.execute_sql(f'''SELECT d.ord,{projection} FROM tma_card c JOIN
            (SELECT id,row_number() OVER (ORDER BY id) ord FROM tma_deck WHERE scope='library') d
            ON d.id=c.deck_id ORDER BY c.id''').fetchall()
        assert new_cards == old_cards, 'Library content/media/placement changed'
        types = dict(db.execute_sql("SELECT content_v2->'card'->>'type',count(*) FROM tma_card WHERE NOT is_deleted GROUP BY 1"))
        assert len(types) == 9 and None not in types
        print('PASS: restored Supabase migration96', result, 'personal_cards', len(personal_cards), 'nine_types', types, flush=True)
        print('PASS: exact personal card hashes; all library content/media fields; categories, notes and remaining tables unchanged', flush=True)
        sys.path.insert(0, str(admin_root / 'src'))
        verify_copy_roundtrip(db)
        from tools.native_v2_migrated_apps import verify as verify_applications
        applications = verify_applications(db, output, admin_root, browser=browser, smoke=True)
        assert not applications['failures'], applications['failures']
        assert len(applications['tma']) == 9 and applications['library']
        if browser:
            assert applications['browser']['exit_code'] == 0
        assert applications['smoke']['exit_code'] == 0
        print('PASS: nine-type TMA/Admin HTTP roundtrips; Chromium create/edit/media and offline negative-ID delivery', flush=True)
        return True
    finally:
        db.close()


def verify_copy_roundtrip(db):
    """Real library import, scoped pull and JSON roundtrip on the supplied test DB."""
    from fastapi.testclient import TestClient
    from api import models
    from api.auth.service import _create_session, utcnow
    from api.main import app
    from lerne_admin.core.api import models as admin_models
    from lerne_admin.services import native_cards

    models.tma_db.initialize(db)
    models.lerne_db.initialize(db)
    admin_models.tma_db.initialize(db)
    admin_models.lerne_db.initialize(db)
    user = 777000112
    models.TMAUser.get_or_create(user_id=user, defaults={'is_guest': False, 'default_decks_initialized': True})
    account, _ = models.TMAAuthAccount.get_or_create(user=user)
    token = _create_session(account, utcnow()).access_token
    client = TestClient(app, headers={'Authorization': 'Bearer ' + token})
    source_id = db.execute_sql("""SELECT d.id FROM tma_deck d JOIN tma_card c ON c.deck_id=d.id
        WHERE d.scope='library' AND NOT d.is_deleted AND NOT c.is_deleted
        GROUP BY d.id ORDER BY count(*),d.id LIMIT 1""").fetchone()[0]
    response = client.post(f'/api/decks/external/import/{source_id}?mode=copy')
    assert response.status_code == 200, response.text
    target_id = response.json()['deck_id']
    target = models.TMA_Deck.get_by_id(target_id)
    assert target.id != source_id and target.scope == 'personal' and target.category_id is None
    source = list(models.TMA_Card.select().where(models.TMA_Card.deck == source_id,
        models.TMA_Card.is_deleted == False).order_by(models.TMA_Card.position, models.TMA_Card.id))
    copied = list(models.TMA_Card.select().where(models.TMA_Card.deck == target_id,
        models.TMA_Card.is_deleted == False).order_by(models.TMA_Card.position, models.TMA_Card.id))
    assert source and len(copied) == len(source)
    media = ('image_path', 'audio_path', 'audio_back_path', 'video_front_path', 'video_back_path', 'image_data')
    for original, card in zip(source, copied, strict=True):
        assert original.id != card.id and original.content_v2 == card.content_v2
        assert all(getattr(original, field) == getattr(card, field) for field in media)
    exported = json.loads(native_cards.export_document(f'lib_{source_id}')['text'])
    request = {'import_id': str(uuid4()), 'document': exported}
    imported = client.post('/api/decks/import-json', json=request)
    assert imported.status_code == 200, imported.text
    assert client.post('/api/decks/import-json', json=request).json() == imported.json()
    restored_id = imported.json()['deck_id']
    restored = list(models.TMA_Card.select().where(models.TMA_Card.deck == restored_id).order_by(models.TMA_Card.position))
    assert [c.content_v2 for c in restored] == [c.content_v2 for c in source]
    pull = client.get('/api/sync/v2/pull')
    assert pull.status_code == 200, pull.text
    deck_ids = {d['id'] for d in pull.json()['decks']}
    assert target_id in deck_ids and restored_id in deck_ids and source_id not in deck_ids
    assert not models.TMAProgress.select().where(models.TMAProgress.card_id.in_([c.id for c in copied])).exists()
    assert not models.TMACardNote.select().where(models.TMACardNote.card.in_([c.id for c in copied])).exists()
    print('PASS: restored-copy library HTTP import, all media attachments, Admin JSON export/TMA import/replay, scoped offline pull', flush=True)
