/**
 * Codec probe → CodecResult[]
 * ───────────────────────────
 * Two sources of truth, deliberately combined:
 *   - MediaSource.isTypeSupported(): a cheap can-I-even-construct-a-buffer check.
 *   - mediaCapabilities.decodingInfo(): the richer, slower answer that also says
 *     whether decode is *smooth* and *power-efficient*. This is the field
 *     multi-angle's `requireSmooth` gate reads — "supported but stutters" is a
 *     denial, not a grant.
 *
 * decodingInfo isn't on every TV runtime; when absent we still report
 * `supported` from isTypeSupported and simply omit smoothness.
 */

import type { CodecResult } from '../../shared/handshake';

export async function probeCodecs(contentTypes: string[]): Promise<CodecResult[]> {
  return Promise.all(contentTypes.map(probeOne));
}

async function probeOne(contentType: string): Promise<CodecResult> {
  const supported = mseSupported(contentType);

  // Only pay for decodingInfo when the basic check passes and the API exists.
  if (!supported || !hasMediaCapabilities()) {
    return { contentType, supported };
  }

  try {
    const info = await navigator.mediaCapabilities.decodingInfo({
      type: 'media-source',
      video: toVideoConfig(contentType),
    });
    return {
      contentType,
      supported: info.supported,
      smooth: info.smooth,
      powerEfficient: info.powerEfficient,
    };
  } catch {
    // decodingInfo can throw on malformed configs on some runtimes; fall back.
    return { contentType, supported };
  }
}

function mseSupported(contentType: string): boolean {
  return (
    typeof MediaSource !== 'undefined' &&
    typeof MediaSource.isTypeSupported === 'function' &&
    MediaSource.isTypeSupported(contentType)
  );
}

function hasMediaCapabilities(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'mediaCapabilities' in navigator &&
    typeof navigator.mediaCapabilities?.decodingInfo === 'function'
  );
}

/**
 * decodingInfo wants a structured VideoConfiguration, not a content-type
 * string. We carry conservative defaults (1080p30) since the resolver only
 * reads smoothness, not the exact framerate — the goal is "can this device
 * decode this codec smoothly at all", not an exhaustive matrix.
 */
function toVideoConfig(contentType: string): VideoConfiguration {
  return {
    contentType,
    width: 1920,
    height: 1080,
    bitrate: 6_000_000,
    framerate: 30,
  };
}
