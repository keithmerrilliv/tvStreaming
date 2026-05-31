/**
 * Assemble the webOS app root and package it into an .ipk for the C9.
 * ──────────────────────────────────────────────────────────────────
 * Staging layout (dist/webos = the packaged app root):
 *   app.js          ← esbuild bundle (chrome53), written by `build:client`
 *   appinfo.json    ┐
 *   index.html      ├ static shell sources, copied from webos/
 *   icon.png        │
 *   largeIcon.png   ┘
 * Then: ares-package dist/webos -o dist  →  dist/<id>_<version>_all.ipk
 *
 *   node scripts/package-webos.mjs        (usually via `npm run package`)
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(root, 'webos');
const stageDir = join(root, 'dist', 'webos');
const outDir = join(root, 'dist');

function fail(msg) {
  console.error('\n✖ ' + msg + '\n');
  process.exit(1);
}

// 1. Resolve the packaging CLI. Prefer the locally-vendored @webosose/ares-cli
// (rimraf 3.x, callable) over any global ares-package — @webos-tools/cli 3.2.4
// ships a broken rimraf 6.x call ("rimraf is not a function") on every Node.
const localAres = join(root, 'node_modules', '.bin', 'ares-package');
const ares = existsSync(localAres) ? localAres : 'ares-package';
try {
  execFileSync(ares, ['--version'], { stdio: 'ignore' });
} catch {
  fail(
    [
      'ares-package not available.',
      'It is vendored as a devDependency; reinstall it with:',
      '  npm install',
      '(or install a webOS CLI globally: npm i -g @webosose/ares-cli)',
    ].join('\n  '),
  );
}

// 2. Is the transpiled bundle staged?
if (!existsSync(join(stageDir, 'app.js'))) {
  fail('Bundle missing: dist/webos/app.js\n  Run `npm run build:client` first (or `npm run build`).');
}

// 3. Copy the static shell sources into the app root.
mkdirSync(stageDir, { recursive: true });
const statics = ['appinfo.json', 'index.html', 'icon.png', 'largeIcon.png'];
for (const f of statics) {
  const from = join(srcDir, f);
  if (!existsSync(from)) {
    const hint = f.endsWith('.png') ? '\n  Run `npm run icons` to generate placeholder icons.' : '';
    fail('Missing webOS source file: webos/' + f + hint);
  }
  copyFileSync(from, join(stageDir, f));
}
console.log('staged dist/webos: ' + ['app.js', ...statics].join(', '));

// 4. Package.
execFileSync(ares, [stageDir, '-o', outDir], { stdio: 'inherit' });

// 5. Report the artifact.
const appinfo = JSON.parse(readFileSync(join(srcDir, 'appinfo.json'), 'utf8'));
const ipkName = `${appinfo.id}_${appinfo.version}_all.ipk`;
const ipkPath = join(outDir, ipkName);
if (existsSync(ipkPath)) {
  const kb = (statSync(ipkPath).size / 1024).toFixed(1);
  console.log(`\n✓ packaged: dist/${ipkName} (${kb} kb)`);
  console.log('  sideload: npm run install:webos   (needs a dev-mode TV set up via ares-setup-device)');
  console.log('  launch:   npm run launch:webos');
}
