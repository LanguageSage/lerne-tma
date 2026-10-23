"""Managed material maintenance using the existing models, permissions and receipts.

Runs in a dedicated process: changing Peewee proxies here must never affect an
API request. Only the explicit content projection below can cross databases.
"""
import datetime as dt
import hashlib
import json
from collections import Counter
from contextlib import contextmanager
from uuid import uuid4
from peewee import fn

from fastapi import HTTPException

from api import models
from api.services.card_text_update import _digest, _claim_receipt
from api.services.collaborative_service import (
    _require_can_mutate, get_effective_user_role, touch_deck_and_parent_folders,
)
from api.permissions import is_admin

FIELDS = {
    'folder': ('name', 'color', 'target_language', 'position', 'is_deleted', 'parent_id'),
    'deck': ('name', 'level', 'topic', 'target_language', 'position', 'is_deleted', 'folder_id', 'metadata'),
    'card': ('front_text', 'back_text', 'context', 'image_path', 'audio_path', 'audio_back_path',
             'video_front_path', 'video_back_path', 'tags', 'metadata', 'card_type', 'difficulty',
             'topics', 'source', 'position', 'is_deleted', 'deck_id'),
}
PARENT = {'folder': 'parent_id', 'deck': 'folder_id', 'card': 'deck_id'}
MODELS = {'folder': models.TMA_Folder, 'deck': models.TMA_Deck, 'card': models.TMA_Card}
LIMITS = {'folder': 200, 'deck': 1000, 'card': 2000}
FORBIDDEN = {'progress', 'srs', 'review_history', 'history', 'session', 'sessions',
             'access_token', 'refresh_token', 'password', 'secret', 'api_key', 'service_role',
             'apikey', 'accesstoken', 'refreshtoken', 'supabase_key', 'authorization',
             'client_secret', 'bot_token', 'credentials', 'user_progress', 'next_review',
             'last_reviewed', 'ease_factor', 'repetitions', 'lapses', 'review_count'}


def material_metadata(value):
    """Preserve content metadata; reject credentials/learner state rather than export it."""
    try:
        data = json.loads(value or '{}')
    except (TypeError, ValueError):
        raise HTTPException(422, 'Повреждены метаданные материала. Исправьте их до переноса.') from None
    if not isinstance(data, dict):
        raise HTTPException(422, 'Метаданные материала должны быть объектом JSON.')
    def check(item):
        if isinstance(item, dict):
            for key, nested in item.items():
                normalized = key.lower().replace('-', '_')
                if normalized in FORBIDDEN or normalized.endswith(('_secret', '_password', '_token')):
                    raise HTTPException(422, 'Метаданные содержат пользовательское состояние или секреты.')
                check(nested)
        elif isinstance(item, list):
            for nested in item:
                check(nested)
    check(data)
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def content_hash(row):
    return _digest({'values': row['values'], 'author': row['author'],
                    'embedded_image_hash': row.get('embedded_image_hash')})


