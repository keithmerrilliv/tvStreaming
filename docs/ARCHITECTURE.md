# Architecture

A capability-tiering streaming resolver. The certified TV **shell measures** a
device, a **server judges** it per-feature against declarative policy, and the
cosmetic *tier* label is **derived last** — an output of the decision, never an
input to it.

This document explains the design, the data contract, the resolver internals,
and how the client is built for an old-Chromium TV.

---

## 1. The problem

Smart-TV fleets are a combinatorial mess of capabilities, and linear "device
tiers" (Flagship / Standard / Baseline) lie about real hardware. The canonical
case is the **LG C9** (2019 OLED): excellent HEVC decode, HDR panel, and
hardware Widevine — but a **Chromium-53** JavaScript engine that can't run a
modern orchestration layer.

A linear tier model has to choose wrong:

- Call it **Flagship** → promise multi-angle the runtime can't orchestrate.
- Call it **Baseline** → deny HDR the panel obviously supports.

The fix is to stop treating "tier" as a thing a device *is*, and treat each
**capability axis** as independently measurable and independently gated. The C9
then gets exactly what its hardware earns: HDR overlay at a WebGL1 rung,
multi-angle denied **for one recorded reason — `runtime.es2020` — and nothing
else.**

---

## 2. Core principles

1. **Tiers are labels; capability axes are the truth.** Features gate on
   per-axis predicates, never on a tier. `tier` is derived from the resulting
   grant set (`deriveTier`, `server/resolver.ts`).
2. **The shell measures, the server judges.** The shell uploads *raw
   measurements only — no tier hint.* The server owns all policy, so it can be
   updated without re-shipping the signed TV app.
3. **Minimize the certified shell.** TV apps ship as signed packages and update
   on the fleet's schedule, not yours. The shell holds only what must be local
   (bootstrap, probe engine, DRM declarations, a Baseline fallback); everything
   else — app logic, policy, *even the list of things to probe* — loads at
   launch.
4. **Forward-compatible by contract.** The fleet is permanently version-skewed,
   so the handshake degrades in both directions: unknown profile fields are
   ignored (never rejected), and probe targets ship server→shell so new codecs
   or extensions need no recertification.

---

## 3. The two-round handshake

```
   ┌────────────── Certified shell (TV) ──────────────┐        ┌──── Resolver (server) ────┐
   │                                                  │        │                           │
   │  Round 1   POST /probe-plan                      │        │                           │
   │     { shellVersion, platform } ─────────────────────────► │  buildProbePlan()         │
   │                                                  │        │  (derived from catalog)   │
   │     ProbePlan ◄───────────────────────────────────────── │  codecs / glExt / drm /   │
   │     (what to measure)                            │        │  runtimeChecks            │
   │                                                  │        │                           │
   │  runProbePlan() → CapabilityProfile (raw facts)  │        │                           │
   │                                                  │        │                           │
   │  Round 2   POST /resolve                         │        │                           │
   │     { profile, context } ───────────────────────────────► │  resolve()                │
   │                                                  │        │  3-phase per feature      │
   │     Verdict ◄──────────────────────────────────────────── │  grants + tier + bundles  │
   │     (tier, per-feature grants, bundles to load)  │        │                           │
   └──────────────────────────────────────────────────┘        └───────────────────────────┘
```

**Why two rounds?** Detection and judgement change on *different cadences* and
live in *different trust domains*. Shipping the probe list in Round 1 keeps
detection updatable without putting it back inside the signed binary. One round
would re-weld them together.

The plan is **derived from the catalog** (`server/probePlan.ts`): it walks every
predicate in `FEATURE_SPECS` and unions the codecs / extensions / DRM systems /
runtime checks they reference. Add a predicate that needs a new codec string and
the probe plan picks it up automatically — the two can't drift.

---

## 4. The data contract

`shared/handshake.ts` is the single source of truth, imported by **both** shell
and server — there is no second schema to drift. The key shapes:

- **`ProbePlanRequest`** → `{ shellVersion, platform }`. Round 1 input.
- **`ProbePlan`** → codecs, glExtensions, drmSystems, runtimeChecks, ttlSeconds.
  What to measure.
- **`CapabilityProfile`** → raw measurements: `codec[]`, `graphics`, `drm[]`,
  `display`, `runtime` (a `Record<string, boolean>`), plus an `ext` escape hatch
  for forward-compat. **No tier hint.**
- **`Verdict`** → `{ tier, features: FeatureGrant[], bundles: BundleRef[],
  ttlSeconds, fallback }`. The decision.

