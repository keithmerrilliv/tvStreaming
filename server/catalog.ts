/**
 * Feature Catalog
 * ───────────────
 * The hot-reloadable policy data: the feature specs the resolver interprets,
 * the tier bands the cosmetic label derives from, and the bundle map. In a
 * real deployment these are JSON/TS files reloaded without app resubmission;
 * here they're inline so the demo runs with zero external state.
 *
 * Note how the four "decision shapes" appear in the data, not the code:
 *   - Hard gate:                multi-angle.requires (AND of axes)
 *   - Graceful degradation:     hdr-overlay.rungs (webgl2 → webgl1 → ...)
 *   - Non-co-varying conjunction: multi-angle needs decode AND es2020 (the C9 problem)
 *   - Policy override:          multi-angle.policy.requiresEntitlement
 */

import type { BundleRef } from '../shared/handshake';
import type { FeatureSpec } from '../shared/policy';
import type { TierBand } from './resolver';

const HEVC_MAIN = 'video/mp4; codecs="hvc1.1.6.L120.B0"';

export const FEATURE_SPECS: FeatureSpec[] = [
  {
    feature: 'multi-angle',
    requires: [
      // Decode path: needs HEVC that the device can actually play smoothly.
      { id: 'codec.hevc-main', kind: 'codec', contentType: HEVC_MAIN, requireSmooth: true },
      // Runtime path: the orchestration layer is written against ES2020.
      // This is the axis the LG C9 fails despite excellent decode hardware.
      { id: 'runtime.es2020', kind: 'runtime', check: 'es2020' },
      // Security path: hardware-backed Widevine for premium live content.
      {
        id: 'drm.widevine-l1',
        kind: 'drm',
        keySystem: 'com.widevine.alpha',
        minRobustness: 'HW_SECURE_DECODE',
      },
    ],
    rungs: [
      {
        id: 'rung.flagship',
        params: { maxAngles: 4, bitrateCapKbps: 12000 },
        when: { id: 'rung.flagship.gl', kind: 'webgl', minVersion: 2 },
      },
      {
        id: 'rung.standard',
        params: { maxAngles: 2, bitrateCapKbps: 6000 },
        when: { id: 'rung.standard.gl', kind: 'webgl', minVersion: 1 },
      },
    ],
    policy: {
      // Premium live is licensed content — gated on entitlement, on its own axis.
      requiresEntitlement: 'live-premium',
    },
  },
  {
    feature: 'hdr-overlay',
    requires: [
      { id: 'display.hdr-any', kind: 'hdr', anyOf: ['hlg', 'pq'] },
      { id: 'graphics.webgl1', kind: 'webgl', minVersion: 1 },
    ],
    rungs: [
      {
        id: 'rung.gl2',
        params: { renderer: 'webgl2', maxParticles: 8000 },
        when: {
          id: 'rung.gl2.when',
          kind: 'webgl',
          minVersion: 2,
          minMaxTextureSize: 4096,
        },
      },
      {
        id: 'rung.gl1',
        params: { renderer: 'webgl1', maxParticles: 2000 },
        when: { id: 'rung.gl1.when', kind: 'webgl', minVersion: 1 },
      },
    ],
  },
];

/** Strongest band first. The resolver picks the highest all-enabled band. */
export const TIER_BANDS: TierBand[] = [
  { tier: 'flagship', requiresFeatures: ['multi-angle', 'hdr-overlay'] },
  { tier: 'standard', requiresFeatures: ['hdr-overlay'] },
  { tier: 'baseline', requiresFeatures: [] },
];

/** Always-required baseline bundles plus the feature-gated ones. */
const REQUIRED_BUNDLES: BundleRef[] = [
  { id: 'app-core', url: 'https://cdn.example/app-core.v7.js', required: true },
  { id: 'player-shaka', url: 'https://cdn.example/player-shaka.v7.js', required: true },
];

const FEATURE_BUNDLES: Record<string, BundleRef> = {
  'multi-angle': {
    id: 'feat-multi-angle',
    url: 'https://cdn.example/feat-multi-angle.v3.js',
    required: false,
  },
  'hdr-overlay': {
    id: 'feat-hdr-overlay',
    url: 'https://cdn.example/feat-hdr-overlay.v3.js',
    required: false,
  },
};

/** The bundle set a shell should fetch: baseline + every enabled feature's bundle. */
export function bundlesFor(enabledFeatures: string[]): BundleRef[] {
  const extra = enabledFeatures
    .map((f) => FEATURE_BUNDLES[f])
    .filter((b): b is BundleRef => b !== undefined);
  return [...REQUIRED_BUNDLES, ...extra];
}
