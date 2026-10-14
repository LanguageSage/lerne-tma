"""Versioned, language-independent deck passport validation and metadata merging.

Pure functions: no database access, SRS inference or HTML interpretation.
"""
import copy
import json
import re

SUPPORT_LEVELS = {'high', 'medium', 'low', 'independent'}
LESSON_TYPES = {'theory', 'practice', 'review', 'assessment'}
CEFR_LEVELS = {'A1', 'A2', 'B1', 'B2', 'C1', 'C2'}


def validate_passport(value):
    errors = []
    if not isinstance(value, dict):
        return ['Паспорт должен быть JSON-объектом.']
    if type(value.get('schema_version')) is not int or value['schema_version'] != 1:
        errors.append('schema_version должен быть 1.')
    if not any(key in value for key in ('intro', 'pedagogy')):
        errors.append('Требуется раздел intro или pedagogy.')

    def text(obj, key, path, required=False):
        if key not in obj and not required:
            return
        item = obj.get(key)
        if not isinstance(item, str) or (required and not item.strip()):
            errors.append(f'{path}.{key}: требуется текст' + (' (непустой).' if required else '.'))

    def entries(obj, key, path):
        items = obj.get(key, [])
        if not isinstance(items, list):
            errors.append(f'{path}.{key}: требуется массив.')
            return []
        seen = set()
        valid = []
        for i, item in enumerate(items):
            p = f'{path}.{key}[{i}]'
            if not isinstance(item, dict):
                errors.append(f'{p}: требуется объект.')
                continue
            for field in ('id', 'title'):
                text(item, field, p, True)
            identifier = item.get('id')
            if isinstance(identifier, str):
                if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]*', identifier):
                    errors.append(f'{p}.id: используйте стабильный идентификатор без пробелов.')
                if identifier in seen:
                    errors.append(f'{p}.id: повтор идентификатора {identifier}.')
                seen.add(identifier)
            valid.append((item, p))
        return valid

    intro = value.get('intro', {})
    if not isinstance(intro, dict):
        errors.append('intro: требуется объект.')
    else:
        for field in ('title', 'level', 'topic', 'description', 'goal', 'estimated_time', 'recommendations'):
            text(intro, field, 'intro')
        if 'level' in intro and (not isinstance(intro['level'], str) or intro['level'] not in CEFR_LEVELS):
            errors.append('intro.level: требуется уровень CEFR A1–C2.')
        if 'learning_outcomes' in intro and (not isinstance(intro['learning_outcomes'], list)
                or any(not isinstance(x, str) for x in intro['learning_outcomes'])):
            errors.append('intro.learning_outcomes: требуется массив строк.')

    pedagogy = value.get('pedagogy', {})
    if not isinstance(pedagogy, dict):
        errors.append('pedagogy: требуется объект.')
    elif 'pedagogy' in value:
        if not isinstance(pedagogy.get('lesson_type'), str) or pedagogy['lesson_type'] not in LESSON_TYPES:
            errors.append('pedagogy.lesson_type: требуется theory, practice, review или assessment.')
        if 'schema_version' in pedagogy and (type(pedagogy['schema_version']) is not int or pedagogy['schema_version'] != 1):
            errors.append('pedagogy.schema_version должен быть 1.')
        text(pedagogy, 'expected_result', 'pedagogy')
        if 'assessment' in pedagogy:
            assessment = pedagogy['assessment']
            if pedagogy.get('lesson_type') != 'assessment':
                errors.append('pedagogy.assessment: требуется lesson_type=assessment.')
            if not isinstance(assessment, dict) or type(assessment.get('schema_version')) is not int or assessment['schema_version'] != 1:
                errors.append('pedagogy.assessment: требуется schema_version=1.')
            else:
                for key, minimum in (('required_count', 1), ('bonus_count', 0)):
                    if type(assessment.get(key)) is not int or not minimum <= assessment[key] <= 5000:
                        errors.append(f'pedagogy.assessment.{key}: некорректное количество.')
                count = assessment.get('required_count', 0)
                bands = entries(assessment, 'bands', 'pedagogy.assessment')
                covered = set()
                for band, path in bands:
                    start, end = band.get('min'), band.get('max')
                    if type(start) is not int or type(end) is not int or type(count) is not int or not 1 <= count <= 5000 or not 0 <= start <= end <= count:
                        errors.append(f'{path}: некорректный диапазон баллов.')
                    else:
                        values = set(range(start, end + 1))
                        if covered & values:
                            errors.append(f'{path}: пересечение диапазонов баллов.')
                        covered |= values
                if type(count) is int and 1 <= count <= 5000 and covered != set(range(count + 1)):
                    errors.append('pedagogy.assessment.bands: шкала должна покрывать все баллы.')
                for route, path in entries(assessment, 'review_routes', 'pedagogy.assessment'):
                    if not isinstance(route.get('competency_ids'), list) or not route['competency_ids'] or any(not isinstance(x, str) for x in route['competency_ids']):
                        errors.append(f'{path}.competency_ids: требуется непустой массив строк.')
                    if not isinstance(route.get('deck_ids'), list) or not route['deck_ids'] or any(type(x) is not int or x <= 0 for x in route['deck_ids']):
                        errors.append(f'{path}.deck_ids: требуется непустой массив положительных ID.')
        for item, p in entries(pedagogy, 'stages', 'pedagogy'):
            text(item, 'goal', p, True)
            text(item, 'expected_skill', p)
            if not isinstance(item.get('support'), str) or item['support'] not in SUPPORT_LEVELS:
                errors.append(f'{p}.support: неизвестный уровень поддержки.')
            if 'from_card' in item or 'to_card' in item:
                start, end = item.get('from_card'), item.get('to_card')
                if type(start) is not int or type(end) is not int or not 1 <= start <= end:
                    errors.append(f'{p}: диапазон должен быть 1 ≤ from_card ≤ to_card.')
        for key in ('competencies', 'assessment_criteria'):
            for item, p in entries(pedagogy, key, 'pedagogy'):
                text(item, 'description', p)
        for item, p in entries(pedagogy, 'review_recommendations', 'pedagogy'):
            text(item, 'reason', p)
            text(item, 'when', p)
            if 'deck_id' in item and (type(item['deck_id']) is not int or item['deck_id'] <= 0):
                errors.append(f'{p}.deck_id: требуется положительный ID.')
            if 'competency_ids' in item and (not isinstance(item['competency_ids'], list)
                    or any(not isinstance(x, str) for x in item['competency_ids'])):
                errors.append(f'{p}.competency_ids: требуется массив строк.')
    try:
        json.dumps(value, allow_nan=False)
    except (TypeError, ValueError):
        errors.append('Паспорт должен содержать только JSON-данные без NaN/Infinity.')
    return errors


def read_metadata(raw):
    value = json.loads(raw) if isinstance(raw, str) and raw else ({} if raw is None or raw == '' else raw)
    if not isinstance(value, dict):
        raise ValueError('metadata колоды должен быть объектом; исправьте данные перед импортом.')
    return value


def merge_passport(raw_metadata, passport):
    errors = validate_passport(passport)
    if errors:
        raise ValueError('\n'.join(errors))
    metadata = copy.deepcopy(read_metadata(raw_metadata))
    for section in ('intro', 'pedagogy'):
        if section in passport:
            existing = metadata.get(section, {})
            if not isinstance(existing, dict):
                raise ValueError(f'metadata.{section} должен быть объектом.')
            metadata[section] = {**existing, **copy.deepcopy(passport[section])}
            if section == 'pedagogy':
                metadata[section]['schema_version'] = 1
    return metadata


def passport_from_metadata(raw_metadata):
    metadata = read_metadata(raw_metadata)
    sections = {key: copy.deepcopy(metadata[key]) for key in ('intro', 'pedagogy') if key in metadata}
    return {'schema_version': 1, **sections} if sections else None
