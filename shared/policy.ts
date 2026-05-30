/**
 * Resolver Policy
 * ───────────────
 * The declarative shape of what the resolver evaluates. Each feature gets a
 * FeatureSpec; the resolver is a three-phase interpreter (see server/resolver.ts):
 *
 *   1. Evaluate `requires` (hard gates). ALL must pass.
 *   2. Walk `rungs` top-down; pick the first whose predicate matches.
 *   3. Apply `policy` overrides (business rules, evaluated last).
 *
 * The cosmetic tier label is DERIVED from the resulting grant set — never
 * computed first and used to gate features.
 *
 * Predicates are introspectable: a denial records WHICH predicate failed, not
 * just THAT one did. That is what makes telemetry useful ("140k devices denied
 * solely by runtime.es2020") and what makes future-device support work without
 * special-casing.
 */

import type { CapabilityProfile } from './handshake';

// ─────────────────────────────────────────────────────────────
// Feature specification
// ─────────────────────────────────────────────────────────────

export interface FeatureSpec {
  /** Stable feature ID, e.g. "multi-angle". */
  feature: string;

  /** Hard gates. ALL must pass or the feature is denied outright. */
  requires: CapabilityPredicate[];

  /**
   * Quality rungs, evaluated top-down. First match wins.
   * Omitted → the feature is binary on/off (no quality scaling).
   * The highest-quality rung should come first.
   */
  rungs?: FeatureRung[];

  /**
   * Business-layer overrides. Evaluated AFTER capability logic.
   * Kept separate because they change on a different cadence and for
   * different reasons than capability gates.
   */
  policy?: PolicyOverrides;
}

export interface FeatureRung {
  /** Stable ID surfaced in the grant for telemetry/debugging. */
  id: string;
  /** Parameters passed into FeatureGrant.params when this rung is selected. */
  params: Record<string, unknown>;
  /** Predicate that must hold for this rung to apply. */
  when: CapabilityPredicate;
}

export interface PolicyOverrides {
  /** 0–100; deny if the device's stable roll lands outside the bucket. */
  rolloutPercent?: number;
  /** Firmware strings or patterns to deny. */
  denyFirmware?: string[];
  /** Entitlement ID the user/session must hold (content licensing, geo, etc). */
  requiresEntitlement?: string;
}

// ─────────────────────────────────────────────────────────────
// Predicate vocabulary
// ─────────────────────────────────────────────────────────────
// First-pass set. Composites (and/or) cover the common richer expressions;
// the open question (see docs/INTERVIEW.md §"Open threads") is whether we also
// need count-thresholds and version ranges as first-class predicates.
// Every predicate carries an `id` so denials are recordable.

export type CapabilityPredicate =
  | CodecSupportedPredicate
  | WebglVersionPredicate
  | GlExtensionPredicate
  | DrmPredicate
  | HdrPredicate
  | RuntimePredicate
  | AndPredicate
  | OrPredicate;

export interface PredicateBase {
  /** Stable ID used in denial reasons, e.g. "codec.hevc-main10". */
  id: string;
}

export interface CodecSupportedPredicate extends PredicateBase {
  kind: 'codec';
  /** Content type string that must report supported. */
  contentType: string;
  /** Optional: also require smooth playback per mediaCapabilities. */
  requireSmooth?: boolean;
}

export interface WebglVersionPredicate extends PredicateBase {
  kind: 'webgl';
  /** Minimum WebGL major version required. */
  minVersion: 1 | 2;
  /** Optional minimum max-texture-size. */
  minMaxTextureSize?: number;
}

export interface GlExtensionPredicate extends PredicateBase {
  kind: 'gl-extension';
  /** Extension that must be present. */
  extension: string;
}

export interface DrmPredicate extends PredicateBase {
  kind: 'drm';
  keySystem: string;
  /** Optional minimum robustness level (resolved against an ordered ladder). */
  minRobustness?: string;
}

export interface HdrPredicate extends PredicateBase {
  kind: 'hdr';
  /** Any of these HDR formats satisfies the predicate. */
  anyOf: ('hlg' | 'pq' | 'smpte2084')[];
}

export interface RuntimePredicate extends PredicateBase {
  kind: 'runtime';
  /** Named runtime check that must report true. */
  check: string;
}

/** All children must pass. */
export interface AndPredicate extends PredicateBase {
  kind: 'and';
  all: CapabilityPredicate[];
}

/** At least one child must pass. */
export interface OrPredicate extends PredicateBase {
  kind: 'or';
  any: CapabilityPredicate[];
}

// ─────────────────────────────────────────────────────────────
// Evaluation result types
// ─────────────────────────────────────────────────────────────

export interface EvaluationResult {
  pass: boolean;
  /** When pass === false, which predicate ID failed (the deepest leaf). */
  failedPredicate?: string;
  /** Optional human-readable hint propagated into DenialReason.detail. */
  detail?: string;
}

/** Pure function signature; the implementation lives in server/evaluator.ts. */
export type Evaluator = (
  predicate: CapabilityPredicate,
  profile: CapabilityProfile,
) => EvaluationResult;

/**
 * Robustness ladder, weakest → strongest. Used to compare a DRM predicate's
 * `minRobustness` against the level a device actually reported. Centralised
 * here so shell and server agree on ordering.
 */
export const ROBUSTNESS_LADDER = [
  'SW_SECURE_CRYPTO',
  'SW_SECURE_DECODE',
  'HW_SECURE_CRYPTO',
  'HW_SECURE_DECODE',
  'HW_SECURE_ALL',
] as const;
