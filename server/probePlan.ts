/**
 * Probe-Plan Builder (Round 1)
 * ────────────────────────────
 * The server tells the shell WHAT to measure. Because the plan ships from
 * server → shell at launch, detection itself stays updatable: a new codec
 * string or WebGL extension is added here, not in a recertified shell binary.
 *
 * The plan is derived from the union of everything the current catalog could
 * possibly need to evaluate, so it's automatically in sync with the feature
 * specs — add a predicate referencing a new codec and the probe plan picks it up.
 */

import type { ProbePlan, ProbePlanRequest } from '../shared/handshake';
import type { CapabilityPredicate } from '../shared/policy';
import { FEATURE_SPECS } from './catalog';

const PLAN_TTL_SECONDS = 6 * 60 * 60; // 6h — detection is stable within a session

export function buildProbePlan(req: ProbePlanRequest): ProbePlan {
  const codecs = new Set<string>();
  const glExtensions = new Set<string>();
  const drmSystems = new Map<string, Set<string>>();
  const runtimeChecks = new Set<string>();

  for (const spec of FEATURE_SPECS) {
    const predicates = [
      ...spec.requires,
      ...(spec.rungs ?? []).map((r) => r.when),
    ];
    predicates.forEach((p) => collect(p, { codecs, glExtensions, drmSystems, runtimeChecks }));
  }

  // The plan id encodes shell version so the server can tell which plan ran
  // when the profile comes back, without a clock or random id.
  const planId = `plan-${req.platform.kind}-${req.shellVersion}`;

  return {
    planId,
    codecs: [...codecs],
    glExtensions: [...glExtensions],
    drmSystems: [...drmSystems].map(([keySystem, levels]) => ({
      keySystem,
      robustness: [...levels],
    })),
    runtimeChecks: [...runtimeChecks],
    ttlSeconds: PLAN_TTL_SECONDS,
  };
}

interface Acc {
  codecs: Set<string>;
  glExtensions: Set<string>;
  drmSystems: Map<string, Set<string>>;
  runtimeChecks: Set<string>;
}

function collect(p: CapabilityPredicate, acc: Acc): void {
  switch (p.kind) {
    case 'codec':
      acc.codecs.add(p.contentType);
      break;
    case 'gl-extension':
      acc.glExtensions.add(p.extension);
      break;
    case 'drm': {
      const levels = acc.drmSystems.get(p.keySystem) ?? new Set<string>();
      if (p.minRobustness) levels.add(p.minRobustness);
      acc.drmSystems.set(p.keySystem, levels);
      break;
    }
    case 'runtime':
      acc.runtimeChecks.add(p.check);
      break;
    case 'and':
      p.all.forEach((c) => collect(c, acc));
      break;
    case 'or':
      p.any.forEach((c) => collect(c, acc));
      break;
    case 'webgl':
    case 'hdr':
      // No probe-plan target — these read fields the shell always measures.
      break;
  }
}
