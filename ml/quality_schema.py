"""Strict validators for the checked-in evaluation schemas; no permissive coercion."""
from __future__ import annotations
import hashlib
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def strict_json(text):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('Duplicate JSON key')
            result[key] = value
        return result
    return json.loads(text, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-finite JSON')))


def validate(value, schema, path='$', root=None):
    root = schema if root is None else root
    if '$ref' in schema:
        reference = schema['$ref']
        if not re.fullmatch(r'#\/\$defs\/[A-Za-z_]+',reference):
            raise ValueError('Only local schema definitions are supported')
        return validate(value,root['$defs'][reference.rsplit('/',1)[-1]],path,root)
    kind = schema.get('type')
    types = {'object':dict, 'array':list, 'string':str, 'integer':int, 'boolean':bool}
    if kind == 'number':
        valid = type(value) in (int, float) and math.isfinite(value)
    else:
        valid = kind is None or type(value) is types[kind]
    if not valid:
        raise ValueError(path+': invalid type')
    if 'enum' in schema and value not in schema['enum']:
        raise ValueError(path+': unsupported value')
    if kind == 'object':
        properties = schema.get('properties', {})
        if not set(schema.get('required', [])).issubset(value):
            raise ValueError(path+': missing field')
        if schema.get('additionalProperties') is False and set(value)-set(properties):
            raise ValueError(path+': unknown field')
        for key,item in value.items():
            if key in properties:
                validate(item, properties[key], path+'.'+key,root)
    if kind == 'array':
        if len(value) < schema.get('minItems',0) or len(value) > schema.get('maxItems',10**9):
            raise ValueError(path+': invalid length')
        if schema.get('uniqueItems') and len({json.dumps(v,sort_keys=True) for v in value}) != len(value):
            raise ValueError(path+': duplicate item')
        for i,item in enumerate(value):
            validate(item,schema.get('items',{}),path+f'[{i}]',root)
    if kind in ('integer','number') and not schema.get('minimum',-math.inf) <= value <= schema.get('maximum',math.inf):
        raise ValueError(path+': outside range')
    if kind == 'string':
        if len(value) < schema.get('minLength',0) or len(value) > schema.get('maxLength',10**9):
            raise ValueError(path+': invalid string length')
        if 'pattern' in schema and not re.fullmatch(schema['pattern'],value):
            raise ValueError(path+': invalid string')
    return value


def schema(name):
    return strict_json((ROOT/'evals/schemas'/name).read_text(encoding='utf-8'))


def load_fixture(path=None):
    path = Path(path) if path else ROOT/'evals/fixtures/bilingual-quality-v1.json'
    raw = path.read_bytes()
    manifest = strict_json((ROOT/'evals/fixtures/manifest.json').read_text(encoding='utf-8'))
    if hashlib.sha256(raw).hexdigest() != manifest['bilingual_quality_v1_sha256']:
        raise ValueError('Frozen fixture hash mismatch; version fixture before changing judgments')
    fixture = validate(strict_json(raw.decode('utf-8')),schema('fixture.schema.json'))
    from quality_metrics import LABELS
    if fixture['labels'] != LABELS:
        raise ValueError('Label order mismatch')
    for name in ('classification','documents','retrieval'):
        ids = [row['id'] for row in fixture[name]]
        if len(set(ids)) != len(ids):
            raise ValueError('Duplicate fixture IDs')
    if {r['language'] for r in fixture['classification']} != {'zh','en'}:
        raise ValueError('Bilingual coverage required')
    groups = {d['group'] for d in fixture['documents']}
    ids = {d['id'] for d in fixture['documents']}
    if any(set(q['relevant_groups'])-groups or set(q['forbidden_ids'])-ids for q in fixture['retrieval']):
        raise ValueError('Unknown relevance judgment')
    return fixture, manifest['bilingual_quality_v1_sha256']


def validate_report(report):
    validate(report,schema('report.schema.json'))
    manifest = strict_json((ROOT/'evals/fixtures/manifest.json').read_text(encoding='utf-8'))
    if report['fixture_sha256'] != manifest['bilingual_quality_v1_sha256']:
        raise ValueError('Report fixture mismatch')
    for section in ('classification','public_retrieval','public_retrieval_oracle_emotion'):
        if set(report[section]) != {'zh','en','all'}:
            raise ValueError('Report missing language partition')
        field = 'examples' if section == 'classification' else 'queries'
        if report[section]['all'][field] != sum(report[section][lang][field] for lang in ('zh','en')):
            raise ValueError('Report inconsistent sample counts')
    for value in report['classification'].values():
        if any(count > value['examples'] for count in value['label_support'].values()):
            raise ValueError('Impossible label support')
    for section in ('public_retrieval','public_retrieval_oracle_emotion'):
        for value in report[section].values():
            if value['queries'] != value['answerable_queries'] + value['no_answer_queries'] or not value['forbidden_hits'] <= value['false_hits'] <= value['returned_hits'] <= value['queries']*value['k']:
                raise ValueError('Inconsistent retrieval counts')
    # Recompute from complete per-case evidence. A plausible-looking aggregate alone
    # must not turn an incomplete or altered run into a successful quality report.
    from quality_metrics import LABELS, classification_metrics, retrieval_metrics
    fixture,_=load_fixture()
    expected={case['id']:case for case in fixture['classification']}
    observed=report['classification_cases']
    if len(observed)!=len(expected) or {case['id'] for case in observed}!=set(expected):
        raise ValueError('Incomplete classification cases')
    for case in observed:
        original=expected[case['id']]
        if case['expected']!=original['labels'] or case['language']!=original['language'] or case['predicted']!=[label for label in LABELS if case['probabilities'][label]>=.5]:
            raise ValueError('Altered classification evidence')
    def same(actual,calculated):
        for key,value in calculated.items():
            if type(value) is float:
                if abs(actual[key]-value)>1e-10:raise ValueError('Aggregate metric does not match evidence')
            elif actual[key]!=value:raise ValueError('Aggregate count does not match evidence')
    for language in ('zh','en','all'):
        rows=[c for c in observed if language=='all' or c['language']==language]
        calculated=classification_metrics([[int(label in c['expected']) for label in LABELS] for c in rows],[[c['probabilities'][label] for label in LABELS] for c in rows])
        same(report['classification'][language],calculated)
    expected_queries={q['id']:q for q in fixture['retrieval']}
    observed_queries=report['public_retrieval_cases']
    documents={d['id']:d for d in fixture['documents']}
    if len(observed_queries)!=len(expected_queries) or {q['id'] for q in observed_queries}!=set(expected_queries):
        raise ValueError('Incomplete retrieval cases')
    for case in observed_queries:
        original=expected_queries[case['id']]
        if case['language']!=original['language'] or case['relevant_groups']!=original['relevant_groups']:
            raise ValueError('Altered retrieval judgments')
        if any(len(case[key])>3 or set(case[key])-set(documents) for key in ('retrieved_document_ids','oracle_document_ids')):
            raise ValueError('Unknown retrieval document')
    for section,field in (('public_retrieval','retrieved_document_ids'),('public_retrieval_oracle_emotion','oracle_document_ids')):
        for language in ('zh','en','all'):
            rows=[{'relevant_ids':q['relevant_groups'],'forbidden_ids':list({documents[x]['group'] for x in expected_queries[q['id']]['forbidden_ids']}),
                'retrieved_ids':[documents[x]['group'] for x in q[field]]} for q in observed_queries if language=='all' or q['language']==language]
            same(report[section][language],retrieval_metrics(rows,3))
    return report
