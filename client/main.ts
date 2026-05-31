/**
 * Certified-shell client entry — the C9 bundle's entry point
 * ──────────────────────────────────────────────────────────
 * Load order is load-bearing: polyfills FIRST (they install missing built-ins
 * before any app code runs), THEN the handshake. esbuild bundles this file to a
 * single IIFE targeting `chrome53` (see `npm run build:client`); the webOS app
 * shell's index.html loads the emitted `dist/app.js`.
 *
 * This entry is deliberately thin: run the two-round handshake, then load
 * whatever the server granted. The only judgement here is the unreachable-
 * resolver fallback — a safety floor, never policy (see handshakeClient.ts).
 */
import './polyfills';

import type { Platform, Verdict } from '../shared/handshake';
import { fetchTransport, runHandshake } from './handshakeClient';

// The certified shell injects its identity on the global before our bundle runs.
declare global {
  interface Window {
    __SHELL__?: { version: string; platform: Platform; resolverBaseUrl: string };
  }
}

const shell = window.__SHELL__ ?? {
  version: '0.0.0-dev',
  platform: { kind: 'browser' } satisfies Platform,
  resolverBaseUrl: '',
};

/**
 * The ONLY tier decision that ever happens client-side: if the resolver is
 * unreachable, launch on a conservative floor so the app still plays. A real
 * shell would embed its baseline `bundles` here; an empty list means
 * "app-core only, load nothing extra".
 */
const BASELINE_FALLBACK: Verdict = {
  tier: 'baseline',
  features: [],
  bundles: [],
  ttlSeconds: 60,
  fallback: true,
};

async function bootstrap(): Promise<void> {
  let verdict: Verdict;
  try {
    const { verdict: resolved } = await runHandshake(
      fetchTransport(shell.resolverBaseUrl),
      { shellVersion: shell.version, platform: shell.platform },
    );
    verdict = resolved;
  } catch (err) {
    console.warn('[handshake] resolver unreachable; using baseline floor', err);
    verdict = BASELINE_FALLBACK;
  }
  applyVerdict(verdict);
}

/** Load each granted bundle as an ordered <script> the shell will execute. */
function applyVerdict(verdict: Verdict): void {
  for (const bundle of verdict.bundles) {
    const script = document.createElement('script');
    script.src = bundle.url;
    if (bundle.integrity) script.integrity = bundle.integrity;
    script.async = false; // preserve declared load order
    document.head.appendChild(script);
  }
}

void bootstrap();
