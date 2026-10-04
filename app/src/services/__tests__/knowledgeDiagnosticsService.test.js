import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeDiagnosticsService, diagnosticsItemsQuery } from '../knowledgeDiagnosticsClient.js';
import { mapPoint } from '../../components/settings/knowledgeDiagnosticsMap.js';

test('diagnostics service uses summary and server-side items query', async () => {
  const urls = [];
  const service = createKnowledgeDiagnosticsService({ get: async url => { urls.push(url); return { data: { ok: true } }; } });
  assert.deepEqual(await service.summary(), { ok: true });
  assert.deepEqual(await service.items({ search: 'A & B', diagnostic_status: 'weak', confidence_min: 0.45, has_objective_evidence: false, sort_by: 'confidence', sort_dir: 'desc', limit: 25, offset: 50 }), { ok: true });
  assert.equal(urls[0], '/knowledge/diagnostics/summary');
  const url = new URL(urls[1], 'https://example.invalid');
  assert.equal(url.pathname, '/knowledge/diagnostics/items');
  assert.deepEqual(Object.fromEntries(url.searchParams), { search: 'A & B', diagnostic_status: 'weak', confidence_min: '0.45', has_objective_evidence: 'false', sort_by: 'confidence', sort_dir: 'desc', limit: '25', offset: '50' });
  assert.equal(diagnosticsItemsQuery({ search: '', language: null }), '/knowledge/diagnostics/items?');
});

test('HTTP errors propagate', async () => {
  const failure = new Error('HTTP 503');
  const service = createKnowledgeDiagnosticsService({ get: async () => { throw failure; } });
  await assert.rejects(service.summary(), error => error === failure);
  await assert.rejects(service.items({ limit: 25 }), error => error === failure);
});

test('map coordinates use recomputed values and exclude unobserved', () => {
  const item = { materialized_state: { proficiency: 0.9, confidence: 0.9 }, recomputed_state: { proficiency: 0.2, confidence: 0.5, diagnostic_status: 'weak' } };
  assert.deepEqual(mapPoint(item), { x: 132, y: 163 });
  assert.equal(mapPoint({ recomputed_state: { proficiency: 0.5, confidence: 0, diagnostic_status: 'unobserved' } }), null);
});
