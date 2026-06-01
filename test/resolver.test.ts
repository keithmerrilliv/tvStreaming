/**
 * Resolver tests — the three phases, on real device fixtures
 * ──────────────────────────────────────────────────────────
 * The headline cases: the C9 conjunction (denied SOLELY on runtime.es2020
 * despite capable decode + DRM), the modern-GPU/old-runtime gap profile, rung
 * selection (graceful degradation), policy as a separate axis evaluated last,
 * and that deriveTier is a pure function of the grant set — output, not input.
 */
import { describe, expect, it } from 'vitest';
import type { FeatureGrant } from '../shared/handshake';
import type { FeatureSpec } from '../shared/policy';
import { deriveTier, resolve, resolveFeature, type TierBand } from '../server/resolver';
import { FEATURE_SPECS, TIER_BANDS } from '../server/catalog';
import {
  baselineStb,
  gapModernGpuOldRuntime,
  lgC9,
  tizen2024Flagship,
} from '../client/fixtures/devices';

const grantFor = (grants: FeatureGrant[], feature: string): FeatureGrant => {
  const g = grants.find((x) => x.feature === feature);
  if (!g) throw new Error(`no grant for ${feature}`);
  return g;
};

describe('the C9 problem — independent capability axes', () => {
  it('denies multi-angle SOLELY on runtime.es2020, despite capable decode + DRM', () => {
    // Entitlement granted on purpose: proves the denial is the runtime gate,
    // not the business policy that comes later.
    const { features } = resolve(FEATURE_SPECS, lgC9, TIER_BANDS, {
      entitlements: ['live-premium'],
    });
    const ma = grantFor(features, 'multi-angle');
    expect(ma.enabled).toBe(false);
    expect(ma.deniedBy?.predicate).toBe('runtime.es2020');
  });

  it('still grants hdr-overlay on the C9, at the WebGL1 rung', () => {
    const { features, tier } = resolve(FEATURE_SPECS, lgC9, TIER_BANDS);
    const hdr = grantFor(features, 'hdr-overlay');
    expect(hdr.enabled).toBe(true);
    expect(hdr.params).toMatchObject({ renderer: 'webgl1', rung: 'rung.gl1' });
    // Hardware can, runtime can't → it lands at 'standard', not denied, not flagship.
    expect(tier).toBe('standard');
  });
});

describe('the gap profile — modern GPU, old runtime', () => {
  it('denies multi-angle for the runtime reason, NOT a graphics one (WebGL2 present)', () => {
    const { features } = resolve(FEATURE_SPECS, gapModernGpuOldRuntime, TIER_BANDS, {
      entitlements: ['live-premium'],
    });
    const ma = grantFor(features, 'multi-angle');
    expect(ma.enabled).toBe(false);
    expect(ma.deniedBy?.predicate).toBe('runtime.es2020');
  });
});

describe('rung selection (graceful degradation)', () => {
  it('picks the flagship rung when WebGL2 + large textures are present', () => {
    const { features } = resolve(FEATURE_SPECS, tizen2024Flagship, TIER_BANDS, {
      entitlements: ['live-premium'],
    });
    const ma = grantFor(features, 'multi-angle');
    expect(ma.enabled).toBe(true);
    expect(ma.params).toMatchObject({ rung: 'rung.flagship', maxAngles: 4 });
  });

  it('denies when the gates pass but no rung clears the quality floor', () => {
    // Gates pass (none required), but the only rung needs WebGL2 and the baseline
    // set-top reports WebGL 0 — so it clears no quality floor.
    const spec: FeatureSpec = {
      feature: 'fancy-overlay',
      requires: [],
      rungs: [
        {
          id: 'rung.gl2-only',
          params: { renderer: 'webgl2' },
          when: { id: 'rung.gl2-only.when', kind: 'webgl', minVersion: 2 },
        },
      ],
    };
    const g = resolveFeature(spec, baselineStb, {});
    expect(g.enabled).toBe(false);
    // Attributed to the lowest rung's predicate, not the feature itself.
    expect(g.deniedBy?.predicate).toBe('rung.gl2-only.when');
  });
});

