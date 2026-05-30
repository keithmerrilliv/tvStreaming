/**
 * Predicate Evaluator
 * ───────────────────
 * A pure function from (predicate, profile) → EvaluationResult. No I/O, no
 * clock, no policy. This is phase-0 plumbing the resolver leans on; keeping it
 * pure is what makes the whole policy layer unit-testable without a network.
 *
 * The single invariant that earns its keep: when a predicate fails, the result
 * names the *deepest leaf predicate ID* that caused the failure — not the
 * composite wrapping it. "multi-angle denied by runtime.es2020" is actionable;
 * "denied by requires" is not.
 */

import type { CapabilityProfile } from '../shared/handshake';
import type { CapabilityPredicate, EvaluationResult } from '../shared/policy';
import { ROBUSTNESS_LADDER } from '../shared/policy';

const pass: EvaluationResult = { pass: true };

function fail(id: string, detail?: string): EvaluationResult {
  return detail === undefined
    ? { pass: false, failedPredicate: id }
    : { pass: false, failedPredicate: id, detail };
}

export function evaluate(
  predicate: CapabilityPredicate,
  profile: CapabilityProfile,
): EvaluationResult {
  switch (predicate.kind) {
    case 'codec': {
      const hit = profile.codec.find((c) => c.contentType === predicate.contentType);
      if (!hit || !hit.supported) {
        return fail(predicate.id, 'codec not supported');
      }
      if (predicate.requireSmooth && hit.smooth !== true) {
        return fail(predicate.id, 'codec supported but not smooth');
      }
      return pass;
    }

    case 'webgl': {
      const g = profile.graphics;
      if (g.webglVersion < predicate.minVersion) {
        return fail(predicate.id, `webgl ${g.webglVersion} < ${predicate.minVersion}`);
      }
      if (
        predicate.minMaxTextureSize !== undefined &&
        g.maxTextureSize < predicate.minMaxTextureSize
      ) {
        return fail(
          predicate.id,
          `maxTextureSize ${g.maxTextureSize} < ${predicate.minMaxTextureSize}`,
        );
      }
      return pass;
    }

    case 'gl-extension': {
      return profile.graphics.extensions.includes(predicate.extension)
        ? pass
        : fail(predicate.id, `missing ${predicate.extension}`);
    }

    case 'drm': {
      const hit = profile.drm.find((d) => d.keySystem === predicate.keySystem);
      if (!hit || !hit.supported) {
        return fail(predicate.id, `${predicate.keySystem} unsupported`);
      }
      if (predicate.minRobustness !== undefined) {
        if (!robustnessMeets(hit.robustness, predicate.minRobustness)) {
          return fail(
            predicate.id,
            `robustness ${hit.robustness ?? 'none'} < ${predicate.minRobustness}`,
          );
        }
      }
      return pass;
    }

    case 'hdr': {
      const have = new Set(profile.display.hdr);
      return predicate.anyOf.some((f) => have.has(f))
        ? pass
        : fail(predicate.id, `none of ${predicate.anyOf.join('/')} present`);
    }

    case 'runtime': {
      return profile.runtime[predicate.check] === true
        ? pass
        : fail(predicate.id, `runtime check '${predicate.check}' false`);
    }

    case 'and': {
      for (const child of predicate.all) {
        const r = evaluate(child, profile);
        if (!r.pass) return r; // propagate the deepest leaf, not this `and`
      }
      return pass;
    }

    case 'or': {
      const failures: string[] = [];
      for (const child of predicate.any) {
        const r = evaluate(child, profile);
        if (r.pass) return pass;
        if (r.failedPredicate) failures.push(r.failedPredicate);
      }
      // None matched — attribute to the `or` itself, listing the branches tried.
      return fail(predicate.id, `no branch passed (${failures.join(', ')})`);
    }
  }
}

/** True if `have` is at least as strong as `need` on the shared ladder. */
function robustnessMeets(have: string | undefined, need: string): boolean {
  if (have === undefined) return false;
  const haveIdx = ROBUSTNESS_LADDER.indexOf(have as (typeof ROBUSTNESS_LADDER)[number]);
  const needIdx = ROBUSTNESS_LADDER.indexOf(need as (typeof ROBUSTNESS_LADDER)[number]);
  // Unknown levels are treated conservatively: an unknown requirement is never
  // satisfied; an unknown reported level never satisfies a known requirement.
  if (haveIdx < 0 || needIdx < 0) return false;
  return haveIdx >= needIdx;
}
