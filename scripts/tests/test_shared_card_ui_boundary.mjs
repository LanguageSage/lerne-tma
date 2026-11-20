import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'app', 'src');
const ENTRY = path.join(SRC, 'card-ui', 'index.js');
const SCOPED_CSS = path.join(SRC, 'card-ui', 'CardUiScoped.css');

const FORBIDDEN_PACKAGES = new Set(['zustand', 'dexie', 'axios']);
const FORBIDDEN_PATH_PREFIXES = [
  'store/',
  'services/api',
  'services/localDb',
  'services/syncService',
  'services/cardSave',
  'services/cardOfflineQueue',
  'services/cardOutboxSync',
  'services/cardNotes',
  'services/cardRatings',
  'services/answerEvaluationService',
  'services/assessmentService',
  'services/knowledge',
  'services/offlineUi',
  'utils/auth',
  'utils/navigation',
  'hooks/useAudio',
  'hooks/useSpeechRecognition.js',
  'i18n/i18nContext',
];

const JS_EXTENSIONS = ['', '.js', '.jsx', '.mjs', '.json'];

function resolveLocal(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const ext of JS_EXTENSIONS) {
    const candidate = base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    for (const indexName of ['index.js', 'index.jsx']) {
      const candidate = path.join(base, indexName);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error(`Cannot resolve import "${specifier}" from ${path.relative(ROOT, fromFile)}`);
}

function extractJsSpecifiers(source) {
  const specs = [];
  const staticRe = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const re of [staticRe, dynamicRe]) {
    let match;
    while ((match = re.exec(source)) !== null) specs.push(match[1]);
  }
  return specs;
}

function extractCssImports(source) {
  const specs = [];
  const re = /@import\s+['"]([^'"]+)['"]\s*;/g;
  let match;
  while ((match = re.exec(source)) !== null) specs.push(match[1]);
  return specs;
}

const visitedJs = new Set();
const visitedCss = new Set();
const jsViolations = [];
const cssViolations = [];

function checkCss(filePath, trail) {
  const real = path.resolve(filePath);
  if (visitedCss.has(real)) return;
  visitedCss.add(real);

  const raw = fs.readFileSync(real, 'utf8');
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/data:image\/[^'")]+/g, '');
  const forbiddenSelectors = [
    /(^|[\s,{])html(?=[\s,{.:#[])/m,
    /(^|[\s,{])body(?=[\s,{.:#[])/m,
    /(^|[\s,{])#root(?=[\s,{.:#[])/m,
    /(^|[\s,{]):root(?=[\s,{.:#[])/m,
  ];
  for (const pattern of forbiddenSelectors) {
    if (pattern.test(stripped)) {
      cssViolations.push(`${path.relative(ROOT, real)} matches global selector ${pattern}`);
    }
  }

  for (const spec of extractCssImports(raw)) {
    const target = resolveLocal(real, spec);
    if (target) checkCss(target, [...trail, spec]);
  }
}

function walkJs(filePath, trail) {
  const real = path.resolve(filePath);
  if (visitedJs.has(real)) return;
  visitedJs.add(real);

  const relFromSrc = path.relative(SRC, real).replace(/\\/g, '/');
  for (const forbidden of FORBIDDEN_PATH_PREFIXES) {
    if (relFromSrc === forbidden || relFromSrc.startsWith(forbidden)) {
      jsViolations.push(`Forbidden module reached: ${relFromSrc} (via ${trail.join(' -> ')})`);
    }
  }

  if (real.endsWith('.json')) return;
  if (real.endsWith('.css')) {
    checkCss(real, trail);
    return;
  }

  const content = fs.readFileSync(real, 'utf8');
  for (const spec of extractJsSpecifiers(content)) {
    if (!spec.startsWith('.')) {
      const pkgName = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      if (FORBIDDEN_PACKAGES.has(pkgName)) {
        jsViolations.push(`Forbidden package "${spec}" imported from ${relFromSrc}`);
      }
      continue;
    }
    const nextFile = resolveLocal(real, spec);
    if (nextFile) {
      if (nextFile.endsWith('.css')) {
        checkCss(nextFile, [...trail, path.relative(SRC, nextFile).replace(/\\/g, '/')]);
      } else {
        walkJs(nextFile, [...trail, path.relative(SRC, nextFile).replace(/\\/g, '/')]);
      }
    }
  }
}

walkJs(ENTRY, ['card-ui/index.js']);
if (fs.existsSync(SCOPED_CSS)) {
  checkCss(SCOPED_CSS, ['card-ui/CardUiScoped.css']);
}

assert.deepEqual(jsViolations, [], `Boundary JS violations:\n${jsViolations.join('\n')}`);
assert.deepEqual(cssViolations, [], `Boundary CSS violations:\n${cssViolations.join('\n')}`);

console.log(`PASS: @lerne/card-ui boundary verified (${visitedJs.size} JS/JSON modules, ${visitedCss.size} CSS files, 0 violations).`);
