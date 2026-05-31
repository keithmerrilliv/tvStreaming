/**
 * Audit ONLY the production dependency closure — i.e. what actually ships
 * inside the .ipk (the bundled runtime deps), not the local build/test tools.
 *
 * Why not `npm audit --omit=dev`? In npm 10 that flag still reports advisories
 * from devDependencies (e.g. the vendored webOS packaging CLI), so it shows a
 * scary count for code that never reaches the TV. This filters npm's own
 * advisory JSON down to the real production closure and reports that.
 *
 *   npm run audit:prod
 */
import { execFileSync } from 'node:child_process';

// npm audit / npm ls exit non-zero when they have something to report, but
// still emit valid JSON on stdout — parse that rather than trusting the code.
function jsonOut(cmd, args) {
  try {
    return JSON.parse(execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20 }));
  } catch (err) {
    if (err.stdout) return JSON.parse(err.stdout.toString());
    throw err;
  }
}

// Production closure = every package reachable from `dependencies` (dev pruned).
const tree = jsonOut('npm', ['ls', '--omit=dev', '--all', '--json']);
const prod = new Set();
(function walk(node) {
  for (const [name, dep] of Object.entries(node.dependencies || {})) {
    if (!prod.has(name)) {
      prod.add(name);
      walk(dep);
    }
  }
})(tree);

const vulns = jsonOut('npm', ['audit', '--json']).vulnerabilities || {};
const hits = Object.keys(vulns).filter((name) => prod.has(name));

console.log(`production closure (${prod.size} pkg): ${[...prod].join(', ') || '(none)'}`);
if (hits.length === 0) {
  console.log('✓ 0 advisories in production dependencies — the shipped .ipk is clean.');
  console.log('  (dev-only build/packaging tools are excluded; run `npm audit` to see those.)');
  process.exit(0);
}
console.log(`✗ ${hits.length} production advisory package(s):`);
for (const name of hits) console.log(`  - ${name}: ${vulns[name].severity}`);
process.exit(1);
