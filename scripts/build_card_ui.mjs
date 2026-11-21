import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  CARD_UI_DIR,
  TMA_ROOT,
  TMA_SRC,
  collectSharedCardUiGraph,
} from './card_ui_package.mjs';

function parseArgs(argv) {
  let outDir = path.join(TMA_ROOT, 'local', 'test-data', 'card-ui-dist');
  let adminDir = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out-dir' && argv[i + 1]) {
      outDir = path.resolve(argv[++i]);
    } else if (argv[i] === '--admin-dir' && argv[i + 1]) {
      adminDir = path.resolve(argv[++i]);
    }
  }
  return { outDir, adminDir };
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function writeOctal(buf, offset, length, value) {
  const oct = Math.floor(value).toString(8).padStart(length - 1, '0');
  buf.write(oct.slice(-(length - 1)) + '\0', offset, length, 'ascii');
}

function createTarHeader(entryPath, size) {
  const header = Buffer.alloc(512, 0);
  let name = entryPath;
  let prefix = '';
  if (Buffer.byteLength(entryPath, 'utf8') > 100) {
    const slashIdx = entryPath.indexOf('/', Math.max(0, entryPath.length - 100));
    if (slashIdx <= 0 || slashIdx > 155 || entryPath.length - slashIdx - 1 > 100) {
      throw new Error(`Tar path too long: ${entryPath}`);
    }
    prefix = entryPath.slice(0, slashIdx);
    name = entryPath.slice(slashIdx + 1);
  }
  header.write(name, 0, 100, 'utf8');
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0); // Fixed mtime for deterministic builds
  header.fill(0x20, 148, 156); // Placeholder spaces for checksum
  header.write('0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  if (prefix) header.write(prefix, 345, 155, 'utf8');

  let sum = 0;
  for (let i = 0; i < 512; i += 1) sum += header[i];
  const chk = sum.toString(8).padStart(6, '0');
  header.write(chk + '\0 ', 148, 8, 'ascii');
  return header;
}

function buildDeterministicTgz(entries) {
  const sorted = [...entries].sort((a, b) => a.tarPath.localeCompare(b.tarPath));
  const chunks = [];
  for (const entry of sorted) {
    chunks.push(createTarHeader(entry.tarPath, entry.content.length));
    chunks.push(entry.content);
    const rem = entry.content.length % 512;
    if (rem !== 0) chunks.push(Buffer.alloc(512 - rem, 0));
  }
  chunks.push(Buffer.alloc(1024, 0));
  return zlib.gzipSync(Buffer.concat(chunks), { level: 9 });
}

function main() {
  const { outDir, adminDir } = parseArgs(process.argv.slice(2));
  const graph = collectSharedCardUiGraph();
  if (graph.jsViolations.length || graph.cssViolations.length) {
    throw new Error(
      `Cannot build @lerne/card-ui with boundary violations:\n${[
        ...graph.jsViolations,
        ...graph.cssViolations,
      ].join('\n')}`,
    );
  }

  const pkgMeta = JSON.parse(fs.readFileSync(path.join(CARD_UI_DIR, 'package.json'), 'utf8'));
  const version = pkgMeta.version;
  const tgzName = `lerne-card-ui-${version}.tgz`;

  const fileEntries = [];
  const manifestFiles = {};

  for (const rel of graph.srcRelativeFiles) {
    const absPath = path.join(TMA_SRC, rel);
    const content = fs.readFileSync(absPath);
    const tarPath = `package/src/${rel}`;
    fileEntries.push({ tarPath, content });
    manifestFiles[`src/${rel}`] = sha256(content);
  }

  const rootPkgJson = Buffer.from(
    JSON.stringify(
      {
        name: pkgMeta.name || '@lerne/card-ui',
        version,
        private: true,
        type: 'module',
        main: './src/card-ui/index.js',
        sideEffects: ['**/*.css'],
        exports: {
          '.': './src/card-ui/index.js',
          './styles.css': './src/card-ui/CardUiScoped.css',
        },
        peerDependencies: {
          react: '^19.0.0',
          'react-dom': '^19.0.0',
        },
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  fileEntries.push({ tarPath: 'package/package.json', content: rootPkgJson });

  const internalManifest = Buffer.from(
    JSON.stringify(
      {
        name: pkgMeta.name || '@lerne/card-ui',
        version,
        file_count: Object.keys(manifestFiles).length,
        external_packages: graph.externalPackages,
        files: manifestFiles,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  fileEntries.push({ tarPath: 'package/manifest.json', content: internalManifest });

  const tgzBuffer = buildDeterministicTgz(fileEntries);
  const tgzSha256 = sha256(tgzBuffer);

  fs.mkdirSync(outDir, { recursive: true });
  const tgzOutPath = path.join(outDir, tgzName);
  fs.writeFileSync(tgzOutPath, tgzBuffer);

  const lockMeta = {
    name: pkgMeta.name || '@lerne/card-ui',
    version,
    filename: tgzName,
    sha256: tgzSha256,
    file_count: Object.keys(manifestFiles).length,
    files_sha256: sha256(internalManifest),
    external_packages: graph.externalPackages,
  };

  fs.writeFileSync(path.join(outDir, 'card_ui.json'), JSON.stringify(lockMeta, null, 2) + '\n', 'utf8');

  if (adminDir) {
    const adminVendorDir = path.join(adminDir, 'vendor');
    const adminCoreDir = path.join(adminDir, 'src', 'lerne_admin', 'core');
    fs.mkdirSync(adminVendorDir, { recursive: true });
    fs.mkdirSync(adminCoreDir, { recursive: true });
    fs.writeFileSync(path.join(adminVendorDir, tgzName), tgzBuffer);
    fs.writeFileSync(path.join(adminCoreDir, 'card_ui.json'), JSON.stringify(lockMeta, null, 2) + '\n', 'utf8');
  }

  console.log(
    JSON.stringify(
      {
        ...lockMeta,
        out_path: tgzOutPath,
        admin_dir: adminDir || null,
      },
      null,
      2,
    ),
  );
}

main();
