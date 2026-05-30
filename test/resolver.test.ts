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

describe('the C9 problem — non-co-varying axes', () => {
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

  it('rollout bucketing is deterministic for a given device key', () => {
    const spec: FeatureSpec = {
      feature: 'beta',
      requires: [],
      policy: { rolloutPercent: 50 },
    };
    const a = resolveFeature(spec, tizen2024Flagship, { deviceKey: 'device-123' });
    const b = resolveFeature(spec, tizen2024Flagship, { deviceKey: 'device-123' });
    expect(a.enabled).toBe(b.enabled); // same key → same bucket, no RNG/clock
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