class Endpoint:
    def __init__(self, database, identity, user_id, *, media_root=None, storage=None):
        self.database, self.identity, self.user_id = database, identity, user_id
        self.media_root, self.storage = media_root, storage
        self._access_cache = None

    @contextmanager
    def scope(self):
        previous = models.tma_db.obj, models.lerne_db.obj
        previous_cache = self._access_cache
        self._access_cache = {}
        models.tma_db.initialize(self.database)
        models.lerne_db.initialize(self.database)
        try:
            self.database.connect(reuse_if_open=True)
            account = models.TMAUser.get_or_none(models.TMAUser.user_id == self.user_id)
            if account is None or account.is_guest:
                raise HTTPException(403, 'Для переноса нужен существующий авторизованный аккаунт.')
            yield
        finally:
            models.tma_db.initialize(previous[0])
            models.lerne_db.initialize(previous[1])
            self._access_cache = previous_cache

    def access(self, kind, row, write=False):
        target, identifier = ('deck', row.deck_id) if kind == 'card' else (kind, row.id)
        key = (target, identifier, write)
        if self._access_cache is not None and key in self._access_cache:
            return
        if write:
            _require_can_mutate(self.user_id, target, identifier, allow_deleted=True)
        elif get_effective_user_role(self.user_id, target, identifier) is None:
            if kind != 'card' and row.is_deleted:
                _require_can_mutate(self.user_id, target, identifier, allow_deleted=True)
            else:
                raise HTTPException(403, 'Нет доступа к выбранному материалу.')
        if self._access_cache is not None:
            self._access_cache[key] = True

    def row(self, kind, identifier, *, write=False, lock=False):
        return self.rows(kind, [identifier], write=write, lock=lock)[identifier]

    def rows(self, kind, identifiers, *, write=False, lock=False):
        if not identifiers:
            return {}
        model = MODELS[kind]
        query = model.select(*[getattr(model, f) for f in
                               ('id', *FIELDS[kind], 'updated_at', 'creator_id' if kind == 'card' else 'user_id')])
        if kind == 'folder':
            query = query.select_extend(model.access_scope)
        if kind == 'card':
            field = models.TMA_Card.image_data
            query = query.select_extend(fn.encode(fn.sha256(field), 'hex').alias('binary_hash') if
                                        self.database.for_update else field)
        if lock and self.database.for_update:
            query = query.for_update()
        found = {row.id: self.snapshot(kind, row, write) for row in
                 query.where(model.id.in_(identifiers)).order_by(model.id)}
        if len(found) != len(set(identifiers)):
            raise HTTPException(409, 'Сопоставленный материал отсутствует; автоматическая подмена ID запрещена.')
        return found

    def snapshot(self, kind, row, write):
        self.access(kind, row, write)
        values = {f: getattr(row, f) for f in FIELDS[kind]}
        if 'metadata' in values:
            values['metadata'] = material_metadata(values['metadata'])
        result = {'id': row.id, 'values': values,
                'updated_at': row.updated_at.isoformat() if row.updated_at else None,
                'author': row.creator_id if kind == 'card' else row.user_id}
        if kind == 'folder':
            result['access_scope'] = row.access_scope
        if kind == 'card' and not row.image_path:
            if self.database.for_update:
                result['embedded_image_hash'] = row.binary_hash
            else:
                binary = row.image_data
                result['embedded_image_hash'] = hashlib.sha256(binary).hexdigest() if binary else None
        return result

    def selection(self, selection, *, lock=False):
        result = {kind: {} for kind in MODELS}
        def check_size(kind, count):
            if count > LIMITS[kind]:
                labels = {'folder': 'папок', 'deck': 'колод', 'card': 'карточек'}
                raise HTTPException(413, f"В пакете больше {LIMITS[kind]} {labels[kind]}. "
                                    'Выберите вложенную папку или несколько колод и переносите частями.')
        def add(kind, identifier, value=None):
            if identifier is None or str(identifier) in result[kind]:
                return
            check_size(kind, len(result[kind]) + 1)
            value = value or self.row(kind, identifier, lock=lock)
            result[kind][str(identifier)] = value
            parent_kind = 'deck' if kind == 'card' else 'folder'
            add(parent_kind, value['values'][PARENT[kind]])
        with self.scope():
            for identifier, item in self.rows(selection['kind'], selection['ids'], lock=lock).items():
                add(selection['kind'], identifier, item)
            if selection['kind'] == 'folder':
                # Only descendants of the selected roots, never siblings of ancestors.
                frontier, seen = list(selection['ids']), set()
                while frontier:
                    identifier = frontier.pop()
                    if identifier in seen:
                        continue
                    seen.add(identifier)
                    add('folder', identifier)
                    children = list(models.TMA_Folder.select(models.TMA_Folder.id).where(
                        models.TMA_Folder.parent_id == identifier).limit(LIMITS['folder'] + 1))
                    check_size('folder', len(seen | {f.id for f in children} | set(frontier)))
                    frontier.extend(f.id for f in children)
                identifiers = [d.id for d in models.TMA_Deck.select(models.TMA_Deck.id).where(
                        models.TMA_Deck.folder_id.in_(seen)).limit(LIMITS['deck'] + 1)]
                check_size('deck', len(identifiers))
                for identifier, item in self.rows('deck', identifiers, lock=lock).items():
                    add('deck', identifier, item)
                deck_ids = list(result['deck'])
            else:
                deck_ids = selection['ids'] if selection['kind'] == 'deck' else []
            if deck_ids:
                identifiers = [c.id for c in models.TMA_Card.select(models.TMA_Card.id).where(
                        models.TMA_Card.deck_id.in_(deck_ids)).limit(LIMITS['card'] + 1)]
                # Reject before downloading text/metadata or resolving permissions
                # for thousands of cards in an oversized parent folder.
                check_size('card', len(identifiers))
                for identifier, item in self.rows('card', identifiers, lock=lock).items():
                    add('card', identifier, item)
        return result

    def catalog(self, kind, parent_id=None, page=1, search=''):
        with self.scope():
            model = MODELS[kind]
            label = model.front_text if kind == 'card' else model.name
            query = model.select(model.id, model.is_deleted, getattr(model, PARENT[kind]),
                                 fn.SUBSTR(label, 1, 180).alias('label')).where(model.is_deleted == False)
            if parent_id is not None:
                query = query.where(getattr(model, PARENT[kind]) == parent_id)
            if search:
                query = query.where((model.front_text if kind == 'card' else model.name).contains(search))
            # Permission filtering happens before pagination, without blobs or full text.
            visible, offset = [], (page - 1) * 50
            for candidate in query.order_by(model.id).iterator():
                try:
                    self.access(kind, candidate)
                except HTTPException as exc:
                    if exc.status_code == 403:
                        continue
                    raise
                if offset:
                    offset -= 1
                    continue
                visible.append({'id': candidate.id, 'name': candidate.label})
                if len(visible) == 51:
                    break
            return {'items': visible[:50], 'has_more': len(visible) > 50}


