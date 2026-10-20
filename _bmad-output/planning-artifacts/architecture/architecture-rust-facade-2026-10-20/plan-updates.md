# Proposed updates to the spine, the 3.0 plan, #868, #954 and #1104

> **Snapshot, written 2026-10-20 against `main` at `93ec86a`, amended after
> the independent review.** Status: the owner signed off F1 to F9 at 21:40
> UTC. The Runtime fallback thread applied the #868 and #954 bodies
> (sections 3 and 4, with its own additions) at 21:42 and the review's
> amendments at 21:45; the #1104 rows went to the triage thread, which edits
> that issue, with the rows that depend on R3 held for the owner's answer.
> The spine and plan edits are applied in the docs PR that follows #1184,
> together with the owner's R3 decision of 21:56 UTC (release plan section
> 1.2).

## 1. Spine: AD-9 and the amendments it brings

Add to
`architecture-rust-wasm-cutover-2026-10-13/ARCHITECTURE-SPINE.md`:

> ### AD-9: One simulation on the healthy WASM path
>
> - **Binds:** FR1, FR4, NFR1, `src/simport/` (new), `src/wasmhost/`,
>   `src/main.ts`, `src/game/`, `src/ui/`, `src/render/`
> - **Prevents:** a second simulation in the page that has to be kept in
>   step with the engine, answers commands or panels the engine should
>   answer, and costs a full merge on every hour and every edit.
> - **Rule:** while the WASM engine is healthy, the page holds no
>   TypeScript `Simulation`. `app.sim` is a `SimPort`: commands and panel
>   queries go to the engine and return promises on every host; the
>   renderer and HUD read a view built from engine data (a structural
>   snapshot rebuilt on a revision change, a per-frame dynamic frame with
>   changed units only, a header, cached slices). The view holds no rule
>   and decides nothing. Saves, undo, loads and imports use engine bytes.
>   The TypeScript engine runs only after a fault, started from an
>   engine-written restore point and its transient sidecar, behind the same
>   port. A guard fails the build when production code outside the fallback
>   module reaches the `Simulation` module at run time, and an e2e check
>   fails when normal play constructs or deserializes one.

Amendments:

- **Design Paradigm:** "The web host is an adapter over the WASM binding"
  becomes "The web host implements one `SimPort` per host (main thread,
  worker, fallback); `src/ui`, `src/game` and `src/render` see only the
  port". The diagram's "relay until retirement" edge becomes "fallback
  after a fault".
- **AD-1:** drop "The instance skips a command the engine refused", since
  under AD-9 there is no instance on the healthy path. Scope "A
  disagreement is reported and the engine's state wins" to wherever two
  engines answer the same command (the mirror host while it exists, the
  dual run, the parity harness), which is where #1064 and #1065 run (D5, no
  exception; review R2). Keep the one result shape and the engine-only log
  and events.
- **AD-4:** the structural snapshot moves from Deferred into the rule, with
  its layout version beside the frame's.
- **AD-8:** add "the undo signature comes from an engine change counter".
- **Deferred:** remove "the merge read model" (AD-9 removes it) and
  "structural snapshot shape" (now in AD-4).

## 2. The 3.0 plan (`release-3.0-web-plan-2026-10-20.md`)

