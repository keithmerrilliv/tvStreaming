/**
 * Handshake Contract
 * ──────────────────
 * The frozen interface between the certified shell and the policy server.
 * This file is the single source of truth, imported by BOTH sides — there is
 * no second schema to drift out of sync.
 *
 * Design constraints:
 *   - Forward-compatible in both directions. The fleet is permanently
 *     version-skewed; unknown fields must be ignored, never rejected.
 *   - The shell sends measurements only — never a tier hint. All judgment
 *     lives server-side.
 *   - Two rounds: probe plan first (so detection itself stays updatable),
 *     then profile → verdict.
 */

// ─────────────────────────────────────────────────────────────
// ROUND 1: shell asks "what should I probe?" → server answers
// ─────────────────────────────────────────────────────────────

export interface ProbePlanRequest {
  /** e.g. "1.4.2" — lets the server tailor the plan to shell age. */
  shellVersion: string;
  /** Coarse platform info known at build time. */
  platform: Platform;
}

export type Platform =
  | { kind: 'webos'; webosVersion?: string }
  | { kind: 'tizen'; tizenVersion?: string }
  | { kind: 'android-tv'; api?: number }
  | { kind: 'browser' }; // dev/mock target

export interface ProbePlan {
  /** Echoed back in the profile so the server knows which plan ran. */
  planId: string;
  /** Codec strings to test via isTypeSupported / decodingInfo. */
  codecs: string[];
  /** WebGL extensions to query. */
  glExtensions: string[];
  /** Key systems + robustness levels to probe. */
  drmSystems: DrmQuery[];
  /** Named feature flags the probe engine knows how to test. */
  runtimeChecks: string[];
  /** How long the shell may cache results of this plan. */
  ttlSeconds: number;
}

export interface DrmQuery {
  /** e.g. "com.widevine.alpha", "com.microsoft.playready". */
  keySystem: string;
  /** Robustness levels to attempt, strongest first. */
  robustness?: string[];
}

// ─────────────────────────────────────────────────────────────
// ROUND 2: shell runs the plan → POSTs raw measurements up.
// No tier hint. Measurements only. The server owns all judgment.
// ─────────────────────────────────────────────────────────────

export interface CapabilityProfile {
  /** Which plan produced this profile. */
  planId: string;
  shellVersion: string;
  platform: Platform;
  /** ISO timestamp; lets the server reason about staleness. */
  capturedAt: string;

  codec: CodecResult[];
  graphics: GraphicsResult;
  drm: DrmResult[];
  display: DisplayResult;
  /** Named runtime check → supported. */
  runtime: Record<string, boolean>;

  /**
   * Forward-compat escape hatch. The shell MAY attach fields a future
   * server understands. The server MUST ignore unknown keys.
   */
  ext?: Record<string, unknown>;
}

export interface CodecResult {
  /** The exact content type string tested. */
  contentType: string;
  supported: boolean;
  /** From mediaCapabilities.decodingInfo, if available. */
  smooth?: boolean;
  powerEfficient?: boolean;
}

export interface GraphicsResult {
  /** 0 means no WebGL at all. */
  webglVersion: 0 | 1 | 2;
  maxTextureSize: number;
  /** Subset of the requested extensions actually present. */
  extensions: string[];
  /** UNMASKED_RENDERER if exposed (often isn't on TVs). */
  renderer?: string;
}

export interface DrmResult {
  keySystem: string;
  supported: boolean;
  /** Highest robustness level that actually succeeded. */
  robustness?: string;
  /** HDCP level if queryable. */
  hdcp?: string;
}

export interface DisplayResult {
  hdr: HdrFormat[];
  colorGamut?: 'srgb' | 'p3' | 'rec2020';
  // width/height deliberately omitted — TVs misreport routinely;
  // treat physical resolution as untrusted at this layer.
}

export type HdrFormat = 'hlg' | 'pq' | 'smpte2084' | 'none';

// ─────────────────────────────────────────────────────────────
// ROUND 2 RESPONSE: the verdict + what to load
// ─────────────────────────────────────────────────────────────

export interface Verdict {
  /** Cosmetic label — DERIVED from grants, never used to compute them. */
  tier: TierName;
  /** The real authority. Per-feature, not per-tier. */
  features: FeatureGrant[];
  /** What the shell should actually fetch. */
  bundles: BundleRef[];
  /** Cache lifetime keyed against the profile hash. */
  ttlSeconds: number;
  /** True if the server couldn't fully resolve and returned a degraded grant set. */
  fallback: boolean;
}

export type TierName = 'flagship' | 'standard' | 'baseline';

export interface FeatureGrant {
  /** Stable feature ID, e.g. "multi-angle", "hdr-overlay". */
  feature: string;
  enabled: boolean;
  /** Quality parameters chosen for this device, e.g. max bitrate. */
  params?: Record<string, unknown>;
  /**
   * Structured reason, present when enabled === false.
   * Critical for telemetry — drives "which predicate denied us" analysis.
   */
  deniedBy?: DenialReason;
}

export interface DenialReason {
  /** Which predicate ID failed, e.g. "runtime.es2020". */
  predicate: string;
  /** Human-readable hint, optional. */
  detail?: string;
}

export interface BundleRef {
  id: string;
  /** CDN URL. */
  url: string;
  /** Subresource Integrity hash. */
  integrity?: string;
  /** Required (baseline) vs. feature-gated. */
  required: boolean;
}
