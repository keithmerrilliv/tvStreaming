/**
 * Resolver Service
 * ────────────────
 * Framework-agnostic request handlers. Pure(ish) functions from request
 * objects to response objects — no HTTP, no sockets — so the policy surface is
 * testable without a server and could be hosted on anything (node:http here,
 * a Lambda, an edge worker). server.ts is the only file that knows about HTTP.
 *
 * Two guarantees live here, both demanded by a permanently version-skewed fleet:
 *   1. Unknown profile fields are ignored, never rejected (structural typing +
 *      we only read what we know; the `ext` bag is never inspected).
 *   2. If resolution throws for ANY reason, the shell still gets a usable,
 *      conservative Baseline verdict rather than an error — a TV that can't
 *      resolve must still play video.
 */

import type {
  CapabilityProfile,
  ProbePlan,
  ProbePlanRequest,
  Verdict,
} from '../shared/handshake';
import { bundlesFor, FEATURE_SPECS, TIER_BANDS } from './catalog';
import { buildProbePlan } from './probePlan';
import { resolve, type ResolveContext } from './resolver';

const VERDICT_TTL_SECONDS = 30 * 60;

export function handleProbePlan(req: ProbePlanRequest): ProbePlan {
  return buildProbePlan(req);
}

export function handleResolve(profile: CapabilityProfile, ctx: ResolveContext = {}): Verdict {
  try {
    const { features, tier } = resolve(FEATURE_SPECS, profile, TIER_BANDS, ctx);
    const enabled = features.filter((f) => f.enabled).map((f) => f.feature);
    return {
      tier,
      features,
      bundles: bundlesFor(enabled),
      ttlSeconds: VERDICT_TTL_SECONDS,
      fallback: false,
    };
  } catch {
    // Resolution is best-effort. A malformed profile, a bad catalog edit, or
    // any unexpected throw must NOT brick a launch — degrade to Baseline.
    return baselineFallback();
  }
}

/**
 * The conservative verdict: no premium features, baseline bundles only,
 * a short TTL so the shell re-checks soon. Also what the shell itself uses
 * when the resolver is unreachable entirely.
 */
export function baselineFallback(): Verdict {
  return {
    tier: 'baseline',
    features: FEATURE_SPECS.map((s) => ({
      feature: s.feature,
      enabled: false,
      deniedBy: { predicate: 'resolver.fallback', detail: 'resolver unavailable' },
    })),
    bundles: bundlesFor([]),
    ttlSeconds: 60, // re-check in a minute; this is a degraded state
    fallback: true,
  };
}
