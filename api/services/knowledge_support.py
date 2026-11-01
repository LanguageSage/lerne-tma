"""Optional raw diagnostic facts. Never used by mastery or answer evaluation."""


def valid_support_evidence(evidence, capture_point):
    if not isinstance(evidence, dict) or type(evidence.get('tracking_complete')) is not bool:
        return False
    if evidence.get('capture_point') != capture_point:
        return False
    attempt = evidence.get('answer_attempt_count')
    if type(attempt) is not int or attempt < 1 or (capture_point == 'first_assessment_result' and attempt != 1):
        return False
    for key in ('hint_count', 'translation_view_count', 'answer_reveal_count', 'other_help_count'):
        if key not in evidence:
            return False
        value = evidence[key]
        if value is None:
            if evidence['tracking_complete']:
                return False
        elif type(value) is not int or value < 0:
            return False
    return True


def valid_support_fields(evaluation):
    """Old payloads stay untouched, including their absent support fields."""
    version = evaluation.get('schema_version')
    container = evaluation.get('exercise_evidence') if version == 2 else evaluation if version == 3 else None
    if not isinstance(container, dict):
        return True
    if 'support_evidence' in container:
        point = 'exercise_completion' if version == 2 else 'first_assessment_result'
        if evaluation.get('status') == 'skipped' or not valid_support_evidence(container['support_evidence'], point):
            return False
    if 'task_support' in container:
        support = container['task_support']
        keys = ('answer_options_present', 'source_text_present', 'authored_example_present',
                'sentence_frame_present', 'source_vocabulary_present')
        if not isinstance(support, dict) or any(key not in support or (
                support[key] is not None and type(support[key]) is not bool) for key in keys):
            return False
    return True
