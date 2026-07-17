# Hotel Cockroach Infestation Lifecycle (2026-07-16)

Status: design spec (GDD altitude). Owner-ratified via party-mode debate on
2026-07-16. This is the design source of truth for the cockroach/infestation
mechanic; the build spec lives at
`_bmad-output/implementation-artifacts/spec-cockroach-visibility-infestation.md`
and ships as one PR (branch `claude/cockroaches-ui-visibility-c51wlw`, review
skill `/gds-code-review`). Supersedes the `#376` "will-not-build" line and the
`#401` "proposed overlay" line in
`gdd-simtower-optimization-gaps-2026-07-15.md` (both cross-referenced below).

## Why this exists

The engine already breeds cockroaches (a hotel room left `dirty` overnight
spreads to its neighbors) but the player has no way to see or locate them: the
only signal is a one-shot log toast, there is no roach sprite, no distinct
infested state, and the Housekeeping overlay tints crew reach rather than the
dirty rooms. The 1994 original drew an unmistakable roach sprite over infested
rooms and made them un-cleanable (bulldoze only). An owner review of a live save
(`sixseven_11.vctower`: 96 dirty rooms spread across floors 14 to 59, invisible
in the UI) confirmed the gap. This mechanic makes the infestation legible and
gives it a real lifecycle and counterplay.

## Pillar served

Reinforces the existing **"under-provision has visible, escalating
consequences"** pillar (the same one housekeeping capacity and the
can't-reach / at-capacity advisories serve). Neglecting housekeeping already
costs money silently; this makes the cost visible, located, and escalating, and
gives the player a clear lever to recover.

## The mechanic

### Room lifecycle (both modes)

```
empty --booked(evening)--> asleep --checkout(morning)--> dirty
  ^                                                         |
  |                                                         | housekeeper arrives
  +---------------------------- empty <---------------------+
                                                            |
                              dirty for 3 consecutive days  |
                                                            v
                                                        infested
```

- Booking is gated on `state == empty` (verified in `churn.ts`), so `dirty` and
  `infested` rooms are already unbookable and earn no rent. No new guard is
  needed; the new `infested` state inherits the gate because it is not `empty`.
- **Escalation:** a hotel room continuously `dirty` for **3 in-game days**
  becomes `infested`, evaluated at the daily checkout boundary before that
  morning's fresh checkouts. The day the room went dirty is tracked per room so
  the clock survives save/reload (no reset-by-reload exploit).
- **Infested rooms:** housekeeping can no longer clean them (dispatch only ever
  targets `dirty`). They earn no rent and are the cockroach **spread source**, so
  an untreated infestation keeps eating the wing.
- **Spread:** an `infested` room soils an adjacent hotel room (turning it `dirty`)
  each morning. **[SUPERSEDED 2026-07-17, v1.53.1]** This section originally said
  "unchanged from today: a dirty-or-infested room soils a neighbor." Canon
  research (SimTower wiki/FAQ) later confirmed only *infested* rooms spread, not
  merely dirty ones, so the source was narrowed to `infested` only. See
  `gdds/gdd-verticopolis-2026-07-17-housekeeping-overhaul/`.

### Mode divergence (through GameRules only)

| Aspect | Classic | Modern |
| --- | --- | --- |
| Escalation timer | 3 days | 3 days |
| Spread | yes | yes |
| Housekeeping cleans infested | no | no |
| Recovery of an infested room | **bulldoze + rebuild only** (permanent) | **paid exterminator** OR bulldoze |
| `GameRules.infestationRecovery()` | `null` | `{ calloutFee, perRoomFee }` |

- **Classic is 1994 parity:** infested is a terminal, permanent state. The only
  fix is the bulldozer, then rebuild. This intentionally REVERSES the current
  documented "keep every dirty room cleanable, no permanent infestation"
  decision (see Parity note below).
- **Modern adds a paid exterminator** (new mechanic, no 1994 equivalent,
  owner-ratified):
  - Cost = **`$5,000` call-out fee + `$2,000` per infested room** (provisional,
    tunable). One dispatch treats the whole tower.
  - **Resolves the next day.** Between dispatch and resolution the infested
    rooms still earn nothing and dirty neighbors keep spreading, so waiting to
    call still hurts.
  - Bulldoze remains available as the free-but-manual alternative.
  - **The crossover is the decision:** per-room fee is tuned so a small outbreak
    is cheaper to exterminate (and keeps the room earning) while a large
    neglected wing is cheaper to bulldoze. That tension is the point; do not
    make the exterminator a strictly-dominant one-click fix (the party rejected
    both "flat cheap fee" for being an exploit and "instant, painless" for
    deleting the mechanic).

