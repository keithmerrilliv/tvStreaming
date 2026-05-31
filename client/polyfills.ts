/**
 * Curated polyfill entry for the certified shell (Chromium-53 / LG C9)
 * ───────────────────────────────────────────────────────────────────
 * DENY BY DEFAULT. esbuild (`--target=chrome53`) transpiles *syntax*; it does
 * NOT add missing built-ins. This file is the ONLY place built-ins are
 * polyfilled, and it imports them one feature at a time, on purpose.
 *
 * HARD RULE — never import an umbrella entry (`core-js`, `core-js/stable`,
 * `core-js/actual`). They pull in EVERYTHING, including the built-ins the
 * capability probe uses as a proxy for engine generation. Polyfilling those
 * makes the probe LIE: the C9 would report `runtime.es2020 = true`, the
 * resolver would grant multi-angle, and the runtime couldn't deliver it — the
 * exact over-promise this whole design exists to prevent. See
 * `client/probe/runtime.ts`.
 *
 * FORBIDDEN here — the probe proxies. `runtime.ts` must keep measuring their
 * ABSENCE on an old engine, so they must stay un-polyfilled:
 *   ✗ Promise.allSettled        (core-js: modules/es.promise.all-settled)
 *   ✗ String.prototype.matchAll (core-js: modules/es.string.match-all)
 *   ✗ globalThis                (core-js: modules/es.global-this)
 *   ✗ structuredClone           (core-js: modules/web.structured-clone)
 *   ✗ BigInt        — unpolyfillable by nature (needs engine support); the
 *                     probe's BigInt check is therefore self-honest.
 *   ✗ OffscreenCanvas — host API, not in core-js; unpolyfillable here.
 *
 * SAFE to add — built-ins Chromium-53 lacks that the probe does NOT inspect.
 * Use granular `core-js/actual/...` paths only; one feature per line; import
 * only what app code actually uses (each line is shipped weight).
 */

// Array.prototype.flat / flatMap — Chrome 69. Common when flattening track/
// playlist structures before handing them to the player.
import 'core-js/actual/array/flat';
import 'core-js/actual/array/flat-map';

// Object.fromEntries — Chrome 73. Common for rebuilding maps from pair arrays.
import 'core-js/actual/object/from-entries';