The load-bearing API choice: **a denial is structured, not a boolean.** A
`FeatureGrant` that's denied carries `deniedBy: { predicate, detail }` — e.g.
`{ predicate: "runtime.es2020", detail: "runtime check 'es2020' false" }`. The
API shape *is* the analytics schema (see §8).

Deliberately **not** in the contract: physical resolution (TVs misreport it
constantly) and any client-computed tier hint (would undermine server-owned
policy).

---

## 5. The resolver — a three-phase interpreter

For each `FeatureSpec`, `resolveFeature` (`server/resolver.ts`) runs three
phases that compose by short-circuit:

```
Phase 1 — Hard gates       AND of `requires`. Any miss → denied, recording the
                           failing predicate ID. (capability)
Phase 2 — Rung selection   Walk `rungs` top-down; first match sets params.
                           No rung clears → denied at the lowest rung's reason.
Phase 3 — Policy overrides Business rules (entitlement / firmware / rollout),
                           applied AFTER capability logic, on a separate axis.
```

Capability logic (phases 1–2, device facts) and policy logic (phase 3, session
/ business context in `ResolveContext`) are deliberately separated so they can't
bleed into each other.

### Predicate vocabulary

Leaf predicates (`shared/policy.ts`), each carrying a stable `id` used in denial
reasons: `codec` (optionally `requireSmooth`), `webgl` (min version + optional
min texture size), `gl-extension`, `drm` (key system + min robustness on an
ordered `ROBUSTNESS_LADDER`), `hdr` (any-of formats), `runtime` (named check).
Composites: `and`, `or`.

### Denial attribution — the deepest leaf

The evaluator (`server/evaluator.ts`) is a pure
`(predicate, profile) → EvaluationResult`. Its single invariant: when a
predicate fails, the result names the **deepest leaf predicate** that caused it,
not the composite wrapping it. "multi-angle denied by `runtime.es2020`" is
actionable; "denied by `requires`" is not. An `and` propagates the failing
child's id; an `or` reports itself, listing the branches it tried.

### Tier derivation (output, not input)

`deriveTier` takes the enabled-feature set and returns the highest `TierBand`
whose `requiresFeatures` are all enabled (bands ordered strongest-first;
defaults to `baseline`). It runs **after** all feature decisions and feeds back
into none of them.

### Deterministic rollout — no clock, no RNG

Phase-3 rollout bucketing uses an **FNV-1a hash** of a stable device key
(`fnv1a`, `server/resolver.ts`), salted by the **feature id** so two features at
the same percent don't gate the identical cohort — and so ramping a rollout up
only adds devices, never reshuffles the cohort. The same device always lands in
the same bucket — reproducible and testable with zero stored
state (`test/resolver.test.ts` asserts it).

---

## 6. The capability probes (shell side)

`client/probe/` turns a `ProbePlan` into a `CapabilityProfile`. Each probe
assembles facts and forms no opinion:

- **codec** — `MediaSource.isTypeSupported()` for a cheap yes/no, then
  `mediaCapabilities.decodingInfo()` for `smooth` / `powerEfficient` when
  available (the field multi-angle's `requireSmooth` gate reads). `decodingInfo`
  isn't on every runtime; absent → report `supported` only.
- **graphics** — WebGL2→WebGL1 ceiling, `MAX_TEXTURE_SIZE`, requested extensions
  present, and `UNMASKED_RENDERER` when exposed (often the only reliable SoC id).
- **drm** — `requestMediaKeySystemAccess`, probing robustness strongest-first to
  find the *highest level that actually succeeds* (L1 vs L3 is exactly
  `HW_SECURE_DECODE` succeeding or not).
- **display** — HDR transfer functions and color gamut via CSS media queries
  (`dynamic-range`, `color-gamut`). Physical resolution is deliberately not
  captured.
- **runtime** — named checks (`es2020`, etc.). **You cannot feature-detect
  *syntax* at runtime** — if the engine can't parse `?.`/`??`, the script never
  runs — so the `es2020` check probes representative *library* features
  (`Promise.allSettled`, `globalThis`, `String.prototype.matchAll`) as a proxy
  for engine generation.

---

## 7. Worked example — the LG C9

The C9 has the decode silicon and HDR panel for premium multi-angle live, but a
Chromium-53 engine. Run `npm run demo`:

```
■ lgC9  →  tier=standard
    ✗ multi-angle  ← runtime.es2020  (runtime check 'es2020' false)
    ✓ hdr-overlay  [rung.gl1]
    bundles: app-core, player-shaka, feat-hdr-overlay
```

- **multi-angle** requires (AND) `codec.hevc-main` (smooth HEVC) ∧
  `runtime.es2020` ∧ `drm.widevine-l1` (`HW_SECURE_DECODE`). The C9 passes
  decode and DRM but fails the runtime axis → denied, attributed precisely to
  `runtime.es2020`.
- **hdr-overlay** requires HDR ∧ WebGL1; the C9 clears both, selects the WebGL1
  rung (`rung.gl1`), and is granted.
- `deriveTier` then labels it **standard** (hdr-overlay enabled, multi-angle
  not) — a label computed from the grants, not used to make them.

Independent axes like these — capable hardware, old runtime — are the whole point,
and per-axis gating is what captures them where a single tier number can't.

---

## 8. Telemetry & future devices fall out for free

Because every denial records *which predicate* failed, the system emits a
structured rollup (`npm run demo`):

```
── Telemetry rollup: denials by predicate (the unlock list) ──
     2×  runtime.es2020
     1×  codec.hevc-main
     1×  display.hdr-any
```

That's a **ranked unlock list**, not a vanity stat: "multi-angle is denied on N
devices whose *only* failing predicate is `runtime.es2020`" is a quantified
business case for shipping a down-level runtime bundle. And **future devices
need no special-casing** — a TV that didn't exist at certification sends a
profile, predicates evaluate against it, and it earns the rungs its measurements
deserve.

---

## 9. Client build & packaging (Chromium-53 target)

The shell bundle must run on the C9's Chromium-53, so the client is built
separately from the modern Node server.

- **Transpile** — `npm run build:client` runs esbuild over `client/main.ts`
  with `--target=chrome53`, lowering syntax the engine can't parse (`?.`, `??`,
  `async/await`, object spread) to ES2015. `async/await` lowers to native
  generators, so **no `regenerator-runtime`** is needed.
