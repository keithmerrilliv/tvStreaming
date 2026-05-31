# tvStreaming — Capability-Tiering Streaming Demo

A small, sharp implementation of the architecture in `docs/INTERVIEW.md`: a
certified TV **shell measures** device capability, a **server judges** it
per-feature against declarative policy, and the cosmetic *tier* label is derived
last — an output, never an input.

Built as a portfolio/interview artifact. The emphasis is on *how* the hard parts
are made small, pure, and testable — not on visual polish.

## Run it

```sh
npm install
npm run typecheck   # strict TS, clean
npm test            # 25 unit tests — the policy layer, zero network/DOM
npm run demo        # full two-round handshake over device fixtures + telemetry rollup
npm run serve       # HTTP resolver service on :8088  (PORT/HOST override)
```

`npm run demo` output (the whole thesis on one screen):

```
■ lgC9  →  tier=standard
    ✗ multi-angle  ← runtime.es2020   (capable decode + HW DRM, antique JS engine)
    ✓ hdr-overlay  [rung.gl1]
■ tizen2024Flagship  →  tier=flagship
    ✓ multi-angle  [rung.flagship]
    ✓ hdr-overlay  [rung.gl2]
...
── Telemetry rollup: denials by predicate (the unlock list) ──
     2×  runtime.es2020      ← the ranked "what would unlock the most devices" list
```

## Layout

```
shared/         The frozen contract — imported by BOTH sides, one source of truth.
  handshake.ts    Two-round protocol: ProbePlan, CapabilityProfile, Verdict.
  policy.ts       Declarative FeatureSpec + predicate vocabulary.

server/         The resolver service (Node/TS, zero deps, node:http).
  evaluator.ts    Pure (predicate, profile) → result; denials name the deepest leaf.
  resolver.ts     The 3-phase interpreter: gates → rungs → policy; derives the tier.
  catalog.ts      Hot-reloadable policy data (feature specs, tier bands, bundles).
  probePlan.ts    Round-1 plan, derived from the catalog so the two can't drift.
  service.ts      Framework-agnostic handlers + the never-brick Baseline fallback.
  server.ts       HTTP wiring: POST /probe-plan, POST /resolve, GET /health.

client/         The certified-shell side.
  probe/          Typed capability probes (graphics, codec, drm, runtime, display).
  handshakeClient.ts  Two-round orchestration with an injectable transport.
  fixtures/       Device profiles — the LG C9 is a real bench capture.

test/           Vitest: evaluator, resolver (the C9 conjunction + gap profiles), service.
scripts/demo.ts Runnable end-to-end smoke + telemetry rollup.
docs/INTERVIEW.md   Talking points mapped to each interview topic.
```

## Building & sideloading for webOS (LG C9)

The client ships to the TV as a single Chromium-53-safe bundle wrapped in a webOS
app package.

```
npm run build           # typecheck (browser context) + esbuild → dist/webos/app.js
npm run package         # build, then ares-package → dist/<id>_<version>_all.ipk
npm run install:webos   # ares-install the newest .ipk onto a dev-mode TV
npm run launch:webos    # ares-launch com.example.tvstreaming
```

Three stages, each with one job:

- **Transpile** — esbuild bundles `client/main.ts` with `--target=chrome53`,
  lowering syntax the C9 can't parse (`?.`, `??`, `async/await`, object spread)
  to ES2015. async/await becomes native generators, so no `regenerator-runtime`.
- **Polyfill** — `client/polyfills.ts` adds *only* curated missing built-ins via
  granular core-js imports, and deliberately omits the ones the `runtime.es2020`
  probe inspects — so polyfilling can't make the capability probe lie.
- **Package** — `webos/` holds the static shell (`appinfo.json`, `index.html`,
  icons); `scripts/package-webos.mjs` stages them with the bundle and runs
  ares-package. Regenerate placeholder icons with `npm run icons`.

Sideloading needs Developer Mode on the TV and a device registered via
`ares-setup-device` (LG webOS TV CLI).

**Packaging-tool note.** ares-package is vendored as the dev dependency
`@webosose/ares-cli` (the newer `@webos-tools/cli@3.2.4` ships a broken `rimraf`
call that fails on every Node version). Its old transitive tree makes `npm audit`
report findings — all dev-only; none ship in the .ipk. `npm run audit:prod`
confirms the shipped closure (core-js only) is clean.

## The one idea to take away

A device is not a tier. The **LG C9** has the panel and decode silicon for premium
multi-angle live but a Chromium-53 JS engine that can't orchestrate it. This system
grants it everything its hardware earns, denies multi-angle **for exactly one recorded
reason** (`runtime.es2020`), and turns that recorded reason into a ranked unlock list.
Linear tiers can't express that; per-feature capability gating can.

## Relationship to the sibling app

The committed `webOSStream/` app is the client-only Widevine/Shaka playback POC (a real
DRM license handshake against public test content). This `tvStreaming/` workspace is the
client-server expansion: the resolver and handshake that decide *what* that player is
allowed to do on a given device. See `docs/INTERVIEW.md §7` on why playback uses legal
DRM test vectors (Axinom/Shaka) rather than a commercial catalog.
