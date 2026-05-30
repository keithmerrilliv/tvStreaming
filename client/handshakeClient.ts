/**
 * Two-Round Handshake Client (shell side)
 * ───────────────────────────────────────
 * Orchestrates: ask for a probe plan → run it → POST the profile → get a
 * verdict. Transport is injected (not hard-wired to fetch) so the same logic
 * runs in the TV runtime, in tests, and in the demo script against the
 * in-process service.
 *
 * The one piece of judgement the shell is allowed: if the resolver is
 * unreachable, fall back to a conservative Baseline verdict so the app still
 * launches and plays. That is the ONLY tier decision that ever happens
 * client-side, and it's a safety floor, not policy.
 */

import type {
  CapabilityProfile,
  Platform,
  ProbePlan,
  ProbePlanRequest,
  Verdict,
} from '../shared/handshake';
import { runProbePlan } from './probe';

/** Minimal transport: POST a JSON body to a path, get a JSON response. */
export type Transport = <T>(path: string, body: unknown) => Promise<T>;

export interface HandshakeInput {
  shellVersion: string;
  platform: Platform;
  /** Session context forwarded to the resolver for policy evaluation. */
  context?: { entitlements?: string[]; firmware?: string };
}

export interface HandshakeOutcome {
  profile: CapabilityProfile;
  verdict: Verdict;
}

export async function runHandshake(
  transport: Transport,
  input: HandshakeInput,
): Promise<HandshakeOutcome> {
  const planReq: ProbePlanRequest = {
    shellVersion: input.shellVersion,
    platform: input.platform,
  };

  // Round 1 — probe plan.
  const plan = await transport<ProbePlan>('/probe-plan', planReq);

  // Round 2 — execute the plan into raw measurements, then ask for a verdict.
  const profile = await runProbePlan(plan, {
    shellVersion: input.shellVersion,
    platform: input.platform,
  });

  const verdict = await transport<Verdict>('/resolve', {
    profile,
    context: input.context ?? {},
  });

  return { profile, verdict };
}

/**
 * A fetch-based transport for the real shell. Throwing here lets the caller
 * decide to use a cached or Baseline verdict.
 */
export function fetchTransport(baseUrl: string): Transport {
  return async <T>(path: string, body: unknown): Promise<T> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
    return (await res.json()) as T;
  };
}
