import assert from 'node:assert/strict';
import { collectSharedCardUiGraph } from '../card_ui_package.mjs';

const graph = collectSharedCardUiGraph();

assert.deepEqual(graph.jsViolations, [], `Boundary JS violations:\n${graph.jsViolations.join('\n')}`);
assert.deepEqual(graph.cssViolations, [], `Boundary CSS violations:\n${graph.cssViolations.join('\n')}`);

console.log(
  `PASS: @lerne/card-ui boundary verified (${graph.jsCount} JS/JSON modules, ${graph.cssCount} CSS files, 0 violations).`,
);
