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
                          models.TMAProgress, models.TMAReviewHistory, models.TMA_Collaborator,
                          models.TMAMedia])
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
            audio_name = f'synthetic-{order}.mp3'
            models.TMAMedia.create(folder='audio', filename=audio_name, content=b'\xff\xfb\x90\x00' + b'\0' * 200)
            models.Card.create(deck=library, content_v2=content, card_type=None, position=order,
                               image_path=f'images/synthetic-{order}.webp',
                               audio_path=f'audio/{audio_name}')
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
        models.TMA_Card.update(content_v2=original).where(models.TMA_Card.deck == migrated.id,
            models.TMA_Card.position == 1).execute()
        verify_cleanup(db)
        raw('ALTER TABLE tma_deck DROP CONSTRAINT tma_deck_scope_owner_check')
        try:
            run_unified_cards_migration(db)
        except MigrationError:
            pass
        else:
            raise AssertionError('Migration accepted drift')
        print('PASS: migration96 rollback/retry/counts/9 types/categories/notes/media/ACL/independent copies/constraints')
        fresh = PostgresqlDatabase(name + '_fresh', **control.connect_params)
        control.execute_sql(f'CREATE DATABASE {name}_fresh')
        try:
            models.tma_db.initialize(fresh)
            models.lerne_db.initialize(fresh)
            with patch('api.models.is_local', return_value=True):
                models._tables_created = False
                models.create_all_tables()
                models._tables_created = False
                models.create_all_tables()
            assert not {'card','deck'} & set(fresh.get_tables())
            assert {93,94,95,96,97} <= {r[0] for r in fresh.execute_sql('SELECT migration_id FROM tma_migration_history')}
            print('PASS: empty LOCAL bootstrap and repeated startup without legacy tables')
        finally:
            fresh.close()
            control.execute_sql(f'DROP DATABASE {name}_fresh')
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
        verify_cleanup(db)
        from tools.native_v2_migrated_apps import verify_copy_roundtrip
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


