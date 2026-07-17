# Decision Log: Hotel Cockroach Infestation Lifecycle

Companion to `gdd-cockroach-infestation-2026-07-16.md`.

## 2026-07-16, Mechanic ratified

- **Trigger:** owner review of a live save showed 96 dirty hotel rooms with no
  in-UI cockroach indicator; asked to draw them and explain the cause.
- **Method:** party-mode design debate (game designer, systems architect,
  pragmatist, edge-case hunter) on the Modern-mode resolution, plus direct owner
  decisions via question prompts.
- **Decisions:**
  1. Classic = full 1994 parity: infested is permanent, bulldoze-only. This
     REVERSES the prior "keep rooms cleanable" decision in `PARITY.md` / the
     `#376` will-not-build note. (Owner: "full simtower parity for classic.")
  2. Modern = paid exterminator, `$5,000` call-out + `$2,000`/infested room,
     resolves next day, bulldoze stays as the free alternative. New mechanic,
     owner-ratified. (Owner: "debate with a proper party for modern. maybe have
     to pay for exterminator." → party landed the design → owner: "Yes, build
     this" + "Scaling + call-out.")
  3. Escalation timer = 3 dirty days, identical in both modes; spread unchanged.
     (SUPERSEDED 2026-07-17, v1.53.1: canon research narrowed the spread source to
     `infested` only, not `dirty || infested`. See the housekeeping-overhaul GDD.)
  4. Visibility (both modes): roach sprite on dirty/infested, inspector "why",
     housekeeping overlay tints dirty/infested/out-of-reach (#401).
  5. Ship everything in one PR (owner: "Everything in one PR").
- **Rejected:** flat cheap exterminator fee (exploit: skip housekeeping
  entirely); instant painless extermination (deletes the mechanic). Upgrade tree
  / placeable exterminator (gold-plating).
- **Open:** exact dollar tuning provisional pending playtest; next-day resolution
  clears exactly the rooms billed at call time (remembered as a transient id
  list), so overnight threshold-crossers are billed and cleared together rather
  than discounted; the clear-all path remains only as a fallback when the billed
  set is lost to a mid-booking save/load. Accepted for v1.
