/**
 * Demo / smoke script
 * ───────────────────
 * Runs the full two-round handshake against every device fixture using the
 * in-process service (no HTTP, no DOM), then prints:
 *   1. the per-device verdict (tier + per-feature grants with denial reasons), and
 *   2. the telemetry rollup — denials grouped by predicate, i.e. the ranked
 *      "what would unlock the most devices" list that falls out for free.
 *
 * Run: `npm run demo`
 */

import { handleProbePlan, handleResolve } from '../server/service';
import { ALL_FIXTURES } from '../client/fixtures/devices';
import type { Verdict } from '../shared/handshake';

const ENTITLEMENTS = ['live-premium'];

function line(s = ''): void {
  console.log(s);
}

function printVerdict(name: string, verdict: Verdict): void {
  line(`\n■ ${name}  →  tier=${verdict.tier}${verdict.fallback ? ' (fallback)' : ''}`);
  for (const g of verdict.features) {
    if (g.enabled) {
      const rung = (g.params as { rung?: string } | undefined)?.rung;
      line(`    ✓ ${g.feature}${rung ? `  [${rung}]` : ''}`);
    } else {
      line(`    ✗ ${g.feature}  ← ${g.deniedBy?.predicate}  (${g.deniedBy?.detail ?? ''})`);
    }
  }
  line(`    bundles: ${verdict.bundles.map((b) => b.id).join(', ')}`);
}

const denialCounts = new Map<string, number>();

for (const [name, profile] of Object.entries(ALL_FIXTURES)) {
  // Round 1 (the plan is the same regardless of fixture here, but we exercise it).
  handleProbePlan({ shellVersion: profile.shellVersion, platform: profile.platform });
  // Round 2.
  const verdict = handleResolve(profile, { entitlements: ENTITLEMENTS });
  printVerdict(name, verdict);

  for (const g of verdict.features) {
    if (!g.enabled && g.deniedBy) {
      denialCounts.set(g.deniedBy.predicate, (denialCounts.get(g.deniedBy.predicate) ?? 0) + 1);
    }
  }
}

line('\n── Telemetry rollup: denials by predicate (the unlock list) ──');
[...denialCounts.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([predicate, count]) => line(`    ${String(count).padStart(2)}×  ${predicate}`));
line();
