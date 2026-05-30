/**
 * DRM probe → DrmResult[]
 * ───────────────────────
 * Uses requestMediaKeySystemAccess to find the *highest robustness level that
 * actually succeeds*, not merely whether a key system name is recognised. The
 * distinction matters: a device can report Widevine support yet fail
 * HW_SECURE_DECODE, which is exactly the line between L1 (premium live) and L3.
 *
 * We probe robustness levels strongest-first and stop at the first that's
 * granted — that level is what goes in the profile.
 */

import type { DrmQuery, DrmResult } from '../../shared/handshake';
import { ROBUSTNESS_LADDER } from '../../shared/policy';

export async function probeDrm(queries: DrmQuery[]): Promise<DrmResult[]> {
  return Promise.all(queries.map(probeOne));
}

async function probeOne(query: DrmQuery): Promise<DrmResult> {
  if (!hasEme()) return { keySystem: query.keySystem, supported: false };

  // Strongest-first: the requested levels if given, else the full ladder.
  const levels = orderStrongestFirst(query.robustness ?? [...ROBUSTNESS_LADDER]);

  for (const robustness of levels) {
    if (await accessGranted(query.keySystem, robustness)) {
      return { keySystem: query.keySystem, supported: true, robustness };
    }
  }

  // The key system may still work with no specific robustness requirement.
  if (await accessGranted(query.keySystem, undefined)) {
    return { keySystem: query.keySystem, supported: true };
  }

  return { keySystem: query.keySystem, supported: false };
}

async function accessGranted(keySystem: string, robustness: string | undefined): Promise<boolean> {
  try {
    await navigator.requestMediaKeySystemAccess(keySystem, [
      {
        initDataTypes: ['cenc'],
        videoCapabilities: [
          {
            contentType: 'video/mp4; codecs="avc1.640028"',
            ...(robustness ? { robustness } : {}),
          },
        ],
      },
    ]);
    return true;
  } catch {
    return false;
  }
}

function orderStrongestFirst(levels: string[]): string[] {
  return [...levels].sort(
    (a, b) =>
      ROBUSTNESS_LADDER.indexOf(b as (typeof ROBUSTNESS_LADDER)[number]) -
      ROBUSTNESS_LADDER.indexOf(a as (typeof ROBUSTNESS_LADDER)[number]),
  );
}

function hasEme(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.requestMediaKeySystemAccess === 'function'
  );
}
