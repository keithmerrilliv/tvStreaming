/**
 * Device fixtures — captured/synthetic CapabilityProfiles
 * ───────────────────────────────────────────────────────
 * Raw measurements only (the shape the shell POSTs). The LG C9 is the real
 * one: a ground-truth capture from the bench device (webOS 4.5 / Chromium 53).
 * It is the canonical counterexample to linear tiers — a panel with excellent
 * decode, HDR and hardware Widevine, gated only by an antique JS engine.
 *
 * The others are synthetic profiles of the kind the LM Studio firehose on
 * the dev host generates to stress the resolver's gaps.
 */

import type { CapabilityProfile } from '../../shared/handshake';

const HEVC_MAIN = 'video/mp4; codecs="hvc1.1.6.L120.B0"';
const CAPTURED_AT = '2026-05-29T00:00:00.000Z';

/**
 * LG OLED65C9AUA — the real bench device.
 * Great everything EXCEPT the Chromium-53 runtime. Hardware can do multi-angle;
 * the JS engine that would orchestrate it can't. Denied by runtime.es2020 alone.
 */
export const lgC9: CapabilityProfile = {
  planId: 'plan-webos-1.0.0',
  shellVersion: '1.0.0',
  platform: { kind: 'webos', webosVersion: '4.5' },
  capturedAt: CAPTURED_AT,
  codec: [{ contentType: HEVC_MAIN, supported: true, smooth: true, powerEfficient: true }],
  graphics: {
    webglVersion: 1, // Chromium 53 — no WebGL2
    maxTextureSize: 4096,
    extensions: ['OES_texture_half_float'],
    renderer: 'Mali-G52 (webOS 4.5)',
  },
  drm: [{ keySystem: 'com.widevine.alpha', supported: true, robustness: 'HW_SECURE_DECODE' }],
  display: { hdr: ['pq', 'hlg'], colorGamut: 'p3' },
  runtime: {
    es2020: false, // the single failing axis for multi-angle
    es2017: false,
    'structured-clone': false,
    'offscreen-canvas': false,
  },
};

/** 2024 Tizen flagship — clears every axis. Multi-angle still needs the entitlement. */
export const tizen2024Flagship: CapabilityProfile = {
  planId: 'plan-tizen-1.4.0',
  shellVersion: '1.4.0',
  platform: { kind: 'tizen', tizenVersion: '8.0' },
  capturedAt: CAPTURED_AT,
  codec: [{ contentType: HEVC_MAIN, supported: true, smooth: true, powerEfficient: true }],
  graphics: {
    webglVersion: 2,
    maxTextureSize: 16384,
    extensions: ['OES_texture_float', 'EXT_color_buffer_float'],
    renderer: 'Mali-G78',
  },
  drm: [{ keySystem: 'com.widevine.alpha', supported: true, robustness: 'HW_SECURE_DECODE' }],
  display: { hdr: ['pq', 'hlg'], colorGamut: 'rec2020' },
  runtime: {
    es2020: true,
    es2017: true,
    'structured-clone': true,
    'offscreen-canvas': true,
  },
};

/**
 * Synthetic "gap" device: modern GPU (WebGL2) and smooth HEVC and HW Widevine,
 * but an old runtime. Passes codec + graphics gates, fails exactly one runtime
 * check — exists to prove the resolver denies for the RIGHT recorded reason
 * (runtime.es2020), not a graphics one.
 */
export const gapModernGpuOldRuntime: CapabilityProfile = {
  planId: 'plan-tizen-1.2.0',
  shellVersion: '1.2.0',
  platform: { kind: 'tizen', tizenVersion: '6.0' },
  capturedAt: CAPTURED_AT,
  codec: [{ contentType: HEVC_MAIN, supported: true, smooth: true, powerEfficient: true }],
  graphics: {
    webglVersion: 2,
    maxTextureSize: 8192,
    extensions: ['OES_texture_float'],
    renderer: 'Mali-G72',
  },
  drm: [{ keySystem: 'com.widevine.alpha', supported: true, robustness: 'HW_SECURE_DECODE' }],
  display: { hdr: ['pq'], colorGamut: 'p3' },
  runtime: {
    es2020: false, // the sole gap
    es2017: true,
    'structured-clone': true,
    'offscreen-canvas': false,
  },
};

/** Low-end set-top: no WebGL, no HEVC, software DRM only. Everything denied. */
export const baselineStb: CapabilityProfile = {
  planId: 'plan-android-tv-1.1.0',
  shellVersion: '1.1.0',
  platform: { kind: 'android-tv', api: 28 },
  capturedAt: CAPTURED_AT,
  codec: [{ contentType: HEVC_MAIN, supported: false }],
  graphics: { webglVersion: 0, maxTextureSize: 0, extensions: [] },
  drm: [{ keySystem: 'com.widevine.alpha', supported: true, robustness: 'SW_SECURE_CRYPTO' }],
  display: { hdr: ['none'] },
  runtime: {
    es2020: true,
    es2017: true,
    'structured-clone': true,
    'offscreen-canvas': false,
  },
};

export const ALL_FIXTURES = {
  lgC9,
  tizen2024Flagship,
  gapModernGpuOldRuntime,
  baselineStb,
};
