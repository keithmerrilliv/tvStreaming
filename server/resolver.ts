/**
 * Resolver
 * ────────
 * The three-phase interpreter at the heart of the system. For each feature:
 *
 *   Phase 1 — Hard gates.       AND of `requires`. Any failure → denied, with
 *                               the failing predicate recorded.
 *   Phase 2 — Rung selection.   Walk `rungs` top-down; first match sets params.
 *   Phase 3 — Policy overrides. Business rules (rollout / firmware / entitlement)
 *                               applied AFTER capability logic, on a separate axis.
 *
 * Each phase is independently testable and composes by short-circuit: a feature
 * denied in phase 1 never reaches phase 3, and a denial always carries the
 * predicate ID that caused it. The cosmetic tier label is DERIVED from the
 * resulting grant set at the end — it is an output, never an input.
 */

import type {
  CapabilityProfile,
  FeatureGrant,
  TierName,
} from '../shared/handshake';
import type { CapabilityPredicate, FeatureSpec, PolicyOverrides } from '../shared/policy';
import { evaluate } from './evaluator';

/**
 * Inputs to phase 3 that aren't device capabilities: the session/business
 * context. Deliberately separate from CapabilityProfile so capability logic
 * and policy logic can't bleed into each other.
 */
export interface ResolveContext {
  /** Entitlements the session holds (content licensing, geo unlocks). */
  entitlements?: string[];
  /** Device firmware string, matched against PolicyOverrides.denyFirmware. */
  firmware?: string;
  /**
   * Stable per-device key for deterministic rollout bucketing. Defaults to a
   * hash of the device's identifying profile fields, so the same device always
   * lands in the same bucket without storing state or using a clock/RNG.
   */
  deviceKey?: string;
}

/** An ordered tier band: the highest band whose features are ALL enabled wins. */
export interface TierBand {
  tier: TierName;
  requiresFeatures: string[];
}

export interface ResolveResult {
  features: FeatureGrant[];
  tier: TierName;
}

export function resolve(
  specs: FeatureSpec[],
  profile: CapabilityProfile,
  bands: TierBand[],
  ctx: ResolveContext = {},
): ResolveResult {
  const deviceKey = ctx.deviceKey ?? defaultDeviceKey(profile);
  const features = specs.map((spec) => resolveFeature(spec, profile, { ...ctx, deviceKey }));
  return { features, tier: deriveTier(features, bands) };
}

export function resolveFeature(
  spec: FeatureSpec,
  profile: CapabilityProfile,
  ctx: ResolveContext,
): FeatureGrant {
  // ── Phase 1: hard gates ──────────────────────────────────────────────
  for (const gate of spec.requires) {
    const r = evaluate(gate, profile);
    if (!r.pass) {
      return denied(spec.feature, r.failedPredicate ?? gate.id, r.detail);
    }
  }

  // ── Phase 2: rung selection ──────────────────────────────────────────
  // No rungs → binary feature; gates passing is sufficient.
  let params: Record<string, unknown> | undefined;
  if (spec.rungs && spec.rungs.length > 0) {
    const selected = spec.rungs.find((rung) => evaluate(rung.when, profile).pass);
    if (!selected) {
      // Gates passed but the device clears no quality floor → cannot render.
      // Attribute the denial to the lowest rung's predicate for actionable telemetry.
      const lowest = spec.rungs[spec.rungs.length - 1]!;
      const why = evaluate(lowest.when, profile);
      return denied(spec.feature, why.failedPredicate ?? lowest.when.id, why.detail);
    }
    // Record WHICH rung was chosen alongside its params, so the grant is
    // self-describing downstream (e.g. params.rung === 'rung.gl1' in telemetry).
    params = { ...selected.params, rung: selected.id };
  }

  // ── Phase 3: policy overrides ────────────────────────────────────────
  const policyDenial = spec.policy ? applyPolicy(spec.policy, ctx, spec.feature) : undefined;
  if (policyDenial) {
    return denied(spec.feature, policyDenial.predicate, policyDenial.detail);
  }

  return params === undefined
    ? { feature: spec.feature, enabled: true }
    : { feature: spec.feature, enabled: true, params };
}

/** Returns a denial descriptor if any business rule blocks the feature. */
function applyPolicy(
  policy: PolicyOverrides,
  ctx: ResolveContext,
  feature: string,
): { predicate: string; detail?: string } | undefined {
  if (policy.requiresEntitlement) {
    const held = ctx.entitlements ?? [];
    if (!held.includes(policy.requiresEntitlement)) {
      return {
        predicate: 'policy.entitlement',
        detail: `missing entitlement '${policy.requiresEntitlement}'`,
      };
    }
  }

  if (policy.denyFirmware && ctx.firmware) {
    const fw = ctx.firmware;
    if (policy.denyFirmware.some((pat) => fw.includes(pat))) {
      return { predicate: 'policy.firmware', detail: `firmware '${fw}' blocked` };
    }
  }

  if (policy.rolloutPercent !== undefined) {
    const roll = rolloutRoll(ctx.deviceKey ?? '', feature);
    if (roll >= policy.rolloutPercent) {
      return {
        predicate: 'policy.rollout',
        detail: `roll ${roll} outside ${policy.rolloutPercent}% bucket`,
      };
    }
  }

  return undefined;
}

function denied(feature: string, predicate: string, detail?: string): FeatureGrant {
  return {
    feature,
    enabled: false,
    deniedBy: detail === undefined ? { predicate } : { predicate, detail },
  };
}

/**
 * Cosmetic tier = the highest band all of whose features are enabled.
 * Bands are ordered strongest-first by the caller. Defaults to 'baseline'.
 */
export function deriveTier(grants: FeatureGrant[], bands: TierBand[]): TierName {
  const enabled = new Set(grants.filter((g) => g.enabled).map((g) => g.feature));
  for (const band of bands) {
    if (band.requiresFeatures.every((f) => enabled.has(f))) return band.tier;
  }
  return 'baseline';
}

// ─────────────────────────────────────────────────────────────
// Deterministic rollout — no RNG, no clock. Same device → same bucket.
// ─────────────────────────────────────────────────────────────

function rolloutRoll(deviceKey: string, feature: string): number {
  // Salt by the FEATURE id so two features at the same percentage don't gate the
  // identical cohort. The percentage is deliberately NOT part of the salt: ramping
  // a rollout up (say 40% → 60%) then only ADDS devices to the cohort — it never
  // reshuffles who is already in.
  return fnv1a(`${deviceKey}:${feature}`) % 100;
}

function defaultDeviceKey(profile: CapabilityProfile): string {
  const p = profile.platform;
  const version =
    p.kind === 'webos' ? p.webosVersion : p.kind === 'tizen' ? p.tizenVersion : undefined;
  // A stable, non-identifying fingerprint: platform + OS/shell version + GPU
  // string. Enough to bucket a device consistently across reboots — no stored
  // id, no PII — so the same device always lands in the same rollout cohort.
  return [p.kind, version ?? '?', profile.graphics.renderer ?? '?', profile.shellVersion].join(
    '|',
  );
}

function fnv1a(str: string): number {
  let h = 0x811c9dc5; // FNV-1a 32-bit offset basis
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // Math.imul does the multiply in true 32-bit space; a plain `*` by the FNV
    // prime would overflow JS's 53-bit float and silently lose the low bits.
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0; // coerce to unsigned 32-bit so the downstream `% 100` is stable
}
