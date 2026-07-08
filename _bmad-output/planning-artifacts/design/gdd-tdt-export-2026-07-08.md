# Export to SimTower (1994) — .vctower → .TDT — Design Spec
**Verticopolis** · Game design (GDS) · grounded in shipped source (`src/storage/tdtFormat.ts`, `src/storage/tdtImport.ts`, `src/ui/UI.ts`, `docs/canon/tdt-format.md`)

status: ready-for-dev

> **Source-truth callouts (verified, not assumed):**
> - The importer shipped in v1.10.0 (PR #153). `src/storage/tdtFormat.ts` holds
>   every layout constant the writer needs (`TDT_HEADER_SIZE` 0x230, 18-byte
>   tenant records, 194-byte elevator headers, 10-byte stair records, block
>   sizes for finance/parking/retail); `docs/canon/tdt-format.md` v2 is the
>   binary layout's single source of truth.
> - `src/storage/tdtImport.ts` already encodes both directions of every
>   semantic mapping (tenant-ID tables, part families, floors `ours = tdt − 9`,
>   money ×100, hotel status flags, rent classes). The exporter inverts these
>   tables; it must import them from one shared module, never re-derive them.
> - `frameForMinuteOfDay` exists in `src/engine/timePacing.ts` (canon tripwire:
>   `frameForMinuteOfDay(0) === 2300`), so the clock maps back without new math.
> - The export UI is two-step today: `#btn-export` → `confirmExport()` modal →
>   `onExport()` → `SaveGame.export` → `UI.downloadFile(filename, contents)`
>   (`UI.ts:795`–`806`). `downloadFile` types `contents: string`; a binary
>   `.TDT` needs it widened to `string | Uint8Array` (Blob accepts both).
> - A working .vctower → TDT serializer was proven in-session during the
>   round-trip verification of PR #153 (all 7 player towers survived
>   .vctower → TDT → .vctower with 100% room geometry/state fidelity). This
>   spec productionizes that scratch work.

---

## 1. Player fantasy and why

You built a tower in Verticopolis; now you carry the save back to the real
1994 game and watch the same tower run on period hardware (or an emulator).
This is the parity pillar pointed the other way: the importer proves we can
read 1994; the exporter proves our model IS 1994's model, byte-compatible.
It also gives the project its first true ground-truth test loop: an exported
file either loads in the real game or it doesn't.

## 2. Traceability

- **Pillar: gameplay parity with SimTower 1994.** A tower that can round-trip
  into the original's own save format is the strongest parity statement the
  project can make.
- **Pillar: honesty with the player.** Import ships a fidelity report; export
  ships the mirror image, saying up front what 1994 cannot represent.
- **Core loop served:** build → save → share/continue anywhere, now including
  the original game.

## 3. UI entry and flow (player-facing)

- The existing "Export tower?" confirm dialog (`confirmExport`) gains a second
  choice. Layout: keep the primary **Export** (`.vctower`, unchanged) and add a
  secondary button **"For SimTower (1994)…"**. One primary per dialog stands
  (design-system rule); the TDT path is the secondary.
