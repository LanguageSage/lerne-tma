import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TMA_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TMA_SRC = path.join(TMA_ROOT, 'app', 'src');
export const CARD_UI_DIR = path.join(TMA_SRC, 'card-ui');
export const ENTRY_FILE = path.join(CARD_UI_DIR, 'index.js');
export const SCOPED_CSS_FILE = path.join(CARD_UI_DIR, 'CardUiScoped.css');

export const FORBIDDEN_PACKAGES = new Set(['zustand', 'dexie', 'axios']);
export const FORBIDDEN_PATH_PREFIXES = [
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
  'utils/standaloneMode',
  'utils/localMode',
  'pilot/',
  'hooks/useAudio',
  'hooks/useSpeechRecognition.js',
  'i18n/i18nContext',
];

const JS_EXTENSIONS = ['', '.js', '.jsx', '.mjs', '.json'];

export function resolveLocalImport(fromFile, specifier) {
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
  throw new Error(`Cannot resolve import "${specifier}" from ${path.relative(TMA_ROOT, fromFile)}`);
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

export function collectSharedCardUiGraph() {
  const visitedJs = new Set();
  const visitedCss = new Set();
  const externalPackages = new Set();
  const jsViolations = [];
  const cssViolations = [];

  const forbiddenSelectors = [
    /(^|[\s,{])html(?=[\s,{.:#[])/m,
    /(^|[\s,{])body(?=[\s,{.:#[])/m,
    /(^|[\s,{])#root(?=[\s,{.:#[])/m,
    /(^|[\s,{]):root(?=[\s,{.:#[])/m,
  ];

  function checkCss(filePath, trail) {
    const real = path.resolve(filePath);
    if (visitedCss.has(real)) return;
    visitedCss.add(real);

    const raw = fs.readFileSync(real, 'utf8');
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/data:image\/[^'")]+/g, '');
    for (const pattern of forbiddenSelectors) {
      if (pattern.test(stripped)) {
        cssViolations.push(`${path.relative(TMA_ROOT, real)} matches global selector ${pattern}`);
      }
    }

    for (const spec of extractCssImports(raw)) {
      const target = resolveLocalImport(real, spec);
      if (target) checkCss(target, [...trail, spec]);
    }
  }

  function walkJs(filePath, trail) {
    const real = path.resolve(filePath);
    if (visitedJs.has(real)) return;
    visitedJs.add(real);

    const relFromSrc = path.relative(TMA_SRC, real).replace(/\\/g, '/');
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
    if (/\bfetch\s*\(/.test(content)) {
      jsViolations.push(`Forbidden fetch() call in ${relFromSrc}`);
    }
    if (relFromSrc !== 'utils/platform.js' && content.includes('/_capacitor_file_/')) {
      jsViolations.push(`Forbidden Capacitor asset URL literal "/_capacitor_file_/" in ${relFromSrc}`);
    }
    for (const spec of extractJsSpecifiers(content)) {
      if (!spec.startsWith('.')) {
        const pkgName = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        externalPackages.add(pkgName);
        if (FORBIDDEN_PACKAGES.has(pkgName)) {
          jsViolations.push(`Forbidden package "${spec}" imported from ${relFromSrc}`);
        }
        continue;
      }
      const nextFile = resolveLocalImport(real, spec);
      if (nextFile) {
        const relNext = path.relative(TMA_SRC, nextFile).replace(/\\/g, '/');
        if (nextFile.endsWith('.css')) {
          checkCss(nextFile, [...trail, relNext]);
        } else {
          walkJs(nextFile, [...trail, relNext]);
        }
      }
    }
  }

  walkJs(ENTRY_FILE, ['card-ui/index.js']);
  if (fs.existsSync(SCOPED_CSS_FILE)) {
    checkCss(SCOPED_CSS_FILE, ['card-ui/CardUiScoped.css']);
  }

  const allFiles = new Set([...visitedJs, ...visitedCss]);
  const srcRelativeFiles = [...allFiles]
    .map((absPath) => path.relative(TMA_SRC, absPath).replace(/\\/g, '/'))
    .sort();

  return {
    jsCount: visitedJs.size,
    cssCount: visitedCss.size,
    jsViolations,
    cssViolations,
    externalPackages: [...externalPackages].sort(),
    srcRelativeFiles,
  };
}
