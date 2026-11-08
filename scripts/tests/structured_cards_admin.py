"""Optional same-row TMA/Admin acceptance on a fresh disposable PostgreSQL.

Requires an explicit native Admin checkout and its reviewed card-core wheel
installed in the interpreter. No sibling discovery or production configuration.
Only the native Admin router is mounted: its launch/Host perimeter is not tested.
"""
import argparse
import os
from pathlib import Path
import sys
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]


def verify(client, models, headers, _load_answer_context):
    from api.main import app
    from lerne_admin.core.api import models as admin_models
    from lerne_admin.core.compatibility import guard_database
    from lerne_admin.routers.cards import router
    from lerne_admin.routers.author import router as author_router
    from peewee import PostgresqlDatabase
    from structured_cards_http import _native_examples, _card_state

    database = models.tma_db.obj
    admin_db = PostgresqlDatabase(database.database, **database.connect_params)
    admin_models.tma_db.initialize(admin_db)
    admin_models.lerne_db.initialize(admin_db)
    guard_database(admin_db)
    app.include_router(router)
    app.include_router(author_router)

    def request(method, path, body=None, status=200):
        result = client.request(method, path, headers=headers[1], json=body)
        assert result.status_code == status, (path, result.status_code, result.text)
        return result.json()

    def links(cid):
        return {key: value for key, value in _card_state(models, cid).items() if key != 'card'}

    try:
        deck = models.TMA_Deck.create(user_id=1, name='Synthetic cross-editor acceptance', target_language='de')
        models.TMAMedia.create(folder='images', filename='cross-editor.webp', content=b'synthetic bytes')
        for kind, content in _native_examples().items():
            content['card']['info'] = [{'type': 'task', 'text': 'Vorher.\nZweite Zeile.'}, {'type': 'text', 'text': 'Nachher.'}]
            content['card']['layout'] = [
                {'id': 'intro', 'type': 'info', 'index': 0, 'visibility': 'before_answer'},
                {'id': 'picture', 'type': 'image', 'path': 'images/cross-editor.webp', 'alt': 'Haus', 'caption': 'Bild', 'visibility': 'before_answer'},
                {'id': 'exercise', 'type': 'exercise'}, {'id': 'feedback', 'type': 'info', 'index': 1, 'visibility': 'after_answer'}]
            if content['card'].get('topics') is None:
                content['card']['topics'] = []
            content['card']['metadata']['cross_editor'] = {
                'quoted': '{"literal": "\u00c4 @quiz [[x]]"}', 'ordered': [None, True, [3, 1, 2]]}
            tma = request('POST', 'cards/save', {'deck_id': deck.id, 'request_id': str(uuid4()), 'content_v2': content})
            cid, old_tma_revision = tma['id'], tma['revision']
            models.TMAProgress.create(card_id=cid, user_id=1, repetitions=3, interval=9)
            models.TMACardNote.create(id=str(uuid4()), card_id=cid, user_id=1, text='Private cross-editor note')
            models.TMACardRating.create(card_id=cid, user_id=1, rating=1)
            before = links(cid)
            path = f'admin/cards/{cid}?deck_id={deck.id}'
            admin = request('GET', path)
            assert admin['content_v2'] == tma['content_v2'], kind
            admin['content_v2']['card']['metadata']['admin_extension'] = {'nested': [False, None, {'quote': '"{}"'}]}
            request('PUT', path, {'content_v2': admin['content_v2'], 'revision': admin['revision']})
            tma = request('GET', f'cards/{cid}')
            assert tma['content_v2'] == admin['content_v2'], kind
            request('PATCH', f'cards/{cid}', {'request_id': str(uuid4()), 'content_v2': content,
                    'revision': old_tma_revision}, status=409)
            updated = tma['content_v2']
            updated['card']['explanation'] = 'TMA after Admin source JSON'
            request('PATCH', f'cards/{cid}', {'request_id': str(uuid4()), 'content_v2': updated,
                    'revision': tma['revision']})
            assert request('GET', path)['content_v2'] == updated, kind
            request('PUT', path, {'content_v2': updated, 'revision': admin['revision']}, status=409)
            assert links(cid) == before, kind
            print('PASS same-row TMA/Admin round-trip:', kind, flush=True)
        exported = request('GET', f'admin/author/export?deck_id={deck.id}&as_file=false')
        from api.card_core.lerne_card_core.structured_cards_import import import_documents
        document, = import_documents(exported['text'])
        assert document.model_dump(mode='json')['cards'] == [row.content_v2['card'] for row in models.TMA_Card.select().where(models.TMA_Card.deck == deck).order_by(models.TMA_Card.position)]
        print('PASS native JSON export/reimport with layout and media', flush=True)
        return True
    finally:
        admin_db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--admin-root', type=Path, required=True)
    parser.add_argument('--bin-dir', type=Path, required=True)
    args = parser.parse_args()
    source = args.admin_root.resolve() / 'src'
    if not (source / 'lerne_admin/services/native_cards.py').is_file():
        parser.error('Expected the native Structured Cards Admin checkout')
    sys.path[:0] = [str(ROOT), str(source)]
    import structured_cards_http
    import structured_cards_postgres

    def run(*arguments):
        os.environ['LERNE_ADMIN_STATE_DIR'] = str(ROOT / 'local/test-data' / ('cross-admin-' + uuid4().hex))
        return verify(*arguments)

    structured_cards_http._run_cases = run
    sys.argv = [sys.argv[0], '--bin-dir', str(args.bin_dir), '--http']
    return structured_cards_postgres.main()


if __name__ == '__main__':
    raise SystemExit(main())