| Section | Change |
| --- | --- |
| Header and 1.1 | Add the owner's 2026-10-20 20:45 UTC direction (Rust authority, no TypeScript mirror on the healthy path) and, once signed off, AD-9 |
| 3, critical path | `P868` becomes "#868 S6: the facade (slices 1 to 8 and 10)", fed by the owner's sign-off instead of RUN-0b and A5's rule; `P954` becomes "#954 S9: Rust-first commands (slices 2, 7 and 10)"; add "slice 13, load-time memory" feeding PERF ahead of the facade's protocol run; `A5R` and the `RUN0B --> P868` edge go (mappings per R3, waiting on the owner) |
| 3, phases | Phase B: "S6 (the facade slices to 8)"; phase C: "the PC run on the facade, then the facade as the WASM host (owner)" |
| 3, the reliability window | Eligible sessions start with S9, which under AD-9 is the facade becoming the WASM host (slice 10), so the 1,000-session count and the observation period start later than the plan assumed; eligibility itself is unchanged (F9). Slice 10 over slice 11 is R3, waiting on the owner; `?engine=wasm-mirror` sessions are early telemetry. On facade sessions the divergence line is empty by construction, and rule 3's disagreement evidence is the dual run and parity in CI (R2); a "recovery point refused" line joins the report (R5) |
| 6, assumption 6 | Audio cues read the view's header or engine events; the cue-timing test runs on the facade |
| 9.1, A5 | "S6 #868: the Rust-backed facade (AD-9), slices 1 to 8 and 10 of `architecture-rust-facade-2026-10-20/slice-plan.md`; audio cue-timing test; slice 11 before the freeze" (R3) |
| 9.1, A6 | "S9 #954: commands through the port, Rust first (slices 2, 7 and 10), with #1064, #1065, #1066" |
| 9.1, new A8 | "Engine load-time memory peak (slice 13), against M6, before the facade's protocol run" (R4) |
| 8, RUN-1 | Unchanged: RUN-1 is the shipping host's run after S6, which under AD-9 is after slice 10. Slice 9 is the facade's own pre-switch run and does not count as RUN-1 |
| 11, risks | Add: the port migration regresses a UI flow (strangler order, revert per slice); the facade's PC run fails (stop rule, the owner decides); restore-point cost (the 50 ms save budget measured on the PC, with remedies per kind of save: review section 5.7); a recovery point fails to load at a fault (R5) |
| 12, OD-9 (ii) | Note: superseded by AD-9 for S6 once signed off; RUN-0b's cost split stays as the baseline |

## 3. #868, proposed body

> **engine-rs binding and host: the Rust-backed facade's read side (S6 under AD-9)**
>
> Under AD-9 the healthy WASM path holds no TypeScript `Simulation`. This
> issue is the read side: what the engine hands the browser so the
> renderer, HUD, panels and previews work without a mirror. Design and
> slices: `_bmad-output/planning-artifacts/architecture/architecture-rust-facade-2026-10-20/`.
>
> **Acceptance**
>
> 1. A `SimPort` with a `TsSim` and a `RustSim` adapter; `app.sim` is the
>    port; no production code outside the fallback module reaches the
>    `Simulation` module at run time (import ratchet).
> 2. The view: a structural snapshot rebuilt on a revision change (floor and
>    lobby tiles as runs), a dynamic frame of the drawn people, cars and
>    changed units only (engine dirty marks, no walk over all units per
>    frame), the header with the unlocked kinds, exported layout widths and
>    version checked on load.
> 3. Rust getters for the panels and overlays, each cached by revision or
>    hour, each with a differential test against the TypeScript function it
>    replaces on the conformance corpus: the stats screen, unit and
>    transport detail, the facility diagnostics facts, the floor heatmap,
>    peak congestion, the queue view, the onboarding facts.
> 4. The binding gaps the port audit found: `canBuild` and `isUnlocked`
>    through the port, `previewRentBatch`, the exterminator's `cost` and
>    `rooms`, an unknown kind refused instead of thrown,
>    `placeTransportDryRun` and `validateTransport`.
> 5. On the WASM path in production: no per-step sync, no hourly or
>    per-revision `serialize` / `JSON.parse` / `Simulation.deserialize` /
>    merge. The cadence-excluded tests run on the port contract suite and
>    leave the exclusions ratchet, one mapping row each; the parity projects
>    and the dual run keep the mirror as a test-only host; a test that
>    cannot be expressed through the port goes to the owner as a gate
>    exception before slice 11 (review R1).
> 6. The `chromium-wasm` e2e project passes on the facade, with a check that
>    normal play constructs and deserializes no `Simulation`; the audio
>    cue-timing test passes.
> 7. The PC protocol run on the facade (medium and large, 1x and 4x) is
>    recorded before the facade becomes the WASM host, after the load-time
>    memory item (review R4).
>
> Not in this issue: Rust-first commands (#954), the worker adapter (after
> the flip, AD-7), the load-time memory peak (its own issue).
>
> Review: `/gds-code-review` (engine data), `/bmad-code-review` for the
> port plumbing, the hot-path record on every slice.

## 4. #954, proposed body

