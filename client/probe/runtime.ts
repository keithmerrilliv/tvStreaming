/**
 * Runtime probe → Record<string, boolean>
 * ────────────────────────────────────────
 * Named runtime checks the server can ask for by string. The set of checks is
 * a registry here, but WHICH ones run is driven by the ProbePlan — so the
 * server can start gating on a new runtime capability without a shell update,
 * as long as the check name is one the shell knows.
 *
 * Important subtlety (a good interview talking point): you cannot feature-detect
 * *syntax* at runtime. Optional chaining, nullish coalescing, BigInt literals —
 * if the engine can't parse them the script never runs at all. So an "es2020"
 * check probes representative *library* features that shipped in that engine
 * generation (Promise.allSettled, globalThis, String.prototype.matchAll, BigInt
 * the value). It's a proxy for "this engine is modern enough", not a literal
 * grammar test. The LG C9's Chromium 53 fails these; its decode hardware doesn't
 * care — which is the whole non-co-varying-axes story.
 */

export type RuntimeCheck = () => boolean;

const CHECKS: Record<string, RuntimeCheck> = {
  es2020: () =>
    typeof globalThis === 'object' &&
    typeof BigInt !== 'undefined' &&
    typeof Promise.allSettled === 'function' &&
    typeof (String.prototype as { matchAll?: unknown }).matchAll === 'function',

  es2017: () =>
    typeof Object.values === 'function' && typeof Object.entries === 'function',

  // Structured cloning of large transferables — relevant to multi-stream buffers.
  'structured-clone': () => typeof structuredClone === 'function',

  // Off-main-thread decode/render plumbing.
  'offscreen-canvas': () => typeof OffscreenCanvas !== 'undefined',
};

export function probeRuntime(checkNames: string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const name of checkNames) {
    const check = CHECKS[name];
    // Unknown check name → report false rather than throwing. A forward-skewed
    // server may ask for a check an older shell doesn't have; "false" is the
    // safe, contract-preserving answer.
    out[name] = check ? safe(check) : false;
  }
  return out;
}

function safe(check: RuntimeCheck): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}