def verify_cleanup(db):
    import hashlib
    from fastapi import HTTPException
    from api import models
    from api.migrations import MigrationError, run_library_cleanup_migration, run_library_cards_v2_migration, run_unified_cards_migration
    from api.services.sync_generation import generation_state, require_generation, mark_database_restored
    from tools.native_v2_rehearsal import fingerprints
    models.tma_db.initialize(db)
    models.lerne_db.initialize(db)
    protected = fingerprints(db)
    marker = db.execute_sql("SELECT value FROM tmasetting WHERE key='SYNC_DATABASE_RESTORE'").fetchone() if db.table_exists('tmasetting') else None
    db.create_tables([models.TMASetting], safe=True)
    relations = db.execute_sql("""SELECT c.relname,c.oid::bigint FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname IN ('tma_card','card','tmasetting') ORDER BY c.relname""").fetchall()
    old = hashlib.sha256(json.dumps([marker[0] if marker else 'initial', relations], sort_keys=True).encode()).hexdigest()
    # Reject a single changed media link, even when all counts still agree.
    source_id = db.execute_sql("SELECT c.id FROM tma_card c JOIN tma_deck d ON d.id=c.deck_id WHERE d.scope='library' LIMIT 1").fetchone()
    if source_id:
        identifier = source_id[0]
        image = db.execute_sql('SELECT image_path FROM tma_card WHERE id=%s', (identifier,)).fetchone()[0]
        db.execute_sql("UPDATE tma_card SET image_path='images/synthetic-mismatch.webp' WHERE id=%s", (identifier,))
        try:
            try:
                run_library_cleanup_migration(db)
            except MigrationError:
                pass
            else:
                raise AssertionError('Changed media accepted')
            assert db.table_exists('card')
        finally:
            db.execute_sql('UPDATE tma_card SET image_path=%s WHERE id=%s', (image, identifier))
    db.execute_sql('CREATE TABLE cleanup_unknown_fk (id INT REFERENCES card(id))')
    try:
        run_library_cleanup_migration(db)
    except MigrationError:
        pass
    else:
        raise AssertionError('Unknown FK accepted')
    assert db.table_exists('card') and not db.execute_sql('SELECT 1 FROM tma_migration_history WHERE migration_id=97').fetchone()
    db.execute_sql('DROP TABLE cleanup_unknown_fk')
    raw = db.execute_sql
    def fail_history(sql, *args, **kwargs):
        if sql == 'INSERT INTO tma_migration_history(migration_id) VALUES (97)':
            raise RuntimeError('Synthetic failure after DROP')
        return raw(sql, *args, **kwargs)
    with patch.object(db, 'execute_sql', side_effect=fail_history):
        try:
            run_library_cleanup_migration(db)
        except RuntimeError as error:
            assert str(error) == 'Synthetic failure after DROP'
        else:
            raise AssertionError('Late failure swallowed')
    assert db.table_exists('card') and db.table_exists('deck')
    assert not db.execute_sql("SELECT 1 FROM tmasetting WHERE key='SYNC_GENERATION_ANCHOR'").fetchone()
    assert run_library_cleanup_migration(db)['applied']
    assert not run_library_cleanup_migration(db)['applied']
    assert not {'card','deck','progress','reviewhistory','uservoice'} & set(db.get_tables())
    excluded = {'public.' + t for t in ('card','deck','progress','reviewhistory','uservoice','tmasetting','tma_migration_history')}
    assert {k:v for k,v in protected.items() if k not in excluded} == {
        k:v for k,v in fingerprints(db).items() if k not in excluded}, 'Cleanup changed protected user data'
    assert generation_state()['server_generation'] == old
    import subprocess
    from pathlib import Path
    script = """
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import assert from 'node:assert/strict';
import {observeServerGeneration} from './src/services/serverGeneration.js';
const [before, after] = JSON.parse(process.argv[1]);
const db = new Dexie('cleanup-' + crypto.randomUUID());
db.version(1).stores({syncState:'key',cards:'id',card_notes:'id'});
try {
 await db.syncState.put({key:'serverGeneration',generation:before});
 await db.syncState.put({key:'card-create-v2:-1',payload:{request_id:'retained'}});
 await db.cards.put({id:-1,isDirty:true});
 await db.card_notes.put({id:'pending-note',isDirty:true});
 db.close(); await db.open();
 await observeServerGeneration(db,{server_generation:after,restored:false},()=>true);
 assert.equal(await db.syncState.get('serverGenerationConflict'),undefined);
 assert.equal((await db.syncState.get('card-create-v2:-1')).payload.request_id,'retained');
 assert.equal((await db.cards.get(-1)).isDirty,true);
 assert.equal(await db.card_notes.count(),1);
 await assert.rejects(observeServerGeneration(db,{server_generation:'f'.repeat(64),restored:true},()=>true));
 assert.equal((await db.cards.get(-1)).isDirty,true);
} finally {await db.delete();}
"""
    subprocess.run(['node','--input-type=module','-e',script,json.dumps([old,generation_state()['server_generation']])],
                   cwd=Path(__file__).resolve().parents[2] / 'app', check=True, timeout=30)
    with db.atomic() as transaction:
        db.execute_sql('ALTER TABLE tma_deck RENAME TO synthetic_replaced_deck')
        db.execute_sql('CREATE TABLE tma_deck(id INT)')
        assert generation_state()['server_generation'] != old
        transaction.rollback()
    require_generation(old)
    assert not run_unified_cards_migration(db)['applied']
    assert not run_library_cards_v2_migration(db)['applied']
    # Real startup, with only historical SQL already baselined on this synthetic fixture.
    from api.migrations import MIGRATIONS
    for entry in MIGRATIONS:
        db.execute_sql('INSERT INTO tma_migration_history(migration_id) VALUES (%s) ON CONFLICT DO NOTHING', (entry[0],))
    models._tables_created = False
    with patch('api.models.is_local', return_value=False):
        models.create_all_tables()
        models._tables_created = False
        models.create_all_tables()
    assert not {'card','deck'} & set(db.get_tables())
    with db.atomic() as transaction:
        mark_database_restored(db)
        try:
            require_generation(old)
        except HTTPException as error:
            assert error.status_code == 409
        else:
            raise AssertionError('Restore protection lost')
        transaction.rollback()
    assert generation_state()['server_generation'] == old
    print('PASS: cleanup97 strict FK refusal/rollback/retry, legacy generation retained, real restore rejected, repeated startup without retired tables', flush=True)
