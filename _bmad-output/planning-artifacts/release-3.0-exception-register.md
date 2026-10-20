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
