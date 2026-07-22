# GDD: Star-tiered lobby fees (new mechanic, provisional, gated)

- **Date:** 2026-07-22
- **Lane:** GDS (gameplay/engine parity), owner-directed
- **Status:** DESIGN ONLY. Implementation is GATED on #575-grade primary
  verification of the fee figures (single-lineage sources today). Authored per
  the owner's 2026-07-22 call so the design is ready.
- **Trigger:** spun out of `canon-maintenance-table` (#573): the star-tiered
  lobby fee is not a row in the existing maintenance chart, it is a NEW mechanic
  the engine does not model at all, so per the followups-spec ruling it needs
  its own GDD rather than a drive-by into the maintenance seam.

## 1. What it is

In 1994 SimTower the lobby is not free to keep once the tower matures. Lobby
upkeep is tiered by the tower's star rating:

| Star rating | Lobby fee |
| --- | --- |
| 1-2 stars | free (0) |
| 3 stars | 300 per lobby segment |
| 4+ stars (incl. Tower) | 1,000 per lobby segment |

A "segment" is a unit of lobby width (the source phrasing is "per segment").
The exact segment definition (per tile, per placed lobby unit, or per canon
lobby span) is an OPEN QUESTION to pin during verification, see below. The fee
is charged on the maintenance cadence (per canon quarter in Classic).

Provenance: this fee appears across the same single lineage as the rest of the
maintenance chart (BStuart FAQ -> Relentless Optimizer -> Fandom, not
independent; the official manual is silent on the figures). Provisional pending
#575-grade verification.

## 2. Why add it (design intent)

- **Parity.** Classic is parity-locked to 1994; a canon money sink that scales
  with maturity is in scope where new mechanics are not. Today Classic lobbies
  are free forever, which under-charges a mature tower.
- **A maturity cost curve.** The fee turns lobby footprint into a growing
  liability as stars climb, a deliberate 1994 pressure (wide ground lobbies and
  many sky lobbies cost more to run at 4-5 stars). It is a pure sink; it never
  pays out.
- **No star shortcut.** Stars gate on population, never on money, so a larger
  fee bill does not change progression; it only tightens the late-game cash
  glut Classic is known for, in the canon direction.

## 3. Mechanic

- On the maintenance cadence, charge `lobbyFee = lobbySegments * feePerSegment(star)`
  where `feePerSegment` is 0 (1-2 stars), 300 (3 stars), 1,000 (4+ stars).
- Charged to the `upkeep` ledger line (or its own "lobby" line if the finance
  breakdown wants it legible; decide with UX).
- **Classic** adopts the canon table once verified. **Modern** is a separate
  decision (its own tuning pass): Modern may keep lobbies free, adopt the canon
  fee, or set its own curve. Route through the rule-set seam (a
  `GameRules.lobbyFeePerSegment(star)` member) exactly like the pricing and rent
  seams, so no `mode === "modern"` leaks outside `gameRules.ts` and Modern stays
  byte-identical until deliberately changed.

## 4. Open questions (pin during verification)

1. **Segment definition.** Is a "segment" one tile of lobby width, one placed
   lobby unit, or a canon fixed span? This sets the absolute bill size and must
   match the retail game. Verify by reading the real game's finance line against
   a known lobby width.
2. **Sky lobbies.** Do sky lobbies (every ~15 floors) each incur the per-segment
   fee, or only the ground lobby? Canon almost certainly charges all lobby
   segments; confirm on the harness.
3. **Star boundary timing.** The fee jumps at the 3-star and 4-star boundaries;
   confirm it re-reads the current star each period (so demolishing down a star
   lowers the bill, and climbing raises it).
4. **Modern stance.** Owner/Samus tuning call: free, canon, or custom.

## 5. Implementation sketch (for when the gate clears)

- Seam: `GameRules.lobbyFeePerSegment(star: number): number`.
  - `CLASSIC_RULES`: 0 for star <= 2, 300 for star === 3, 1,000 for star >= 4.
  - `MODERN_RULES`: the ratified Modern stance (default 0 until decided, so
    Modern stays byte-identical).
- `EconomySystem.payMaintenance` gains one charge: sum the lobby segments (per
  the pinned segment definition) and charge `segments * feePerSegment(star)` to
  the chosen ledger line. Resolve the seam once outside the loop.
- Help/Compare copy: a Classic-vs-Modern bullet if Modern diverges (the
  `RULE_TO_HELP` guard forces the classification), same pattern as the calendar
  and rent divergences.

## 6. Test plan (for when the gate clears)

- Seam unit tests: `CLASSIC_RULES.lobbyFeePerSegment` returns 0/0/300/1000 for
  stars 1/2/3/4; Modern returns its ratified value; a bare context falls back to
  Modern.
- Integration: a 3-star Classic tower with a known lobby width pays
  `width * 300` per quarter; the same tower at 2 stars pays 0; at 4 stars pays
  `width * 1000`. The Modern twin's hash MUST NOT move unless Modern deliberately
  adopts a fee.
- Golden master: Classic re-pins (economy shift, intent comment); Modern hash
  frozen.

## 7. Gate and process

Gated on #575-grade primary verification of the fee figures AND the segment
definition (both single-lineage today). Verify on the retail game (Wine harness,
once a genuinely populated tower can be driven) or a genuinely independent
primary source, then implement through `/gds-code-review` with all four gates
green and the golden-master discipline above, plus a `package.json` version bump
(a player-facing economy change) and the Help/Compare copy. Tracked by the
backlog row `star-tiered-lobby-fees`.
