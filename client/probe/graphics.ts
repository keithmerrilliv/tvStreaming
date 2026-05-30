/**
 * Graphics probe → GraphicsResult
 * ───────────────────────────────
 * Measures the WebGL ceiling and the subset of requested extensions actually
 * present. Distilled from gpu-capability-probe.js, but typed to the contract
 * and reduced to what the resolver reads.
 *
 * Two hard-won details preserved from the source notes:
 *   - `navigator.gpu` existing is NOT proof of WebGPU usability (requestAdapter
 *     can still resolve null on TV runtimes), so we don't claim a version from
 *     it here — WebGL is the contract's ceiling. WebGPU detection, when needed,
 *     belongs behind an awaited adapter+device check, not a property sniff.
 *   - UNMASKED_RENDERER (via WEBGL_debug_renderer_info) is frequently the only
 *     reliable SoC identifier, since UA strings lie. It often isn't exposed.
 */

import type { GraphicsResult } from '../../shared/handshake';

export function probeGraphics(requestedExtensions: string[]): GraphicsResult {
  const canvas = document.createElement('canvas');

  // Prefer WebGL2; fall back to WebGL1; 0 means no WebGL at all.
  const gl2 = canvas.getContext('webgl2');
  const gl = gl2 ?? canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl');

  if (!gl || !(gl instanceof WebGLRenderingContext || isWebGL2(gl))) {
    return { webglVersion: 0, maxTextureSize: 0, extensions: [] };
  }

  const webglVersion: 1 | 2 = gl2 ? 2 : 1;
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

  // Only report back the extensions the server asked about — keeps the profile
  // small and the contract explicit about what's load-bearing.
  const extensions = requestedExtensions.filter((ext) => gl.getExtension(ext) !== null);

  const renderer = unmaskedRenderer(gl);
  return renderer === undefined
    ? { webglVersion, maxTextureSize, extensions }
    : { webglVersion, maxTextureSize, extensions, renderer };
}

function isWebGL2(gl: object): gl is WebGL2RenderingContext {
  return typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
}

function unmaskedRenderer(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
): string | undefined {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  if (!ext) return undefined;
  return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string;
}
