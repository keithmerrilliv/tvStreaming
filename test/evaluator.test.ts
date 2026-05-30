import { describe, expect, it } from 'vitest';
import type { CapabilityProfile } from '../shared/handshake';
import type { CapabilityPredicate } from '../shared/policy';
import { evaluate } from '../server/evaluator';
import { lgC9, tizen2024Flagship } from '../client/fixtures/devices';

function run(p: CapabilityPredicate, profile: CapabilityProfile) {
  return evaluate(p, profile);
}

describe('evaluate — leaf predicates', () => {
  it('codec: requires smooth, not just supported', () => {
    const profile: CapabilityProfile = {
      ...lgC9,
      codec: [{ contentType: 'video/x', supported: true, smooth: false }],
    };
    const r = run(
      { id: 'codec.x', kind: 'codec', contentType: 'video/x', requireSmooth: true },
      profile,
    );
    expect(r.pass).toBe(false);
    expect(r.failedPredicate).toBe('codec.x');
  });

  it('webgl: enforces both version and max-texture-size', () => {
    const okVer = run({ id: 'gl', kind: 'webgl', minVersion: 1 }, lgC9);
    expect(okVer.pass).toBe(true);

    const needsGl2 = run({ id: 'gl2', kind: 'webgl', minVersion: 2 }, lgC9);
    expect(needsGl2.pass).toBe(false);
    expect(needsGl2.failedPredicate).toBe('gl2');

    const tooSmall = run(
      { id: 'tex', kind: 'webgl', minVersion: 1, minMaxTextureSize: 8192 },
      lgC9, // 4096
    );
    expect(tooSmall.pass).toBe(false);
  });

  it('drm: compares robustness on the shared ladder', () => {
    const ok = run(
      {
        id: 'wv',
        kind: 'drm',
        keySystem: 'com.widevine.alpha',
        minRobustness: 'HW_SECURE_DECODE',
      },
      lgC9,
    );
    expect(ok.pass).toBe(true);

    const tooWeak = run(
      {
        id: 'wv-all',
        kind: 'drm',
        keySystem: 'com.widevine.alpha',
        minRobustness: 'HW_SECURE_ALL', // C9 only reaches HW_SECURE_DECODE
      },
      lgC9,
    );
    expect(tooWeak.pass).toBe(false);
  });

  it('hdr: anyOf is satisfied by one match', () => {
    expect(run({ id: 'hdr', kind: 'hdr', anyOf: ['pq'] }, lgC9).pass).toBe(true);
    expect(run({ id: 'hdr-x', kind: 'hdr', anyOf: ['smpte2084'] }, lgC9).pass).toBe(false);
  });

  it('runtime: reads the named check', () => {
    expect(run({ id: 'r', kind: 'runtime', check: 'es2020' }, lgC9).pass).toBe(false);
    expect(run({ id: 'r', kind: 'runtime', check: 'es2020' }, tizen2024Flagship).pass).toBe(true);
  });
});

describe('evaluate — composites attribute the deepest leaf', () => {
  it('and: reports the failing child, not the and wrapper', () => {
    const r = run(
      {
        id: 'group',
        kind: 'and',
        all: [
          { id: 'gl', kind: 'webgl', minVersion: 1 }, // passes on C9
          { id: 'es', kind: 'runtime', check: 'es2020' }, // fails on C9
        ],
      },
      lgC9,
    );
    expect(r.pass).toBe(false);
    expect(r.failedPredicate).toBe('es'); // the leaf, never 'group'
  });

  it('or: passes if any branch passes', () => {
    const r = run(
      {
        id: 'either',
        kind: 'or',
        any: [
          { id: 'gl2', kind: 'webgl', minVersion: 2 }, // fails on C9
          { id: 'gl1', kind: 'webgl', minVersion: 1 }, // passes on C9
        ],
      },
      lgC9,
    );
    expect(r.pass).toBe(true);
  });

  it('or: when all branches fail, attributes to the or and lists branches tried', () => {
    const r = run(
      {
        id: 'either',
        kind: 'or',
        any: [
          { id: 'gl2', kind: 'webgl', minVersion: 2 },
          { id: 'es', kind: 'runtime', check: 'es2020' },
        ],
      },
      lgC9,
    );
    expect(r.pass).toBe(false);
    expect(r.failedPredicate).toBe('either');
    expect(r.detail).toContain('gl2');
    expect(r.detail).toContain('es');
  });
});
