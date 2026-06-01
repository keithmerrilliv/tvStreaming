/**
 * Probe engine (Round 2 execution)
 * ────────────────────────────────
 * Executes a server-issued ProbePlan into a CapabilityProfile of RAW
 * measurements. It assembles facts; it forms no opinion. There is deliberately
 * no tier, no grant, no judgement here — that all lives server-side. The shell
 * measures; the server judges.
 *
 * This must be able to run inside the certified shell before any other network
 * call, so it depends only on the contract types and the individual probes.
 */

import type {
  CapabilityProfile,
  Platform,
  ProbePlan,
} from '../../shared/handshake';
import { probeCodecs } from './codec';
import { probeDisplay } from './display';
import { probeDrm } from './drm';
import { probeGraphics } from './graphics';
import { probeRuntime } from './runtime';

export async function runProbePlan(
  plan: ProbePlan,
  shell: { shellVersion: string; platform: Platform },
): Promise<CapabilityProfile> {
  // Codec and DRM probes are async (decodingInfo / requestMediaKeySystemAccess);
  // graphics, display and runtime are synchronous. Run the async pair together.
  const [codec, drm] = await Promise.all([
    probeCodecs(plan.codecs),
    probeDrm(plan.drmSystems),
  ]);

  return {
    planId: plan.planId,
    shellVersion: shell.shellVersion,
    platform: shell.platform,
    capturedAt: new Date().toISOString(),
    codec,
    graphics: probeGraphics(plan.glExtensions),
    drm,
    display: probeDisplay(),
    runtime: probeRuntime(plan.runtimeChecks),
  };
}
