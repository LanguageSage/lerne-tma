"""Evaluate the semantic annotations carried in the Native V2 JSON Schema."""
import json

from pydantic import ValidationError
from pydantic_core import PydanticCustomError


def value_at(value, path):
    for key in path:
        value = value[key]
    return value


def matches(value, conditions):
    return all(value.get(key) in choices for key, choices in conditions.items())


def violations(value, rule):
    """Yield paths and messages, relative to the model declaring this rule."""
    kind = rule['kind']
    path = rule.get('path', [])
    subject = value_at(value, path)
    if kind in ('unique', 'count', 'references') and subject is None:
        return

    if kind == 'unique':
        keys = [item[rule['key']] if 'key' in rule else item for item in subject]
        valid = len(keys) == len(set(keys))
    elif kind == 'count':
        if not matches(value, rule.get('when', {})):
            return
        count = sum(matches(item, rule.get('where', {})) for item in subject)
        valid = rule.get('min', 0) <= count <= rule.get('max', len(subject))
    elif kind == 'references':
        length = len(value_at(value, rule['target']))
        seen = set()
        for index, item in enumerate(subject):
            if not matches(item, rule['where']):
                continue
            reference = item[rule['key']]
            if reference in seen or not 0 <= reference < length:
                message = rule.get('duplicate' if reference in seen else 'missing', rule['message'])
                yield [*path, index, *rule.get('at', [rule['key']])], message
            seen.add(reference)
        if rule.get('complete') and len(seen) != length:
            yield path, rule['message']
        return
    elif kind == 'distinct_text':
        left, right = (value_at(value, field).strip() for field in rule['fields'])
        valid = left != right
    elif kind == 'visible_text':
        selection = rule['selection']
        references = value_at(value, selection['path'])
        visible = None if references is None else {
            item[selection['key']] for item in references if matches(item, selection['where'])
        }
        valid = bool(subject.strip()) or any(
            (visible is None or index in visible) and matches(item, rule['where'])
            for index, item in enumerate(value_at(value, rule['alternative']))
        )
    elif kind == 'reserved_keys':
        valid = not set(rule['keys']).intersection(subject)
        json.dumps(subject, allow_nan=False)
    elif kind == 'json_bytes':
        encoded = json.dumps(subject, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
        valid = len(encoded.encode('utf-8')) <= rule['max']
    else:
        raise ValueError(f'Unknown Native V2 rule: {kind}')

    if not valid:
        yield path, rule['message']


def enforce_rules(model, rules):
    value = model.model_dump(mode='python')
    failures = []
    for rule in rules:
        failures.extend({
            'type': PydanticCustomError(rule.get('code', 'value_error'), message),
            'loc': tuple(path),
            'input': value_at(value, path) if rule['kind'] != 'references' else value,
        } for path, message in violations(value, rule))
        if failures:
            raise ValidationError.from_exception_data(type(model).__name__, failures)