### Numbers (provisional, tune during review/playtest)

- Escalation: `INFEST_DAYS = 3`.
- Modern exterminator: `calloutFee = 5000`, `perRoomFee = 2000`.
- Reference points: a housekeeping unit costs `$50,000`; a hotel room rents
  around `$1,500` a night. So a 3-room outbreak costs `$11,000` to exterminate
  (cheap relative to lost rent and rebuild); a 40-room neglected wing costs
  `$85,000` and tilts toward the bulldozer.

## Visibility (both modes)

- **Roach sprite:** dirty rooms render a light cockroach cue; infested rooms
  render a heavier one. Render layer only; the engine exposes state, never
  pixels.
- **Inspector:** friendly status text (no raw enum) for `dirty`, `asleep`, and
  `infested`, each with a plain-language WHY and the mode-correct fix
  (housekeeping can't keep up / bulldoze / call the exterminator).
- **Housekeeping overlay (#401):** tints actual `dirty` and `infested` rooms and
  flags floors outside staff/service-elevator reach, reusing the existing
  heatmap pipeline. (The cleanliness heatmap already tints dirty/out-of-reach;
  this adds the `infested` tier.)
- **Housekeeping coverage readout:** parity with the parking legibility pattern
  (`parkingDemand()` + its stats rows + per-unit inspector line). Today a
  housekeeping station's inspector is blank and no panel says the player is
  under-provisioned or where. Add a coverage figure (crews, ~rooms/day capacity,
  rooms out of staff reach) as a stats row and a per-station inspector line.

## Parity note (ratified divergences)

- **Classic (restores canon):** the roach/infested state and its bulldoze-only
  recovery are faithful to SimTower 1994. Restoring them RE-OPENS a decision the
  project had previously closed: `PARITY.md` (Housekeeping section) and the
  `#376` "will-not-build" note both state Verticopolis keeps rooms cleanable and
  does not model permanent infestation. Both must be updated to record that
  Classic now ships full parity. The related "6-floor pathfinding quirk"
  will-not-build stays will-not-build; only the permanent-infestation line
  changes.
- **Modern (new mechanic):** the paid exterminator has no 1994 equivalent. It is
  owner-ratified and recorded here as a Modern-only divergence, in the same
  family as the other Modern-only economy sinks (operating overhead, condo hold
  tax, noise erosion). Gated entirely through `GameRules`; no `if (mode === ...)`
  in the engine body.

## Success metrics

- On the owner's reference save, every one of the 96 affected rooms is visibly
  marked (sprite + overlay) and locatable, and its inspector explains the cause.
- A player who lets rooms rot sees infested rooms appear on day 3 and, in Modern,
  is offered a priced exterminator; in Classic, is directed to bulldoze.
- No regression: dirty/infested rooms remain unbookable and non-earning
  (guarded by a new test), and the existing housekeeping advisories still fire.

## Out of scope (this mechanic)

- Exterminator upgrades, staff, or a placeable extermination facility (the party
  explicitly cut the upgrade tree; the exterminator is a priced action, not a
  building).
- Per-room targeted extermination UI (one tower-wide dispatch only for v1).
- Any change to the housekeeping capacity/routing model itself (covered by other
  gaps-doc items).

## Open questions / notes for designer

- `[NOTE FOR DESIGNER]` Final dollar tuning of `calloutFee` / `perRoomFee`
  confirmed only at the "scaling + call-out" shape; exact values are provisional
  pending a playtest pass.
- `[NOTE FOR DESIGNER]` Next-day resolution clears exactly the rooms billed at
  call time (remembered as a transient id list), so a room that crosses the
  3-day threshold overnight is billed and cleared together, never swept "for
  free." Only if that id list is missing after a mid-booking save/load does
  resolution fall back to clearing every infested room. Bounded by the timer and
  accepted for v1 (documented in the build spec).

## Cross-references

- Build spec: `_bmad-output/implementation-artifacts/spec-cockroach-visibility-infestation.md`
- Supersedes lines in: `gdd-simtower-optimization-gaps-2026-07-15.md` (`#376`
  infested/sticky states; `#401` housekeeping-coverage-overlay)
- Canon: `PARITY.md` (Housekeeping), `_bmad-output/project-context.md`
  (housekeeping never-instant, distinct art, finite capacity)
- Issues: `#376`, `#401`