- **Polyfill** — `client/polyfills.ts` adds *only* curated missing built-ins via
  granular `core-js` imports, and deliberately **omits the built-ins the
  `runtime.es2020` probe inspects** — polyfilling those would make the
  capability probe lie (the C9 would report `es2020 = true`).
- **Type-check** — `tsconfig.client.json` checks the client under `target:
  ES2015`, `types: []` (it's a browser, not Node).
- **Package** — `webos/` holds the static shell (`appinfo.json`, an ES5-safe
  `index.html` that injects `window.__SHELL__`, icons); `npm run package` stages
  them with the bundle and runs `ares-package` into `dist/*.ipk`.

See the README "Building & sideloading for webOS" section for the commands.

---

## 10. Testing & repo map

The entire policy layer is pure functions, so it's unit-tested with zero
network or DOM (`npm test`, 25 tests): `evaluator.test.ts`, `resolver.test.ts`
(the C9 conjunction + gap profiles + deterministic rollout), `service.test.ts`
(forward-compat + Baseline fallback).

```
shared/         The frozen contract, imported by both sides.
  handshake.ts    Wire types: ProbePlan, CapabilityProfile, Verdict.
  policy.ts       Predicate vocabulary + the robustness ladder.

server/         The judge.
  probePlan.ts    Round 1: derive the probe plan from the catalog.
  resolver.ts     Three-phase interpreter; deriveTier; deterministic rollout.
  evaluator.ts    Pure predicate evaluation; deepest-leaf denial attribution.
  catalog.ts      Declarative feature specs, tier bands, bundle map.
  service.ts      Framework-agnostic handlers + Baseline fallback.
  server.ts       node:http adapter (zero deps).

client/         The certified shell.
  probe/          Typed capability probes (graphics, codec, drm, runtime, display).
  handshakeClient.ts  Two-round orchestration with an injectable transport.
  main.ts         Bundle entry: polyfills → handshake → load granted bundles.
  polyfills.ts    Curated, deny-by-default core-js entry.

test/           Vitest: evaluator, resolver, service.
scripts/        demo (smoke + telemetry rollup), webOS packaging, icons.
webos/          The webOS app shell (appinfo.json, index.html, icons).
```

---

## 11. Honest tradeoffs

- **Server-owned policy needs the network at launch.** A streaming app has no
  useful offline mode, so this costs little real — but it demands a conservative
  Baseline fallback (`service.ts` → `baselineFallback`: any `/resolve` failure
  degrades to a usable Baseline verdict, never a 500) and verdict caching with
  TTL (every cacheable response carries `ttlSeconds`).
- **Two rounds add a round-trip** at launch. The payoff (updatable detection,
  minimal certified surface) is worth it for an app that's already network-bound.
- **The probe proxy is a proxy.** `es2020` tests library features, not the
  parser. It's honest about being a generational signal, not a grammar test.
