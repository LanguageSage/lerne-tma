"""Bidirectional archive compatibility test between real Lerne Admin Python and Android Offline JS."""

from contextlib import redirect_stderr
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import wave
import zipfile

REPO_ROOT = Path(__file__).resolve().parents[2]
LERNE_ADMIN_ROOT = Path(r'C:\121\Lerne_projekt\lerne-admin')

for extra_path in (str(LERNE_ADMIN_ROOT), str(LERNE_ADMIN_ROOT / 'src')):
    if extra_path not in sys.path:
        sys.path.insert(0, extra_path)

os.environ.setdefault('LERNE_ADMIN_ALLOW_LOCAL', '1')

from peewee import SqliteDatabase
from PIL import Image

from lerne_admin.core import compatibility as compat
from lerne_admin.core.api import models
from lerne_admin.services import material_archive as admin_archive
from lerne_admin.services.material_transfer import Endpoint
from lerne_admin.services.native_cards import validate_envelope
from tests.helpers import native_sqlite

TABLES = [
    models.TMAUser,
    models.TMA_Folder,
    models.TMA_Deck,
    models.TMA_Card,
    models.TMA_Collaborator,
    models.TMAProgress,
    models.TMAReviewHistory,
    models.TMAOfflineBatch,
    models.TMAMedia,
    models.TMASetting,
    models.LibraryCategory,
]


def make_png_bytes(color, size=(12, 12)):
    buf = io.BytesIO()
    Image.new('RGB', size, color).save(buf, format='PNG')
    return buf.getvalue()


def make_wav_bytes(samples=400):
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(8000)
        wf.writeframes(b'\x01\x00' * samples)
    return buf.getvalue()


def make_mp3_bytes():
    return b'\xff\xfb\x90\x00' * 64


def init_disposable_db(db, actor_id, first_name='Admin Author', username='admin_author'):
    models.tma_db.initialize(db)
    models.lerne_db.initialize(db)
    db.create_tables(TABLES)
    models.TMAUser.create(user_id=actor_id, first_name=first_name, username=username, is_guest=False)


