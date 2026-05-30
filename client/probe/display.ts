/**
 * Display probe → DisplayResult
 * ─────────────────────────────
 * HDR transfer functions and colour gamut via CSS media queries — the only
 * portable signal a TV web runtime exposes. Physical resolution is deliberately
 * NOT captured: TVs misreport it constantly (a 4K panel upscaling a 1080p
 * surface, overscan, etc.), so the contract treats it as untrusted.
 */

import type { DisplayResult, HdrFormat } from '../../shared/handshake';

export function probeDisplay(): DisplayResult {
  const hdr = detectHdr();
  const colorGamut = detectGamut();
  return colorGamut === undefined ? { hdr } : { hdr, colorGamut };
}

function detectHdr(): HdrFormat[] {
  const formats: HdrFormat[] = [];
  // `dynamic-range: high` is the broad "this display does HDR" signal.
  if (matches('(dynamic-range: high)') || matches('(video-dynamic-range: high)')) {
    // We can't always distinguish PQ vs HLG from CSS alone; report the common
    // pair when HDR is present and let DRM/codec gates narrow it further.
    formats.push('pq', 'hlg');
  }
  if (formats.length === 0) formats.push('none');
  return formats;
}

function detectGamut(): DisplayResult['colorGamut'] {
  if (matches('(color-gamut: rec2020)')) return 'rec2020';
  if (matches('(color-gamut: p3)')) return 'p3';
  if (matches('(color-gamut: srgb)')) return 'srgb';
  return undefined;
}

function matches(query: string): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(query).matches
  );
}