> **WASM host: every command goes to the engine through the port, once**
>
> Under AD-9 the healthy WASM path has no TypeScript instance, so a command
> can only be answered by the engine. This issue is the command side of the
> facade (slices 2 and 7 of the slice plan).
>
> **Acceptance**
>
> 1. Every tier-1 command goes through `SimPort.command()` and the caller
>    gets the engine's result; on the WASM path nothing else applies it.
> 2. One result shape, `{ ok, reason?, delta? }` plus named fields, through
>    one adapter, on every host; commands return promises, resolved in the
>    same task on the main thread.
> 3. Commands run in issue order through one queue; a refusal changes
>    nothing; the log and gameplay events come only from the engine, with no
>    duplicates or drops across a refused command.
> 4. Loads and undo boot the engine from engine-written bytes (AD-8); the
>    undo signature is the engine's change counter.
> 5. Under the fallback, `TsSim` answers through the same port and the same
>    result shapes.
>
> **Tests:** one per command that the result is the engine's; order and
> refusal per command family; the log and event streams across a refusal;
> `chromium-wasm` green on the facade.
>
> The 2026-10-20 handover from #874 (report a command the instance
> accepted and the engine refused) holds by construction on the facade,
> since no instance answers; today's instance-first host still reports it
> until slice 11 removes that host from production (the Runtime thread made
> it acceptance item 6).
>
> **Blockers (D5, no exception):** #1064 and #1065. They run wherever two
> engines answer the same command: the mirror host while it exists, the
> dual run and the parity harness (review R2).
>
> Depends on #868 (the port and result shapes) and #874 (the fallback). It
> gates the default flip (#945). Review: `/gds-code-review`.

## 5. #1104 rows (for the triage thread, after sign-off)

| Row | Change |
| --- | --- |
| A5 | Work: "S6: the Rust-backed facade (AD-9), slices 1 to 8 and 10; cue-timing test; slice 11 before the freeze" (R3, held for the owner's answer). Depends on: "the owner's sign-off; slices 5, 7, 8 after the Runtime thread's #1113/#1126/#1149 PR in shared files". Next step: "slice 1's story" |
| A6 | Work: "S9: Rust-first commands through the port (slices 2, 7 and 10) and the D5 items (#1064, #1065, #1066)". Depends on: "A3, A5's slice 1" |
| new A8 | "Engine load-time memory peak (slice 13)", key yes, against M6, before the facade's protocol run (R4) |
| Unit and integration gate | Blocking work: "A5 (the facade) removes the named exclusions: the cadence-excluded tests move onto the port contract suite in slice 7; the parity projects keep the mirror as a test-only host" (R1) |
| Performance gate | Blocking work: add "A8 for M6, then the PC run on the facade (slice 9)" |
| Reliability gate | Note that eligible sessions start with the slice that puts `RustSim` on the WASM path (slice 10; R3, held for the owner's answer); the divergence line is empty on facade sessions by construction (R2); a "recovery point refused" line (R5) |
| B7 (#1068) | Next step: the owner's recommendation now weighs that AD-9 ends #1068's read-model role; its Rust `SaveMirror` stays a candidate for restore points only |
| Off the path | #1049 and #1050 are retargeted to the facade's view (slice 6a covers #1049's changed units; the structural snapshot covers #1050) |

## 6. Backlog rows and issues (after sign-off)

One curated row per slice that is not already an issue, each with its
mirror issue (plain title, a type label and a P label):

| Story | GH | Type | Priority | Notes |
| --- | --- | --- | --- | --- |
| `facade-port` (slice 1) | new | task | P1 | Port, view interfaces, `TsSim`, import ratchet |
| `facade-commands` (slice 2) | #954 | task | P1 | existing row, retitled |
| `facade-renderer-view` (slice 3) | new | task | P1 | Rendering thread |
| `facade-panels` (slices 4, 6b, 6c) | #868 | task | P1 | existing row, retitled |
| `facade-lifecycle` (slice 5) | new | task | P1 | Runtime thread |
| `facade-engine-view` (slice 6a) | #1049 retargeted | enhancement | P1 | changed units and the structural snapshot |
| `facade-rustsim` (slices 7, 8) | new | task | P1 | behind `?engine=wasm-facade` |
| `facade-mirror-removal` (slice 11) | new | task | P1 | after a release on slice 10 |
| `engine-load-memory-peak` (slice 13) | new | enhancement | P1 | M6 |
