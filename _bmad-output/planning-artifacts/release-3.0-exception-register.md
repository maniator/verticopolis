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

## EX-2: inside a transport, the engine's raw save text puts `carLoad` where the TypeScript writer's history put it

- **Source:** the Saves audit (#1236), `conformanceWasmSaves.integration.test.ts`.
- **Status:** proposed (2026-10-21). Awaiting the owner's decision at the
  #945 sign-off, together with the question below.
- **What differs:** the Saves row of #945 says "byte for byte through the
  engine". The audit compares canonical JSON (keys sorted), where every
  fixture and loader case matches. The raw text matches in length and in
  every number (the binding's `serialize()` prints numbers as JavaScript
  does since the audit's first review round), and differs in one thing: the
  order of `carLoad` against `load` inside a transport. TypeScript writes
  `carLoad` where its object history put it: a save that carries it gets it
  from the loader's object literal (`src/engine/sim/serialization.ts:409`),
  before `load`, and a transport that lacks it gets it appended on the first
  dispatch tick (`ElevatorDispatch.ts:130`), after `load`. The Rust
  serializer has one fixed order.
- **What a player sees:** nothing. The file the engine writes is the same
  length as the file made from the TypeScript text and loads to the same
  tower in both engines. Only the position of two keys in a transport
  differs, first at byte 104,662 of the split-tower fixture.
- **Is raw equality achievable?** Not without a data-model change. No fixed
  Rust order matches both histories, so matching would mean a
  per-transport order flag in the Rust transport, set at load and in
  dispatch, plus a serializer that reads it. That touches `engine-rs/` (it
  moves the seeded-replay window key) and `load.rs`, which the Saves audit
  and A8 lanes own, to change where two keys sit in a file no reader
  compares.
- **Why accepted:** the order flag costs engine data-model state and a
  window restart for a position nothing reads.
- **Decision for the owner:** is canonical JSON equality the criterion for
  the Saves row, or must the key order match as well? If it must, this entry
  is not enough and the serializer changes instead.
- **Check:** the Saves audit pins the state of things (raw text equal in
  length and numbers, equal as canonical JSON, same-length written file), so
  a change in either direction fails the test and this entry has to be
  removed or rewritten.