describe('policy overrides — separate axis, evaluated last', () => {
  it('denies premium multi-angle when the entitlement is absent', () => {
    const { features } = resolve(FEATURE_SPECS, tizen2024Flagship, TIER_BANDS, {
      entitlements: [], // capable device, but not entitled
    });
    const ma = grantFor(features, 'multi-angle');
    expect(ma.enabled).toBe(false);
    expect(ma.deniedBy?.predicate).toBe('policy.entitlement');
  });

  it('a capability failure takes precedence over a policy failure', () => {
    // C9 fails the gate AND lacks entitlement; the recorded reason must be the
    // capability gate (it short-circuits before policy).
    const { features } = resolve(FEATURE_SPECS, lgC9, TIER_BANDS, { entitlements: [] });
    expect(grantFor(features, 'multi-angle').deniedBy?.predicate).toBe('runtime.es2020');
  });

  it('rollout gates in-bucket keys in, out-of-bucket keys out, deterministically', () => {
    const spec: FeatureSpec = {
      feature: 'beta',
      requires: [],
      policy: { rolloutPercent: 50 },
    };
    // 'device-123' hashes into the 50% bucket (roll 38); 'out-bucket' does not (roll 80).
    expect(resolveFeature(spec, tizen2024Flagship, { deviceKey: 'device-123' }).enabled).toBe(true);
    const out = resolveFeature(spec, tizen2024Flagship, { deviceKey: 'out-bucket' });
    expect(out.enabled).toBe(false);
    expect(out.deniedBy?.predicate).toBe('policy.rollout');
    // Deterministic: same key → same result, no RNG/clock.
    expect(resolveFeature(spec, tizen2024Flagship, { deviceKey: 'device-123' }).enabled).toBe(true);
  });

  it('rollout salt is the feature id, so two features at the same percent decorrelate', () => {
    const mk = (feature: string): FeatureSpec => ({
      feature,
      requires: [],
      policy: { rolloutPercent: 50 },
    });
    // Same device, two features both at 50%. Salting by percent (the old bug) gated
    // the identical cohort; salting by feature id makes the two decisions differ
    // (device-123 rolls 99 for featA → out, 18 for featB → in).
    const featA = resolveFeature(mk('featA'), tizen2024Flagship, { deviceKey: 'device-123' });
    const featB = resolveFeature(mk('featB'), tizen2024Flagship, { deviceKey: 'device-123' });
    expect(featA.enabled).not.toBe(featB.enabled);
  });

  it('denies on a blocked firmware substring, and allows otherwise', () => {
    const spec: FeatureSpec = {
      feature: 'gated',
      requires: [],
      policy: { denyFirmware: ['buggy-1.2'] },
    };
    const blocked = resolveFeature(spec, tizen2024Flagship, { firmware: 'webos-buggy-1.2.7' });
    expect(blocked.enabled).toBe(false);
    expect(blocked.deniedBy?.predicate).toBe('policy.firmware');
    const ok = resolveFeature(spec, tizen2024Flagship, { firmware: 'webos-3.4.0' });
    expect(ok.enabled).toBe(true);
  });
});

describe('tier derivation', () => {
  it('flagship requires both signature features enabled', () => {
    const { tier } = resolve(FEATURE_SPECS, tizen2024Flagship, TIER_BANDS, {
      entitlements: ['live-premium'],
    });
    expect(tier).toBe('flagship');
  });

  it('falls to baseline when no band is satisfied', () => {
    const { features, tier } = resolve(FEATURE_SPECS, baselineStb, TIER_BANDS);
    expect(tier).toBe('baseline');
    // hdr-overlay denied at the very first gate (no HDR at all).
    expect(grantFor(features, 'hdr-overlay').deniedBy?.predicate).toBe('display.hdr-any');
  });

  it('deriveTier is a pure function of the grant set + bands', () => {
    const bands: TierBand[] = [
      { tier: 'flagship', requiresFeatures: ['a', 'b'] },
      { tier: 'standard', requiresFeatures: ['a'] },
      { tier: 'baseline', requiresFeatures: [] },
    ];
    const grants: FeatureGrant[] = [
      { feature: 'a', enabled: true },
      { feature: 'b', enabled: false, deniedBy: { predicate: 'x' } },
    ];
    expect(deriveTier(grants, bands)).toBe('standard');
  });
});
