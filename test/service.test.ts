/**
 * Service tests — the two handlers end to end (no HTTP)
 * ────────────────────────────────────────────────────
 * Round 1 derives the probe plan from the catalog (can't drift); Round 2
 * assembles the verdict + bundle set; forward-compat tolerates unknown profile
 * fields; the Baseline fallback is a conservative, non-error verdict; and the
 * runtime probe runs without a DOM.
 */
import { describe, expect, it } from 'vitest';
import { baselineFallback, handleProbePlan, handleResolve } from '../server/service';
import { probeRuntime } from '../client/probe/runtime';
import { lgC9, tizen2024Flagship } from '../client/fixtures/devices';

describe('Round 1 — probe plan derives from the catalog', () => {
  const plan = handleProbePlan({ shellVersion: '1.0.0', platform: { kind: 'webos' } });

  it('asks for exactly the codecs/DRM/runtime checks the specs reference', () => {
    expect(plan.codecs).toContain('video/mp4; codecs="hvc1.1.6.L120.B0"');
    expect(plan.runtimeChecks).toContain('es2020');
    const wv = plan.drmSystems.find((d) => d.keySystem === 'com.widevine.alpha');
    expect(wv?.robustness).toContain('HW_SECURE_DECODE');
  });

  it('encodes the shell version in the plan id', () => {
    expect(plan.planId).toBe('plan-webos-1.0.0');
  });

  it('requests exactly the catalog targets — nothing extra', () => {
    // Exactly the distinct codecs/runtime checks the specs reference, not more.
    expect(plan.codecs).toEqual(['video/mp4; codecs="hvc1.1.6.L120.B0"']);
    expect(plan.runtimeChecks).toEqual(['es2020']);
    // The catalog's webgl/hdr predicates read always-measured fields, so they
    // contribute NO gl-extension probe targets — the plan stays minimal.
    expect(plan.glExtensions).toEqual([]);
  });
});

describe('Round 2 — verdict assembly', () => {
  it('C9 → standard tier, hdr-overlay bundle fetched, multi-angle bundle not', () => {
    const verdict = handleResolve(lgC9, { entitlements: ['live-premium'] });
    expect(verdict.tier).toBe('standard');
    expect(verdict.fallback).toBe(false);

    const bundleIds = verdict.bundles.map((b) => b.id);
    expect(bundleIds).toContain('feat-hdr-overlay');
    expect(bundleIds).not.toContain('feat-multi-angle');
    // Baseline bundles are always present and marked required.
    expect(verdict.bundles.filter((b) => b.required).map((b) => b.id)).toEqual([
      'app-core',
      'player-shaka',
    ]);
  });

  it('flagship device with entitlement → flagship tier + multi-angle bundle', () => {
    const verdict = handleResolve(tizen2024Flagship, { entitlements: ['live-premium'] });
    expect(verdict.tier).toBe('flagship');
    expect(verdict.bundles.map((b) => b.id)).toContain('feat-multi-angle');
  });

  it('tolerates unknown profile fields (forward-compat)', () => {
    const withExtra = { ...lgC9, ext: { somethingNewer: true }, futureField: 42 } as never;
    const verdict = handleResolve(withExtra, { entitlements: ['live-premium'] });
    expect(verdict.tier).toBe('standard'); // ignored, not rejected
  });
});

describe('Baseline fallback', () => {
  it('returns a conservative, non-error verdict with everything denied', () => {
    const v = baselineFallback();
    expect(v.tier).toBe('baseline');
    expect(v.fallback).toBe(true);
    expect(v.features.every((f) => !f.enabled)).toBe(true);
    expect(v.bundles.some((b) => b.required)).toBe(true);
  });

  it('handleResolve degrades to baseline when resolution throws', () => {
    // A malformed profile (codec isn't an array) makes the evaluator throw;
    // handleResolve must catch it and return baseline, never propagate the error.
    const broken = { ...lgC9, codec: null } as never;
    const verdict = handleResolve(broken, { entitlements: ['live-premium'] });
    expect(verdict.fallback).toBe(true);
    expect(verdict.tier).toBe('baseline');
    expect(verdict.features.every((f) => !f.enabled)).toBe(true);
  });
});

describe('probeRuntime runs without a DOM', () => {
  it('reports modern library features as present under Node, unknown checks false', () => {
    const r = probeRuntime(['es2020', 'es2017', 'totally-made-up']);
    expect(r.es2020).toBe(true);
    expect(r.es2017).toBe(true);
    expect(r['totally-made-up']).toBe(false); // unknown name → false, never throws
  });
});
