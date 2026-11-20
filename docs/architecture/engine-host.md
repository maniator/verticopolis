# The engine host

How the web game loads the Rust engine, runs it each frame and reads it back.
The engine itself is built and published from
[Verticopolis/engine](https://github.com/Verticopolis/engine) and described on
the docs site; this page covers the browser side. `src/wasmhost/`,
`src/engineBinding/`, `src/simport/` and `src/catalog/` live in
[Verticopolis/components](https://github.com/Verticopolis/components) at the
same paths, and the game imports them from `@verticopolis/components`.
`src/bootstrap.ts` and `src/game/` are in this repository. The engine version
the game runs is the `@verticopolis/engine` pin in `package.json`;
`scripts/engine-install.ts` copies its browser build into `src/public/engine/`
on `npm install`.

The engine runs on the page's main thread, inside the WASM module. There is
one engine: the game holds the binding's `Engine` object as its `EnginePort`
and calls it directly, with no TypeScript copy of the tower beside it and no
fallback if it cannot start.

## Boot

```mermaid
sequenceDiagram
    participant Page as bootstrap.ts
    participant Load as loadEngineModule
    participant Check as enginePackageCheck
    participant Rust as rustEngine.ts
    participant App as GameApp (main.ts)

    Page->>Load: load the package (with a deadline)
    Load->>Check: fetch BUILD.json, glue, .wasm once each
    Check-->>Load: verified bytes, or refuse (wrong build)
    Load->>Load: compile the hashed .wasm, import the glue from a Blob of the hashed bytes, init
    Load-->>Rust: module
    Rust->>Rust: checkBinding (every method the shell calls is there)
    Rust->>Rust: read both catalogs, refuse a foreign one
    Rust-->>Page: EnginePort (Engine.newGame), window.__vcEngine
    Page->>App: new GameApp(tower)
    Note over Page: any failure throws EngineBootError with a reason code,<br/>shown on the stop screen and in window.__vcEngineBoot
```

- **One load path.** `src/wasmhost/loadEngineModule.ts` is the only code that
  turns the served package into a running module. It fetches `BUILD.json`, the
  glue and the binary once each, and `enginePackageCheck.ts` refuses unless
  their hashes are the package this shell was built with, so a cache that
  mixes two deployments cannot start a mismatched engine. A development serve
  skips the byte check.
- **The binding check.** `checkBinding` (`src/engineBinding/binding.ts`)
  refuses a package that lacks a method the shell calls. `engine.d.ts` is
  generated from the Rust binding in Verticopolis/engine and checked in
  beside `checkBinding` in Verticopolis/components, so a renamed method fails the typecheck first.
- **The catalogs.** `rustBootTower` (`src/wasmhost/rustEngine.ts`) reads the
  Classic and Modern catalogs before it builds an engine and refuses a
  package whose kinds or world this build cannot draw. Every price, size and
  rule the UI shows comes from them (`src/catalog/`). It then hands the fresh
  engine's port to the boot the game passes in (`bootTower` from
  `src/game/bootTower.ts`, with `BOOT_SEED`), so `src/wasmhost/` never
  imports the game's save code.
- **Failure.** A failure is an `EngineBootError` with a reason from a closed
  list (`FALLBACK_REASONS` in `src/wasmhost/engineBoot.ts`), reported to
  analytics as `engine_status` and published on `window.__vcEngineBoot`. The
  game stops with recovery steps; **Repair engine files**
  (`src/wasmhost/engineRepair.ts`) refetches and checks the three engine files
  and writes them over a damaged cache entry.
- **Offline.** The service worker precaches the engine files with a Workbox
  integrity on each, so an installed game starts offline and a half-updated
  cache is never used (`vite.config.ts`, `src/wasmhost/engineAssets.ts`).

## Each frame

```mermaid
flowchart LR
    Loop["frameLoop.runFrame<br/>(Excalibur onUpdate)"] -->|"advance(carry, ms, minutes/s)"| Port["EnginePort<br/>(the WASM Engine)"]
    Port -->|steps run, new carry| Loop
    Loop -->|"update()"| Reader["viewReader"]
    Reader -->|"viewStructure (on a revision)<br/>viewFrame (every frame)"| Port
    Reader --> Render["render/ painters"]
    Reader --> HUD["ui/ HUD and windows<br/>(about 6 Hz)"]
    Loop -->|drainGameplayEvents| Events["audio, Bulletin, analytics"]
```

- **Time.** `runFrame` (`src/game/frameLoop.ts`) hands the engine the real
  milliseconds, the speed and the carry; the engine paces and steps the owed
  minutes itself (`src/fixed_step.rs` in Verticopolis/engine).
- **The view.** `src/simport/viewReader.ts` decodes the engine's
  `Float64Array`s using the slots and code tables of `viewLayout()`. The
  structure is decoded only when the tower revision moves; the frame patches
  the rooms that changed and rewrites people and cars in place, so a frame
  allocates little. The reader decodes and never decides a rule.
- **Commands.** A build or edit is one `EnginePort` call that answers a result
  record: done or refused, the money moved, and the engine's reason
  (`lastReason()`). The full contract is in
  [`engine-port-contract.md`](../../_bmad-output/planning-artifacts/architecture/architecture-rust-facade-2026-10-20/engine-port-contract.md),
  and `src/simport/enginePort.types.test.ts` holds the binding to the
  `EnginePort` type.
- **Faults.** A WASM trap in a command, a tick or a save is told apart from a
  clean refusal (`isEngineTrap`, `src/wasmhost/hostFault.ts`). The first trap
  is latched in `src/game/engineFault.ts` and goes to the handler boot
  installs, which stops the game and reloads it from its last autosave
  (#1422). Every save after a trap is refused (`engineTrapped()` in
  `src/game/portLifecycle.ts`, `TRAPPED_SAVE_REFUSED`), so the last good save
  stays.

## Saves

The engine writes and reads every save; the host only keeps the bytes. See
[save-paths.md](./save-paths.md).

## Where to look

| Path | What |
| --- | --- |
| `src/bootstrap.ts` | Boot: WebGL probe, engine load, the app, the service worker |
| `src/wasmhost/` | Loading and checking the package, boot state, repair, diagnostics, the frame decode helpers |
| `src/engineBinding/` | The binding's declaration (`engine.d.ts`), the method lists and their tiers |
| `src/simport/` | `EnginePort`, the view reader, typed reads (cards, panels, schedules) |
| `src/catalog/` | The catalog handle the UI reads prices, sizes and rules from |
| `src/wasm.rs`, `src/wasm/`, `src/wasm_port*.rs` in Verticopolis/engine | The Rust side of the binding |

A worker host was tried and not adopted; its record is
[wasm-worker-host.md](./wasm-worker-host.md).