class Transfer:
    def __init__(self, local, cloud, *, allow_cloud_write=False, environment='staging', progress=None):
        self.local, self.cloud = local, cloud
        self.allow_cloud_write, self.environment = allow_cloud_write, environment
        self.namespace = _digest([local.identity, local.user_id, cloud.identity, cloud.user_id])[:24]
        self.progress = progress or (lambda *_: None)

    def endpoints(self, direction):
        return (self.local, self.cloud) if direction == 'publish' else (self.cloud, self.local)

    def ledger(self):
        prefix = f'transfer-map:{self.namespace}:'
        with self.local.scope():
            return {r.key[len(prefix):]: json.loads(r.response) for r in
                    models.TMAOfflineBatch.select().where(models.TMAOfflineBatch.key.startswith(prefix))}

    def save_maps(self, mappings):
        with self.local.scope(), self.local.database.atomic():
            for key, value in mappings.items():
                self.put(f'transfer-map:{self.namespace}:{key}', value)

    def capture(self, source, selection, ledger=None, follow=None):
        """Follow previously mapped children moved out of a selected container.

        Absence is never interpreted as deletion. A hard-deleted mapped row
        blocks the plan; existing soft-delete tombstones are transferred.
        """
        bundle = source.selection(selection)
        followed = list(follow or [])
        folders, decks = set(), set()
        def extend(part, root_kind, root_ids):
            for kind in MODELS:
                bundle[kind].update(part[kind])
                if len(bundle[kind]) > LIMITS[kind]:
                    raise HTTPException(413, 'Выбор с перемещёнными материалами слишком велик.')
            if root_kind == 'deck':
                decks.update(root_ids)
            elif root_kind == 'folder':
                relevant = set(root_ids)
                while True:
                    children = {int(i) for i, r in part['folder'].items() if r['values']['parent_id'] in relevant}
                    if children <= relevant:
                        break
                    relevant.update(children)
                folders.update(relevant)
                decks.update(int(i) for i, r in part['deck'].items() if r['values']['folder_id'] in relevant)
        extend(bundle, selection['kind'], selection['ids'])
        if follow is not None:
            for extra in follow:
                extend(source.selection(extra), extra['kind'], extra['ids'])
        elif selection['kind'] != 'card':
            side = 'local' if source is self.local else 'cloud'
            changed = True
            while changed:
                changed = False
                for mapping in (ledger or {}).values():
                    kind, identifier = mapping['kind'], mapping[side]
                    if str(identifier) in bundle[kind]:
                        continue
                    scope = decks if kind == 'card' else folders
                    if mapping.get(side + '_parent') not in scope:
                        continue
                    extra = {'kind': kind, 'ids': [identifier]}
                    extend(source.selection(extra), kind, [identifier])
                    followed.append(extra)
                    changed = True
        return bundle, followed, {'folder': list(folders), 'deck': list(decks)}

    @staticmethod
    def put(key, value):
        encoded = json.dumps(value, ensure_ascii=False)
        models.TMAOfflineBatch.insert(key=key, payload_hash=_digest(value), response=encoded).on_conflict(
            conflict_target=[models.TMAOfflineBatch.key], update={models.TMAOfflineBatch.response: encoded,
                                                                models.TMAOfflineBatch.payload_hash: _digest(value)}).execute()

    def job(self, identifier):
        with self.local.scope():
            row = models.TMAOfflineBatch.get_or_none(models.TMAOfflineBatch.key == f'transfer-job:{identifier}')
            if row is None:
                raise HTTPException(404, 'Предпросмотр не найден.')
            job = json.loads(row.response)
            if job['namespace'] != self.namespace:
                raise HTTPException(409, 'Конфигурация цели изменилась.')
            return job

    def save_job(self, job):
        with self.local.scope(), self.local.database.atomic():
            self.put(f"transfer-job:{job['id']}", job)

    def preview(self, options):
        source, target = self.endpoints(options['direction'])
        ledger = self.ledger()
        bundle, follow, scope = self.capture(source, options['selection'], ledger=ledger)
        source_side, target_side = ('local', 'cloud') if options['direction'] == 'publish' else ('cloud', 'local')
        rows, mapping = [], {}
        with target.scope():
            existing = {kind: target.rows(kind, [m[target_side] for m in ledger.values()
                if m['kind'] == kind and str(m[source_side]) in bundle[kind]], write=True) for kind in MODELS}
            for kind, items in bundle.items():
                for identifier, item in items.items():
                    key = f'{kind}:{identifier}'
                    matches = [(k, m) for k, m in ledger.items() if m['kind'] == kind and m[source_side] == int(identifier)]
                    if len(matches) > 1:
                        raise HTTPException(409, 'Неоднозначное сопоставление.')
                    map_key, prior = matches[0] if matches else (None, None)
                    before = existing[kind][prior[target_side]] if prior else None
                    mapping[key] = {'map_key': map_key, 'prior': prior, 'before': before}
            # Existing destination root is only an insertion parent, never matched by ID/name.
            destination = options.get('destination_folder_id')
            root = target.row('folder', destination, write=True) if destination else None
        for kind, items in bundle.items():
            for identifier, item in items.items():
                key = f'{kind}:{identifier}'
                match = mapping[key]
                before, prior = match['before'], match['prior']
                decision = options.get('decisions', {}).get(key, options['on_conflict'])
                action = 'create' if before is None else 'update'
                conflict = False
                if item['values']['is_deleted'] and before is None:
                    action = 'skip'
                elif before is not None:
                    changed = content_hash(item) != prior.get(source_side + '_hash')
                    target_changed = content_hash(before) != prior.get(target_side + '_hash')
                    conflict = target_changed and (changed or options['mode'] == 'force')
                    if options['mode'] == 'missing' or decision == 'skip':
                        action = 'skip'
                    elif decision == 'new' and kind == 'card':
                        action = 'copy'
                    elif not changed and not target_changed and options['mode'] != 'force':
                        action = 'unchanged'
                    elif conflict and not options.get('accept_conflicts'):
                        action = 'conflict'
                    elif not changed and target_changed and options['mode'] != 'force':
                        action = 'skip'
                rows.append({'key': key, 'kind': kind, 'source_id': int(identifier),
                             'target_id': before['id'] if before else None, 'action': action,
                             'conflict': conflict, 'before': before, 'after': json.loads(json.dumps(item)),
                             'mapping': match})
        # A single-card transfer includes structural dependencies without overwriting
        # unrelated deck/passport/folder edits. Full deck/folder selections maintain them.
        for row in rows:
            if row['kind'] != 'card' and row['target_id'] and row['source_id'] not in scope[row['kind']]:
                row['action'] = 'dependency'
            if row['kind'] == 'card' and row['action'] in ('create', 'copy'):
                author = row['after']['author']
                if author is not None and author != source.user_id:
                    metadata = json.loads(row['after']['values']['metadata'])
                    metadata['author_origin'] = {'database': source.identity, 'user_id': author}
                    row['after']['values']['metadata'] = json.dumps(metadata, ensure_ascii=False)
        if options.get('public_original'):
            if options['direction'] != 'publish' or options['selection']['kind'] != 'folder' or not is_admin(target.user_id):
                raise HTTPException(403, 'Публикация общедоступного оригинала разрешена администратору для папки.')
            for row in rows:
                if row['kind'] == 'folder' and row['source_id'] in options['selection']['ids'] and row['before'] and \
                        row['before']['access_scope'] != 'global_readonly' and row['action'] == 'unchanged':
                    row['action'] = 'update'
        job = {'id': str(uuid4()), 'namespace': self.namespace, 'options': options, 'source': bundle, 'follow': follow,
               'rows': rows, 'root': root, 'created_at': dt.datetime.now(dt.timezone.utc).isoformat(),
               'environment': self.environment, 'target': target.identity, 'status': 'preview',
               'media': [], 'error': None}
        from tools.admin.services.material_transfer_media import prepare_transfer_media
        prepare_transfer_media(self, job)
        job['token'] = _digest({k: job[k] for k in ('options', 'source', 'rows', 'root', 'media', 'target')})
        self.save_job(job)
        return self.public(job)

    def public(self, job):
        rows = []
        for row in job['rows']:
            before = dict(row['before']['values']) if row['before'] else None
            after = dict(row['after']['values'])
            parent = after[PARENT[row['kind']]]
            parent_kind = 'deck' if row['kind'] == 'card' else 'folder'
            parent_row = next((r for r in job['rows'] if r['kind'] == parent_kind and r['source_id'] == parent), None)
            after[PARENT[row['kind']]] = (parent_row['target_id'] or f'новый {parent_kind} #{parent}') if parent_row else (
                job['root']['id'] if job['root'] and parent is None else None)
            if before is not None and row['action'] in ('skip', 'dependency', 'unchanged'):
                after = dict(before)
            if row['kind'] == 'folder':
                if before is not None:
                    before['access_scope'] = row['before']['access_scope']
                after['access_scope'] = before['access_scope'] if before else 'private'
                if job['options'].get('public_original') and row['source_id'] in job['options']['selection']['ids'] \
                        and row['action'] in ('create', 'update'):
                    after['access_scope'] = 'global_readonly'
            rows.append({k: row[k] for k in ('key', 'kind', 'source_id', 'target_id', 'action', 'conflict')}
                        | {'before': before, 'after': after, 'changed_fields':
                           [f for f in after if before is None or before.get(f) != after[f]]})
            if row['action'] == 'copy':
                rows[-1]['target_id'] = None
        return {'id': job['id'], 'token': job['token'], 'status': job['status'], 'rows': rows,
                'counts': dict(Counter(r['action'] for r in rows)), 'error': job.get('error'),
                'progress': job.get('progress', 0), 'total': len(job['media']),
                'media': [{k: a[k] for k in ('source', 'revision', 'path', 'action')} for a in job['media']],
                'target': job['target'], 'environment': job['environment'],
                'can_apply': all(r['action'] != 'conflict' for r in rows)
                             and (job['options']['direction'] != 'publish' or self.allow_cloud_write),
                'result': job.get('result')}

    def apply(self, identifier, token, confirmation):
        job = self.job(identifier)
        if token != job['token'] or confirmation != job['target']:
            raise HTTPException(409, 'Подтвердите показанный предпросмотр и точную цель.')
        if job['options']['direction'] == 'publish' and not self.allow_cloud_write:
            raise HTTPException(403, 'Запись в Supabase отключена в серверной конфигурации.')
        if any(r['action'] == 'conflict' for r in job['rows']):
            raise HTTPException(409, 'Сначала разрешите конфликты и повторите предпросмотр.')
        source, target = self.endpoints(job['options']['direction'])
        receipt_key = f"transfer-apply:{self.namespace}:{job['id']}"
        # A committed receipt wins over freshness after response loss; recheck access.
        with target.scope():
            for kind in MODELS:
                target.rows(kind, [r['target_id'] for r in job['rows'] if
                                  r['kind'] == kind and r['target_id']], write=True)
            receipt = models.TMAOfflineBatch.get_or_none(models.TMAOfflineBatch.key == receipt_key)
            replay = json.loads(receipt.response) if receipt else None
        if replay:
            self.save_maps(replay['mappings'])
            job.update(status='complete', result=replay)
            self.save_job(job)
            return self.public(job)
        if dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(job['created_at']) > dt.timedelta(hours=1):
            raise HTTPException(409, 'Предпросмотр старше часа. Выполните новый.')
        job.update(status='running', error=None)
        self.save_job(job)
        try:
            # Capture the source consistently, then release it before media/network I/O.
            if self.capture(source, job['options']['selection'], follow=job['follow'])[0] != job['source']:
                raise HTTPException(409, 'Источник изменился после предпросмотра.')
            self.check_target(job, target)
            from tools.admin.services.material_transfer_media import apply_transfer_media
            apply_transfer_media(self, job)
            with target.scope(), target.database.atomic(**({'lock_type': 'IMMEDIATE'} if not target.database.for_update else {})):
                # Lock existing destination rows in deterministic order and revalidate
                # inside the same transaction that writes content and receipt.
                self.check_target(job, target, lock=True)
                receipt, replay = _claim_receipt(receipt_key, job['token'])
                if replay is None:
                    result = self.write_rows(job, source, target)
                    receipt.response = json.dumps(result, ensure_ascii=False)
                    receipt.save()
                else:
                    result = replay
            self.save_maps(result['mappings'])
            job.update(status='complete', result=result)
        except Exception as exc:
            job.update(status='stale' if isinstance(exc, HTTPException) and exc.status_code == 409 else 'interrupted', error=(exc.detail if isinstance(exc, HTTPException) else
                       'Операция прервана. Проверьте доступность цели и повторите подтверждение.'))
            self.save_job(job)
            raise
        self.save_job(job)
        return self.public(job)

    def check_target(self, job, target, lock=False):
        with target.scope():
            current = {kind: target.rows(kind, [r['target_id'] for r in job['rows'] if
                r['kind'] == kind and r['target_id']], write=True, lock=lock) for kind in sorted(MODELS)}
            for row in sorted(job['rows'], key=lambda r: (r['kind'], r['target_id'] or 0)):
                if row['target_id'] and current[row['kind']][row['target_id']] != row['before']:
                    raise HTTPException(409, 'Цель изменилась после предпросмотра. Запись отменена.')
            if job['root'] and target.row('folder', job['root']['id'], write=True, lock=lock) != job['root']:
                raise HTTPException(409, 'Целевая папка изменилась.')

    def write_rows(self, job, source, target):
        source_side, target_side = ('local', 'cloud') if source is self.local else ('cloud', 'local')
        # Use the destination clock: the operator's LOCAL timezone can differ
        # from Supabase's. Card and ancestor timestamps must share that clock.
        now = target.database.execute_sql('SELECT LOCALTIMESTAMP' if target.database.for_update else
                                          'SELECT CURRENT_TIMESTAMP').fetchone()[0]
        if isinstance(now, str):
            now = dt.datetime.fromisoformat(now)
        resolved, mappings, applied = {}, {}, []
        pending = list(job['rows'])
        while pending:
            advanced = False
            for row in list(pending):
                kind, key = row['kind'], row['key']
                parent = row['after']['values'][PARENT[kind]]
                parent_key = f"{'deck' if kind == 'card' else 'folder'}:{parent}"
                if parent is not None and parent_key not in resolved:
                    continue
                parent_id = resolved.get(parent_key) if parent else (job['root']['id'] if job['root'] else None)
                action, identifier = row['action'], row['target_id']
                if action in ('create', 'copy', 'update'):
                    values = dict(row['after']['values'])
                    values[PARENT[kind]] = parent_id
                    if parent and parent_id is None:
                        raise HTTPException(409, 'Нельзя записать материал без перенесённого родителя.')
                    values['updated_at'] = now
                    model = MODELS[kind]
                    if kind == 'folder' and identifier and parent_id:
                        ancestor, visited = parent_id, {identifier}
                        while ancestor:
                            if ancestor in visited:
                                raise HTTPException(409, 'Перемещение создаёт цикл папок. Выберите другую целевую папку.')
                            visited.add(ancestor)
                            ancestor = models.TMA_Folder.select(models.TMA_Folder.parent_id).where(
                                models.TMA_Folder.id == ancestor).scalar()
                    if kind == 'card':
                        # Only translate the explicitly paired author identity. Unknown
                        # authors retain attribution in content metadata, never grants.
                        if identifier and action == 'update':
                            values['creator_id'] = row['before']['author']
                        else:
                            author = row['after']['author']
                            values['creator_id'] = target.user_id if author == source.user_id else None
                            if author is not None and author != source.user_id:
                                metadata = json.loads(values['metadata'] or '{}')
                                metadata['author_origin'] = {'database': source.identity, 'user_id': author}
                                values['metadata'] = json.dumps(metadata, ensure_ascii=False)
                    elif not identifier:
                        values['user_id'] = target.user_id
                    if kind == 'folder' and job['options'].get('public_original') and row['source_id'] in job['options']['selection']['ids']:
                        values['access_scope'] = 'global_readonly'
                    if identifier and action == 'update':
                        model.update(**values).where(model.id == identifier).execute()
                    else:
                        identifier = model.create(**values).id
                    applied.append(identifier)
                resolved[key] = identifier
                if identifier and action not in ('skip', 'dependency'):
                    target_row = row['before'] if action == 'unchanged' else target.row(kind, identifier, write=True)
                    old = row['mapping']['prior']
                    map_key = row['mapping']['map_key'] or str(uuid4())
                    # Add-as-new is an independent copy. Keep the original mapping;
                    # the operation receipt makes retry of the copy idempotent.
                    if action != 'copy':
                        mappings[map_key] = {'kind': kind, source_side: row['source_id'], target_side: identifier,
                            source_side + '_hash': content_hash(job['source'][kind][str(row['source_id'])]),
                            target_side + '_hash': content_hash(target_row),
                            source_side + '_parent': job['source'][kind][str(row['source_id'])]['values'][PARENT[kind]],
                            target_side + '_parent': target_row['values'][PARENT[kind]],
                            'version': (old.get('version', 0) if old else 0) + (action != 'unchanged')}
                pending.remove(row)
                advanced = True
            if not advanced:
                raise HTTPException(422, 'Цикл или отсутствующий родитель в выбранных материалах.')
        # Existing content-only touch keeps sync visibility without changing SRS.
        for deck_id in {resolved[r['key']] if r['kind'] == 'deck' else
                        resolved.get(f"deck:{r['after']['values']['deck_id']}")
                        for r in job['rows'] if r['kind'] in ('deck', 'card')
                        and r['action'] in ('create', 'copy', 'update')} - {None}:
            touch_deck_and_parent_folders(deck_id, now=now)
        return {'applied': len(applied), 'counts': dict(Counter(r['action'] for r in job['rows'])), 'mappings': mappings}