- Choosing "For SimTower (1994)…" opens the **reverse fidelity modal** (same
  `openModal` chrome as the import report): facts up top (tower name, star,
  funds after rounding, floors), then two lists:
  - **"Comes along"** — rooms and their occupancy/hotel states, transports with
    per-floor stop settings, funds, the clock, your star rating.
  - **"Stays behind"** — custom room names; the income ledger and finance
    history; exact rents (snapped to 1994's four classes); cents-level money
    (rounded to $100 steps); people in transit (the crowd re-simulates);
    satisfaction detail.
- Primary action **"Download .TDT"**, secondary Cancel. Nothing is serialized
  until the primary is clicked (same two-step contract as the .vctower path).
- **Modern-mode towers are refused**, not clamped: the modal is replaced by a
  plain refusal ("This tower uses Modern rules. SimTower (1994) can only load
  Classic towers."). Silent de-scoping a player's Modern tower into a broken
  Classic file would violate the honesty pillar.
- Filename: `<TowerName>.TDT` via the existing `exportFilename` convention
  (sanitized, upper-cased 8.3-friendly stem preferred: `TOWER1.TDT` style is
  what the real game expects on period filesystems; keep ≤8 chars + `.TDT`).

## 4. Mapping spec (writer = inverse of the importer)

All tables live in one shared module so reader and writer cannot drift.

- **Header:** magic `0x2400`; `level` = star (TOWER = 6); `balance` =
  `round(money / 100)` (signed; negatives survive); `frameTime` =
  `frameForMinuteOfDay(minutes % 1440)`; `currentDay` = `floor(minutes / 1440)`.
  Undocumented header bytes: zero-filled (flagged as a real-game validation
  risk, §7).
- **Floor map:** 120 records, `tdt = ours + 9`; reserved rows 110–119 written
  empty. Per-floor built extents from the tower's paved structure. Tenants:
  inverse `TENANT_KIND` (security exports as 14, never 17/SECOM;
  hotelDouble → 4 accepts the twin approximation as-is), rent → nearest of the
  four classes, hotel states → status flags (dirty → 32, asleep → 16 +
  occupant count in bits 0–1, occupied office/condo → nonzero status),
  under-construction → negative type.
- **Multi-story units split back into parts:** cinema → 18/19 (+34/35 screens
  at original widths), recycling → 20/21, party hall → 29/30, metro →
  31/32/33, wedding hall → cathedral parts 36–40 stacked down from floor 100.
  Parking ramp → 44.
- **Transports:** elevator table from our shafts (kind → type 0/1/2, x,
  extents +9, car count, car home floors, `skipFloors` inverted into the
  120-byte serviced map); stairs table from walkway flights, collapsing
  exact-footprint stacks into the original's 2- and 3-story variants where
  they fit, else consecutive 1-story records.
- **Blocks we don't simulate, written as valid defaults:** people count 0;
  retail table all-empty (0xFF); finance block zeroed; parking block's
  connected count from ramp-chained stalls; elevator live-state payloads
  zeroed at documented sizes.

## 5. Acceptance (tests)

- **Round-trip through our own parser:** for a representative built tower,
  export → `parseTDT` → compare: identical room geometry, kinds, states,
  occupancy flags, transports (extents, cars, skipFloors), money (±$100
  quantum), star, clock minute. Property: `import(export(t))` is stable
  (exporting the re-import yields byte-identical TDT).
- **Refusals:** modern-mode tower → refusal modal, no download; empty tower →
  valid minimal file.
- **Hostile-input immunity inherited:** every exported file must pass the
  importer's load-bearing checks with zero warnings (a warning on our own
  output is a writer bug).
- **UI:** two-step contract (nothing serialized before the primary click);
  reverse fidelity modal lists pinned; binary download path (`Uint8Array`)
  produces a Blob download.

## 6. Out of scope (v1)

- Writing people records, finance history, retail subtypes, or elevator
  schedule blocks (mirrors the importer's recorded deferrals).
- Any in-app emulator integration.
- Guaranteeing the real game loads the file (see §7): v1's bar is
  self-consistency through our own parser plus canon-doc conformance.

## 7. Follow-up: real-game validation (recorded risk)

The fixture-circularity limitation recorded in the backlog (`tdt-importer`
row) applies doubly to a writer: our parser accepting our own output proves
consistency, not 1994-compatibility. The owner has the original CD; the plan
is to image it once and run SimTower under DOSBox-X/86Box (or v86 in-browser),
then: (a) load an exported `.TDT` in the real game, (b) save from the real
game and import it here. Findings feed a patch release. The game binaries and
real save bytes never enter the repo (clean-room policy).

## 8. Epic summary

| # | Story | Notes |
|---|-------|-------|
| 1 | Shared mapping module + `tdtExport.ts` writer | invert importer tables; layout constants from `tdtFormat.ts` |
| 2 | Round-trip + refusal + hostile-immunity tests | synthetic fixtures only |
| 3 | UI: export choice, reverse fidelity modal, binary download | widen `downloadFile` |
| 4 | Docs + version | PARITY.md row, backlog row, minor bump |
| 5 | (follow-up, no code) real-game validation protocol | emulator, owner-run |
