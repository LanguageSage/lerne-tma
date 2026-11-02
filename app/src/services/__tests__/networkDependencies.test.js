import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';
import { Linter } from 'eslint';

const src = fileURLToPath(new URL('../../', import.meta.url));
const service = name => resolve(src, 'services', name);
const label = file => relative(src, file).replaceAll('\\', '/');

// Follow the real ESM closure, including re-exports and literal dynamic imports.
// Bare package imports are external leaves; missing relative imports fail closed.
function dependencyGraph(roots) {
  const graph = new Map();
  const linter = new Linter();
  function visit(file) {
    if (graph.has(file)) return;
    const edges = [];
    graph.set(file, edges);
    if (file.endsWith('.json')) return;
    const messages = linter.verify(readFileSync(file, 'utf8'), [{
      languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
    }]);
    assert.equal(messages.some(message => message.fatal), false, `Cannot parse ${label(file)}`);
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type)) {
        const specifier = node.source?.value;
        if (typeof specifier === 'string' && specifier.startsWith('.')) {
          const base = resolve(dirname(file), specifier);
          const target = [base, `${base}.js`, `${base}.jsx`, `${base}.json`, resolve(base, 'index.js')].find(existsSync);
          assert.ok(target, `Unresolved ${specifier} in ${label(file)}`);
          edges.push(target);
          visit(target);
        }
      }
      for (const [key, value] of Object.entries(node)) {
        if (key === 'parent') continue;
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === 'object') walk(value);
      }
    }
    walk(linter.getSourceCode().ast);
  }
  roots.forEach(visit);
  return graph;
}

test('API, sync and notes have an acyclic complete local dependency graph', t => {
  const graph = dependencyGraph(['api.js', 'syncService.js', 'cardNotes.js'].map(service));
  const visited = new Set();
  function visit(file, stack = []) {
    assert.ok(!stack.includes(file), `Dependency cycle: ${[...stack, file].map(label).join(' -> ')}`);
    if (visited.has(file)) return;
    for (const target of graph.get(file)) visit(target, [...stack, file]);
    visited.add(file);
  }
  for (const file of graph.keys()) visit(file);
  t.diagnostic(`${graph.size} local modules checked transitively`);
});

test('authenticated transport cannot reach offline routing, sync or note outboxes', () => {
  const graph = dependencyGraph([service('networkApi.js')]);
  for (const name of ['api.js', 'offlineApi.js', 'syncService.js', 'cardNotes.js']) {
    assert.equal(graph.has(service(name)), false, `Transport depends on ${name}`);
  }
});
