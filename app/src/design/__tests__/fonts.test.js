import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { FONT_OPTIONS } from '../../components/settings/design/designConstants.js';

const root = new URL('../../../public/fonts/', import.meta.url);
const css = readFileSync(new URL('fonts.css', root), 'utf8');

test('every existing selectable family is self-hosted, with no extra families or external URLs', () => {
  const families = [...new Set([...css.matchAll(/font-family: '([^']+)'/g)].map(m => m[1]))].sort();
  assert.deepEqual(families, FONT_OPTIONS.map(f => f.value).sort());
  assert.doesNotMatch(css, /https?:|@import|local\(/);
  const assets = new Set([...css.matchAll(/url\(\/fonts\/([^)]*)\)/g)].map(m => m[1]));
  assert.ok(assets.size > 0);
  for (const asset of assets) {
    assert.equal(readFileSync(new URL(asset, root)).subarray(0, 4).toString(), 'wOF2', asset);
  }
  assert.deepEqual([...assets].sort(), readdirSync(root).filter(f => f.endsWith('.woff2')).sort());
  for (const { value } of FONT_OPTIONS) {
    const license = readFileSync(new URL(`${value.toLowerCase().replaceAll(' ', '')}-OFL.txt`, root), 'utf8');
    assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
    assert.match(license, /Copyright/);
  }
});

test('the common entry loads fonts before the app without a Google dependency', () => {
  const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
  const indexCss = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
  assert.match(html, /href="\/fonts\/fonts.css" rel="stylesheet"/);
  assert.doesNotMatch(html + indexCss, /fonts\.googleapis|fonts\.gstatic/);
  for (const face of css.matchAll(/@font-face\s*\{([^}]+)\}/g)) {
    assert.match(face[1], /font-display: swap/);
    assert.match(face[1], /unicode-range:/);
  }
});
