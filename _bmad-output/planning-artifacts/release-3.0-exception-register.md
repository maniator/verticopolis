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

## EX-2: the engine's raw save text differs from the TypeScript writer's in number form and, inside a transport, in key order

- **Source:** the Saves audit (#1236), `conformanceWasmSaves.integration.test.ts`.
- **Status:** proposed (2026-10-21). Awaiting the owner's decision at the
  #945 sign-off, together with the question below.
- **What differs:** the Saves row of #945 says "byte for byte through the
  engine". The audit compares canonical JSON (keys sorted, numbers
  re-printed in JavaScript form), where every fixture and loader case
  matches. The raw text does not match, in two ways:
  - **Number form (binding text only).** `Engine.serialize()` prints an
    integer-valued double with a trailing `.0` (`"money":13551601.0` where
    TypeScript writes `13551601`). That is 634 to 1,474 numbers per fixture,
    and the binding text is 1,268 to 2,948 bytes longer (0.2% to 0.4%).
  - **Key order inside a transport (files and text).** The order of
    `carLoad` against `load` follows the history of the TypeScript object
    (`carLoad` lands after `load` when dispatch adds it and before it when a
    save carries it); the Rust serializer has one fixed order.
- **What a player sees:** nothing. The file the engine writes from its own
  text re-prints numbers the JavaScript way, so it is the same length as the
  file made from the TypeScript text, and it loads to the same tower in both
  engines. Only the position of two keys in a transport differs.
- **Is raw equality achievable?** The number form is: the binding could print
  numbers through the same `js_json` form `encode_vctower` already uses. The
  key order is not without a data-model change. TypeScript writes a
  transport's `carLoad` where its object history put it: a save that carries
  `carLoad` gets it from the loader's object literal
  (`src/engine/sim/serialization.ts:409`), and a transport that lacks it gets
  it appended on the first dispatch tick (`ElevatorDispatch.ts:130`), after
  `load`. No fixed Rust order matches both, so matching would mean a
  per-transport order flag in the Rust transport, set at load and in
  dispatch, plus a serializer that reads it. That touches `engine-rs/` (it
  moves the seeded-replay window key) and `load.rs`, which the Saves audit
  and A8 lanes own, to change where two keys sit in a file no reader compares.
- **Why accepted:** the order flag costs engine data-model state and a
  window restart for a position nothing reads, and the number form is the
  binding's own text, which no reader compares byte for byte.
- **Decision for the owner:** is canonical JSON equality the criterion for
  the Saves row, or must the raw text match? If raw, this entry is not
  enough and the serializer changes instead.
- **Check:** the Saves audit pins both differences with their size (the
  raw text is longer and carries `.0` numbers; the written file has the same
  length and the same canonical JSON), so a change in either direction fails
  the test and this entry has to be removed or rewritten.