class AndroidAdminArchiveCompatTests(unittest.TestCase):
    def setUp(self):
        native_sqlite(self)
        self.temp_dir = Path(tempfile.mkdtemp(prefix='lerne-android-compat-'))
        self.addCleanup(lambda: shutil.rmtree(self.temp_dir, ignore_errors=True))
        self.src_media = self.temp_dir / 'src_media'
        self.dst_media = self.temp_dir / 'dst_media'
        self.src_media.mkdir(parents=True, exist_ok=True)
        self.dst_media.mkdir(parents=True, exist_ok=True)

        self.src_db = SqliteDatabase(':memory:')
        self.dst_db = SqliteDatabase(':memory:')
        init_disposable_db(self.src_db, 42, first_name='Course Author', username='course_author')
        init_disposable_db(self.dst_db, 84, first_name='Restore Owner', username='restore_owner')
        self.addCleanup(self.src_db.close)
        self.addCleanup(self.dst_db.close)

        self.src_endpoint = Endpoint(self.src_db, 'LOCAL:admin-source', 42, media_root=self.src_media, admin_read=True)
        self.dst_endpoint = Endpoint(self.dst_db, 'LOCAL:admin-restore', 84, media_root=self.dst_media)

    def _write_media(self, root_dir, rel_path, data):
        folder, filename = rel_path.split('/', 1)
        target = root_dir / folder / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        models.TMAMedia.create(folder=folder, filename=filename, content=data)
        return f'/api/media/{folder}/{filename}'

    def _seed_admin_source(self):
        blobs = {
            'images/card.png': make_png_bytes((120, 40, 210)),
            'images/layout.png': make_png_bytes((20, 170, 110)),
            'images/inline.png': make_png_bytes((220, 120, 20)),
            'audio/front.wav': make_wav_bytes(420),
            'audio/deck.wav': make_wav_bytes(320),
            'audio/back.mp3': make_mp3_bytes(),
        }
        with self.src_endpoint.scope(), compat.native_cards_write_scope(library=True):
            for rel, raw in blobs.items():
                self._write_media(self.src_media, rel, raw)

            category = models.LibraryCategory.create(name='Compat Catalog')
            root_folder = models.TMA_Folder.create(
                user_id=42, name='Kurs A1 Root', color='#6366f1', target_language='de', position=0
            )
            child_folder = models.TMA_Folder.create(
                user_id=42, name='Lektion 1', color='#10b981', target_language='de', position=0, parent=root_folder
            )
            personal_deck = models.TMA_Deck.create(
                user_id=42,
                name='Alltag Dialoge',
                level='A1',
                topic='Einkauf',
                target_language='de',
                folder=child_folder,
                position=0,
                scope='personal',
                metadata=json.dumps({
                    'intro': {'title': 'Dialoge', 'level': 'A1'},
                    'resources': [{'type': 'audio', 'label': 'Dialog Track', 'url': '/api/media/audio/deck.wav'}],
                }, ensure_ascii=False),
            )
            library_deck = models.TMA_Deck.create(
                user_id=None,
                name='Artikel Reference',
                level='A1',
                topic='Artikel',
                target_language='de',
                folder=None,
                position=1,
                scope='library',
                category_id=category.id,
                is_default=True,
                metadata=json.dumps({'resources': []}, ensure_ascii=False),
            )

            card1_env = validate_envelope({
                'schema_version': 2,
                'card': {
                    'type': 'standard',
                    'level': 'A1',
                    'image': 'images/card.png',
                    'info': [{'type': 'task', 'text': 'Посмотрите фото ![inline](/api/media/images/inline.png)'}],
                    'layout': [
                        {'id': 'lay_img', 'type': 'image', 'path': 'images/layout.png', 'alt': 'Scene'},
                        {'id': 'lay_info', 'type': 'info', 'index': 0},
                        {'id': 'lay_ex', 'type': 'exercise'},
                    ],
                    'data': {'prompt': 'der Kaffee', 'answer': 'кофе'},
                    'explanation': 'Запоминаем: ![card](/api/media/images/card.png)',
                    'metadata': {'resources': [{'type': 'audio', 'url': '/api/media/audio/front.wav', 'label': 'Audio'}]},
                },
            })
            models.TMA_Card.create(
                deck=personal_deck,
                creator_id=42,
                position=0,
                source='admin',
                content_v2=card1_env,
                image_path='/api/media/images/card.png',
                audio_path='/api/media/audio/front.wav',
                audio_back_path='/api/media/audio/back.mp3',
            )

            card2_env = validate_envelope({
                'schema_version': 2,
                'card': {
                    'type': 'free_text',
                    'level': 'A1',
                    'data': {
                        'prompt': 'Переведите: Доброе утро',
                        'sample_answer': 'Guten Morgen',
                        'accepted_answers': ['guten morgen'],
                        'grading_policy': {'mode': 'exact'},
                    },
                },
            })
            models.TMA_Card.create(
                deck=personal_deck,
                creator_id=42,
                position=1,
                source='admin',
                content_v2=card2_env,
            )

            card3_env = validate_envelope({
                'schema_version': 2,
                'card': {
                    'type': 'quiz',
                    'level': 'A1',
                    'data': {
                        'prompt': 'Какой артикль у слова Wasser?',
                        'options': [
                            {'text': 'das', 'correct': True},
                            {'text': 'der', 'correct': False},
                        ],
                    },
                },
            })
            models.TMA_Card.create(
                deck=library_deck,
                creator_id=None,
                position=0,
                source='admin',
                content_v2=card3_env,
            )

            return root_folder.id, personal_deck.id, library_deck.id, blobs

    def _build_v3_zip_from_v4(self, v4_path, v3_path):
        with zipfile.ZipFile(v4_path) as zin:
            parts = {name: zin.read(name) for name in zin.namelist()}
        doc = json.loads(parts['manifest.json'].decode('utf-8'))
        doc['version'] = 3
        doc['source'] = 'LOCAL:' + hashlib.sha256(b'admin-v3-source').hexdigest()
        # V3 only contained personal decks without scope / category_id / is_default fields
        personal_decks = [d for d in doc['content']['deck'] if d['values'].get('scope') != 'library']
        personal_deck_ids = {d['id'] for d in personal_decks}
        for d in personal_decks:
            for field in ('scope', 'category_id', 'is_default'):
                d['values'].pop(field, None)
        doc['content']['deck'] = personal_decks
        doc['content']['card'] = [c for c in doc['content']['card'] if c['values']['deck_id'] in personal_deck_ids]

        raw_manifest = json.dumps(doc).encode('utf-8')
        referenced = set()
        for match in admin_archive.TOKEN.findall(raw_manifest.decode('utf-8')):
            referenced.add(match.removeprefix('archive://'))
        doc['assets'] = [a for a in doc['assets'] if a['sha256'] in referenced]

        encoded = admin_archive.canonical(doc)
        sha_bytes = hashlib.sha256(encoded).hexdigest().encode('ascii')
        with zipfile.ZipFile(v3_path, 'w', compression=zipfile.ZIP_DEFLATED) as zout:
            zout.writestr('manifest.json', encoded)
            zout.writestr('manifest.sha256', sha_bytes)
            for asset in doc['assets']:
                zout.writestr(asset['path'], parts[asset['path']])

    def test_bidirectional_admin_python_and_android_js_roundtrip(self):
        root_folder_id, _, library_deck_id, source_blobs = self._seed_admin_source()

        v4_zip = self.temp_dir / 'admin_v4.zip'
        v3_zip = self.temp_dir / 'admin_v3.zip'
        android_export_zip = self.temp_dir / 'android_export.zip'

        # Export authentic v4 ZIP via real Admin Python archiver
        summary_v4 = admin_archive.export_archive(
            self.src_endpoint, v4_zip, [root_folder_id], select_all=True, deck_ids=[library_deck_id]
        )
        self.assertEqual(summary_v4['counts'], {'folder': 2, 'deck': 2, 'card': 3})
        self.assertEqual(summary_v4['media_count'], 6)

        # Build authentic v3 archive variant
        self._build_v3_zip_from_v4(v4_zip, v3_zip)

        # Run real Android Offline JS import + re-import + SRS preservation + built-in + imported export
        app_root_url = (REPO_ROOT / 'app' / 'src').as_uri()
        runner_script = f"""
import assert from 'node:assert/strict';
import fs from 'node:fs';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import {{ mock }} from 'node:test';
import {{ registerHooks }} from 'node:module';

registerHooks({{
  resolve(specifier, context, next) {{
    try {{
      return next(specifier, context);
    }} catch (error) {{
      if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\\.[a-z]+$/.test(specifier)) {{
        return next(`${{specifier}}.js`, context);
      }}
      throw error;
    }}
  }},
}});

const mem = new Map();
globalThis.localStorage = {{
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
  clear: () => mem.clear(),
}};
globalThis.window = {{ location: {{ search: '', hostname: 'localhost', port: '', origin: 'https://localhost' }}, Capacitor: null }};

const standaloneUrl = '{app_root_url}/utils/standaloneMode.js';
const apiConfigUrl = '{app_root_url}/services/apiConfig.js';
const resolverUrl = '{app_root_url}/pilot/offlineMediaResolver.js';

mock.module(standaloneUrl, {{
  namedExports: {{
    IS_STANDALONE: true,
    STANDALONE_APPLICATION_ID: 'com.lerne.offlinepilot',
    STANDALONE_USER_ID: 900001,
    STANDALONE_SESSION_IDENTITY: 'standalone-offline-pilot',
    STANDALONE_DB_PREFIX: 'LerneStandaloneDB',
    STANDALONE_PROFILE_NAME_KEY: 'lerne_standalone_profile_name',
    getStandaloneProfileName: () => 'Offline Pilot',
    saveStandaloneProfileName: name => name || 'Offline Pilot',
    getStandaloneProfile: () => ({{ user_id: 900001, first_name: 'Offline Pilot', username: 'offline_pilot', is_guest: false, active_language: 'de', has_selected_language: true, is_standalone: true }}),
  }},
}});

const {{ isOfflineMediaUrl, resolveOfflineMediaUrlSync }} = await import(resolverUrl);
mock.module(apiConfigUrl, {{
  namedExports: {{
    API_BASE_URL: '/api',
    mediaURL: (p, kind = 'images') => (!p ? null : isOfflineMediaUrl(p) ? p : resolveOfflineMediaUrlSync(p, kind)),
  }},
}});

const {{ inspectArchiveWebBytes, confirmArchiveImport, buildWebArchiveZipBytes }} = await import('{app_root_url}/pilot/materialArchiveTransport.js');
const {{ initOfflineMediaStore }} = await import('{app_root_url}/pilot/offlineMediaStore.js');
const {{ ensureStandaloneSeed }} = await import('{app_root_url}/pilot/standaloneSeed.js');
const {{ getStandalonePack }} = await import('{app_root_url}/pilot/standalonePack.js');
const {{ calculateCardReview }} = await import('{app_root_url}/utils/srsEngine.js');

function openDb(name) {{
  const db = new Dexie(name);
  db.version(1).stores({{ decks: 'id, user_id, name, is_deleted, is_dirty', cards: 'id, deck_id, front_text, is_deleted, is_dirty', progress: '[card_id+user_id], user_id, card_id, next_review, is_dirty' }});
  db.version(2).stores({{ folders: 'id, user_id, name, is_deleted, is_dirty', decks: 'id, user_id, folder_id, name, is_deleted, is_dirty', cards: 'id, deck_id, front_text, is_deleted, is_dirty', progress: '[card_id+user_id], user_id, card_id, next_review, is_dirty' }});
  db.version(3).stores({{ syncState: 'key', media: 'url' }});
  db.version(4).stores({{ knowledge_items: 'id, language, category', card_knowledge_items: '[card_id+knowledge_item_id], card_id, knowledge_item_id, role', knowledge_attempt_outbox: 'client_event_id, user_id, knowledge_item_id, sync_status, created_locally_at', user_knowledge_state: '[user_id+knowledge_item_id], user_id, knowledge_item_id' }});
  db.version(5).stores({{ card_notes: 'id, card_id, is_dirty' }});
  return db;
}}

const db = openDb('LerneStandaloneDB_900001');
await db.open();
await initOfflineMediaStore(db);

// 1. Seed built-in pilot decks first (realistic Android device state)
await ensureStandaloneSeed({{ db, userId: 900001, pack: getStandalonePack() }});

// 2. Import real Admin v4 ZIP
const v4Bytes = new Uint8Array(fs.readFileSync({json.dumps(str(v4_zip))}));
const v4Inspect = await inspectArchiveWebBytes(v4Bytes, 'admin_v4.zip', {{ db, userId: 900001 }});
assert.equal(v4Inspect.ok, true, v4Inspect.error);
const v4Res = await confirmArchiveImport(v4Inspect, {{ db, userId: 900001 }});
assert.equal(v4Res.importedFolders, 2);
assert.equal(v4Res.importedDecks, 2);
assert.equal(v4Res.importedCards, 3);
assert.equal(v4Res.mediaCount, 6);

// Record SRS & re-import v4 -> preserves progress and zero duplicates
const personalDeck = (await db.decks.toArray()).find(d => d.name === 'Alltag Dialoge');
const firstCard = (await db.cards.where('deck_id').equals(personalDeck.id).toArray()).find(c => c.content_v2.card.type === 'standard');
const reviewed = calculateCardReview({{
  card_id: firstCard.id, user_id: 900001, queue: 'new', step_index: 0, interval: 0, ease_factor: 2.5, repetitions: 0, lapses: 0,
}}, 3, false, 'scheduled', new Date('2026-11-21T08:00:00Z'));
await db.progress.put(reviewed);

const reInspect = await inspectArchiveWebBytes(v4Bytes, 'admin_v4.zip', {{ db, userId: 900001 }});
assert.equal(reInspect.inspection.preview.isReimport, true);
assert.equal(reInspect.inspection.preview.preservedProgressCount, 1);
await confirmArchiveImport(reInspect, {{ db, userId: 900001 }});
assert.equal((await db.progress.get([firstCard.id, 900001])).interval, reviewed.interval);
assert.equal(await db.cards.count(), 33);

// 3. Test Admin v3 archive normalization on clean Dexie DB
const dbV3 = openDb('LerneStandaloneDB_900002');
await dbV3.open();
const v3Bytes = new Uint8Array(fs.readFileSync({json.dumps(str(v3_zip))}));
const v3Inspect = await inspectArchiveWebBytes(v3Bytes, 'admin_v3.zip', {{ db: dbV3, userId: 900001 }});
assert.equal(v3Inspect.ok, true, v3Inspect.error);
assert.equal(v3Inspect.inspection.originalVersion, 3);
const v3Res = await confirmArchiveImport(v3Inspect, {{ db: dbV3, userId: 900001 }});
assert.equal(v3Res.importedDecks, 1);
const v3Deck = (await dbV3.decks.toArray())[0];
assert.equal(v3Deck.standalone_deck_scope, 'personal');

// 4. Selective export from Android JS: imported root folder + built-in pilot deck 9101 -> ZIP
const rootFolder = (await db.folders.toArray()).find(f => f.name === 'Kurs A1 Root');
const exported = await buildWebArchiveZipBytes({{
  db,
  folderIds: [rootFolder.id],
  deckIds: [9101],
}});
fs.writeFileSync({json.dumps(str(android_export_zip))}, exported.zipBytes);
console.log(JSON.stringify({{ exportedFile: exported.fileName, counts: exported.summary.counts, media: exported.summary.mediaCount }}));
"""

        proc = subprocess.run(
            ['node', '--input-type=module', '--import', '../scripts/tests/no-network.mjs', '--experimental-test-module-mocks', '-'],
            cwd=str(REPO_ROOT / 'app'),
            input=runner_script,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 0, f'Node compat runner failed:\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}')

        # Direction 2: Validate Android-exported ZIP directly with real Admin Python archiver
        restored_doc, restored_blobs = admin_archive.read_archive(android_export_zip)
        self.assertEqual(restored_doc['format'], 'lerne-materials')
        self.assertEqual(restored_doc['version'], 4)
        self.assertRegex(restored_doc['source'], r'^LOCAL:[a-f0-9]{64}$')
        self.assertEqual(len(restored_doc['content']['folder']), 2)
        # Expects 2 decks: imported 'Alltag Dialoge' (personal) + built-in 'Alltag & Kommunikation (A2)'
        self.assertEqual(len(restored_doc['content']['deck']), 2)
        # Expects 2 cards from 'Alltag Dialoge' + 12 cards from built-in A2 deck = 14
        self.assertEqual(len(restored_doc['content']['card']), 14)
        self.assertEqual(len(restored_blobs), 6)

        expected_hashes = {hashlib.sha256(b).hexdigest(): b for b in source_blobs.values()}
        self.assertEqual(set(restored_blobs.keys()), set(expected_hashes.keys()))
        for sha, raw in expected_hashes.items():
            self.assertEqual(restored_blobs[sha], raw)

        # Preview & Apply full restore into fresh disposable Admin SQLite DB
        authors = admin_archive.summary(restored_doc)['source_authors']
        owners = {str(a): self.dst_endpoint.user_id for a in authors}
        plan = admin_archive.preview_restore(self.dst_endpoint, android_export_zip, 'From Android', owners)
        self.assertTrue(plan['can_apply'], f'Admin restore blockers: {plan["blockers"]}')
        self.assertEqual(plan['blockers'], [])

        restore_result = admin_archive.apply_restore(
            self.dst_endpoint, android_export_zip, plan['root_name'], plan['token'], plan['owner_map']
        )
        self.assertEqual(restore_result['status'], 'complete')
        self.assertEqual(restore_result['counts'], {'folder': 2, 'deck': 2, 'card': 14})
        self.assertEqual(restore_result['media_count'], 6)

        with self.dst_endpoint.scope():
            restored_decks = {d.name: d for d in models.TMA_Deck.select()}
            self.assertIn('Alltag Dialoge', restored_decks)
            self.assertIn('Alltag & Kommunikation (A2)', restored_decks)
            dialog_deck = restored_decks['Alltag Dialoge']
            dialog_meta = json.loads(dialog_deck.metadata)
            self.assertTrue(dialog_meta['resources'][0]['url'].startswith('/api/media/audio/archive_'))

            dialog_cards = list(models.TMA_Card.select().where(models.TMA_Card.deck == dialog_deck.id).order_by(models.TMA_Card.position))
            self.assertEqual(len(dialog_cards), 2)
            self.assertTrue(dialog_cards[0].image_path.startswith('/api/media/images/archive_'))
            self.assertTrue(dialog_cards[0].audio_path.startswith('/api/media/audio/archive_'))
            self.assertTrue(dialog_cards[0].audio_back_path.startswith('/api/media/audio/archive_'))
            self.assertTrue(dialog_cards[0].content_v2['card']['image'].startswith('images/archive_'))
            self.assertTrue(dialog_cards[0].content_v2['card']['layout'][0]['path'].startswith('images/archive_'))
            self.assertEqual(dialog_cards[1].content_v2['card']['type'], 'free_text')

            for asset in restored_doc['assets']:
                media_file = self.dst_media / asset['folder'] / asset['filename']
                self.assertEqual(media_file.read_bytes(), expected_hashes[asset['sha256']])


if __name__ == '__main__':
    # Suppress benign SUPABASE_DB_URL missing banner only if needed; keep stdout clean
    with io.StringIO() as _buf:
        pass
    unittest.main(verbosity=2)
