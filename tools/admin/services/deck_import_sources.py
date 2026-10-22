"""Validate selected deck documents and versioned portable media manifests."""
import json
from pathlib import PurePosixPath

from api.services import author_service
from tools.admin.services.deck_import_media import DECK_EXTENSIONS, safe_path, relative_path, prepare_media

MEDIA_FIELDS = {'image': 'image_path', 'audio_front': 'audio_path', 'audio_back': 'audio_back_path'}
MAX_CARDS = 5000


def _json(data):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f'Повтор JSON-ключа: {key}')
            result[key] = value
        return result
    return json.loads(data.decode('utf-8-sig'), object_pairs_hook=unique)


def read_sources(payload, files):
    selected = payload['selected']
    if not selected or len(selected) != len(set(selected)) or len(payload.get('manifests', [])) != len(set(payload.get('manifests', []))):
        raise ValueError('Выберите файлы колод без повторов.')
    documents, manifests, assets, problems = {}, [], {}, []
    for path in selected:
        safe_path(path)
        if PurePosixPath(path).suffix.lower() not in DECK_EXTENSIONS or PurePosixPath(path).name == 'media_manifest.json':
            raise ValueError(f'{path}: неподдерживаемый файл колоды.')
        if path not in files:
            raise ValueError(f'{path}: файл колоды не передан.')
        if len(files[path]) > 10 * 1024 * 1024:
            raise ValueError(f'{path}: файл колоды больше 10 МБ.')
        document = author_service.parse_uploaded_documents([(PurePosixPath(path).name, files[path].decode('utf-8-sig'))])
        problems.extend(f'{path}: {e}' for e in document['errors'])
        documents[path] = document
    if sum(len(d['cards']) for d in documents.values()) > MAX_CARDS:
        raise ValueError('За один импорт допускается не более 5000 карточек.')
    for path in payload.get('manifests', []):
        safe_path(path)
        if path not in files or len(files[path]) > 1024 * 1024:
            raise ValueError(f'{path}: манифест отсутствует или больше 1 МБ.')
        manifest = _json(files[path])
        if not isinstance(manifest, dict) or type(manifest.get('schema_version')) is not int or manifest['schema_version'] != 1:
            raise ValueError(f'{path}: требуется media manifest schema_version: 1.')
        if set(manifest) - {'schema_version', 'deck_file', 'bindings', 'study_audio'}:
            raise ValueError(f'{path}: неизвестные поля манифеста.')
        target = relative_path(path, manifest.get('deck_file'))
        if target not in selected:
            raise ValueError('Манифест ссылается на невыбранную колоду.')
        bindings, study_audio = manifest.get('bindings', []), manifest.get('study_audio', [])
        if not isinstance(bindings, list) or not isinstance(study_audio, list) or len(bindings) + len(study_audio) > MAX_CARDS:
            raise ValueError(f'{path}: некорректный список связей.')
        manifests.append((path, target, bindings, study_audio))
    allowed_files = set(selected) | set(payload.get('manifests', []))
    hints, links, resources, used_slots = {}, [], [], set()
    for path, target, bindings, study_audio in manifests:
        source_cards = {c['number']: c for c in documents[target]['cards']}
        for binding in bindings:
            if not isinstance(binding, dict) or set(binding) - {'card_number', 'card_id', *MEDIA_FIELDS}:
                raise ValueError(f'{path}: неверная связь карточки.')
            number = binding.get('card_number')
            if type(number) is not int:
                raise ValueError(f'{path}: card_number должен быть целым числом.')
            if number not in source_cards:
                problems.append(f'{path}: неизвестная карточка №{number}.')
            card_key = f'{target}#{number}'
            if binding.get('card_id') is not None:
                identifier = binding['card_id']
                if type(identifier) is not int or identifier <= 0:
                    raise ValueError(f'{path}: неверный card_id.')
                if hints.get(card_key, identifier) != identifier or source_cards.get(number, {}).get('card_id', identifier) not in (None, identifier):
                    problems.append(f'{card_key}: конфликт card_id.')
                hints[card_key] = identifier
            for role in MEDIA_FIELDS:
                if role not in binding:
                    continue
                link_key = f'{card_key}:{role}'
                if link_key in used_slots:
                    raise ValueError(f'{card_key}: повтор назначения {role}.')
                used_slots.add(link_key)
                source = relative_path(path, binding[role])
                links.append({'key': link_key, 'card_key': card_key, 'role': role, 'source': source})
        for entry in study_audio:
            if not isinstance(entry, dict) or set(entry) - {'file', 'title', 'deck_name'}:
                raise ValueError(f'{path}: неверная учебная аудиозапись.')
            names = {c['deck_name'] for c in documents[target]['cards']}
            name = entry.get('deck_name') or (next(iter(names)) if len(names) == 1 else None)
            if not isinstance(name, str) or name not in names or not isinstance(entry.get('title', ''), str):
                raise ValueError(f'{path}: укажите deck_name и строковый title для учебного аудио.')
            resources.append({'file': target, 'deck_name': name, 'source': relative_path(path, entry.get('file')),
                              'title': entry.get('title') or PurePosixPath(entry['file']).name})
    for link in [*links, *resources]:
        source = link['source']
        allowed_files.add(source)
        if source not in files:
            problems.append(f'{source}: отсутствующий файл.')
            continue
        role = link.get('role', 'audio_study')
        cache_key = (source, 'image' if role == 'image' else 'audio')
        if cache_key not in assets:
            try:
                assets[cache_key] = prepare_media(source, files[source], role)
            except ValueError as exc:
                problems.append(str(exc))
                continue
        link['asset_key'] = cache_key
    if len(links) + len(resources) > 15000:
        raise ValueError('Слишком много медиа-связей; разбейте импорт на части.')
    if set(files) - allowed_files:
        raise ValueError('Переданы лишние файлы. Загружайте только выбранные колоды и связанные медиа.')
    return documents, hints, links, resources, assets, problems
