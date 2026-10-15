"""Compare the shared editor schema corpus with installed standard Draft7 validation.
No Node execution, network, database or publication/human-review claim.
"""
import copy
import json
from pathlib import Path
import jsonschema
import pytest
ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / 'schemas/read2lead-self-learn/lesson.v1.1.schema.json').read_text())
BASE = json.loads((ROOT / 'tests/fixtures/read2lead-self-learn/level-lessons.json').read_text())['lessons'][2]
CASES = json.loads((ROOT / 'tests/fixtures/read2lead-self-learn/editor-schema-cases.json').read_text())['cases']
VALIDATOR = jsonschema.Draft7Validator(SCHEMA)

@pytest.mark.parametrize('case', CASES, ids=[case['id'] for case in CASES])
def test_editor_shared_schema_case(case):
    lesson = copy.deepcopy(BASE)
    parent = lesson
    for key in case['path'][:-1]:
        parent = parent[key]
    if case['op'] == 'delete':
        del parent[case['path'][-1]]
    else:
        parent[case['path'][-1]] = case['value']
    assert VALIDATOR.is_valid({'contract_version': '1.1.0', 'lessons': [lesson]}) is case['valid']
