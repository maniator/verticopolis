# Release 3.0 exception register

The cutover plan (`rust-wasm-web-cutover-plan-2026-10.md`, S15 and the
Sign-off row of section 6) has the owner approve 3.0.0 with this register
attached. Each entry is a known gap the release ships with, why it is
accepted, and how the release checks it stays that size. An entry stays
**proposed** until the owner approves it at the #945 sign-off; only the owner
approves an exception.

## EX-1: a rollback past #902 treats every infested room of a pending booking

- **Source:** S5, #902 (`exterminationRoomIds` in the save).
- **Status:** proposed (2026-10-20, with the #902 change). Awaiting the
  owner's decision at the #945 sign-off.
- **What is lost:** a Modern tower saved while an exterminator booking is
  pending carries the ids of the rooms the booking billed. A build from
  before #902 ignores that field, so when the booking lands it clears every
  infested room, including rooms that became infested after the booking,
  at no extra charge. That build's next save drops the list, so moving
  forward again keeps the tower-wide treatment for that booking. A stale
  engine package from before #902 running on the WASM host does the same
  until the delivery check (S16) lands: the host adopts the engine's state,
  which has no list.
- **Size:** one pending booking per affected tower (a booking lands the next
  morning), in the player's favor, with no crash, refusal or other save
  data lost. Classic towers and towers with no pending booking are not
  affected.
- **Why accepted:** S5 carries the list as an optional field with no
  save-version bump, so every build can still open the save. A version bump
  would make a rolled-back build refuse the save outright, which costs the
  player more than one free treatment.
- **Check (proposed):** the Rollback row that the 3.0 web release plan
  proposes (`release-3.0-web-plan-2026-10-20.md`, section 10, PR #1080) adds
  a deploy rollback to the last release before #902 with a tower the
  candidate wrote mid-booking, confirming this loss and nothing more. The
  cutover plan's section 6 Rollback row only flips the default back on the
  same build, which keeps the field and cannot show the loss, so the check
  binds once the owner approves that plan.

## EX-2: the engine's raw save text differs from the TypeScript writer's in number form and in a transport's key order

- **Source:** the Saves audit (#1236), `conformanceWasmSaves.integration.test.ts`.
- **Status:** proposed (2026-10-21). Awaiting the owner's decision at the
  #945 sign-off, together with the question below.
- **What differs:** the Saves row of #945 says "byte for byte through the
  engine". The audit compares canonical JSON (keys sorted), where every
  fixture and loader case matches, and the file the engine writes, which is
  the TypeScript writer's text except for one thing. The raw text differs in
  two ways:
  - **Number form (the binding's `serialize()` text only).** It prints an
    integer-valued double with a trailing `.0` (`"money":13551601.0` where
    TypeScript writes `13551601`): 634 to 1,474 numbers per fixture, text
    0.3% to 1% longer (0.27% to 0.95% measured). The `.vctower` writer re-prints numbers the
    JavaScript way (`js_json`), so a written file has the same numbers and
    the same length as the TypeScript writer's.
  - **Key order inside a transport (files and text).** TypeScript writes a
    transport's keys where its object history put them. `carLoad` comes
    before `load` when a save carries it (`src/engine/sim/serialization.ts:409`)
    and after it when dispatch appends it on the first tick
    (`ElevatorDispatch.ts:130`); the stairs in the `split-tower-4` fixture
    come out with their keys sorted. The Rust serializer has one fixed order.
- **What a player sees:** nothing. A file the engine writes loads to the same
  tower in both engines.
- **Is raw equality achievable?**
  - **Number form:** yes, by printing `serialize()` through `js_json`, but
    that costs about 1.5 times as much per call (24 ms to 36 ms on
    `split-tower-4`, measured by the independent reviewer in Node), and
    `serialize()` is on the hosted merge path every revision change
    (`wasmHost.ts:286`, `workerCore.ts:133`, the #1051 frame path). Every
    consumer of that text runs `JSON.parse` on it, so nothing reads the form.
    I tried it and reverted it for that reason.
  - **Key order:** not without a data-model change. No fixed Rust order
    matches both histories, so matching would mean a per-transport order
    record in the Rust transport, set at load and in dispatch, plus a
    serializer that reads it. That touches `engine-rs/` (it moves the
    seeded-replay window key) and `load.rs`, which the Saves audit and A8
    lanes own, to change where keys sit in a file no reader compares.
- **Case for accepting:** the text form is the binding's own and no reader
  compares it, the written file already matches, and the order record costs
  engine data-model state and a window restart for a position nothing reads.
- **Decision for the owner:** is canonical JSON equality (with the written
  file) the criterion for the Saves row, or must the raw text match as well?
  If it must, this entry is not enough and the serializer changes instead.
- **Check:** the Saves audit pins both differences (the binding text carries
  `.0`; the written file equals the TypeScript writer's text once each
  transport's keys are sorted), so a fix of either fails the test and this
  entry has to be removed or rewritten.
