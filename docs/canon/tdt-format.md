# Canon reference: the original SimTower `.TDT` save format

**Provenance.** The facts below are derived from the OpenSkyscraper project's
reverse-engineering notes (`doc/simtower/TDT_format.txt` in
[fabianschuiki/OpenSkyscraper](https://github.com/fabianschuiki/OpenSkyscraper),
GPL-3.0). This file **restates the factual layout in our own words** — no GPL
text or code is copied. Facts about a file format are not copyrightable; the
original prose is, so keep it that way when editing this page.

**Why this exists.** The `.TDT` save is a window into the 1994 original's
internals — it confirms (or corrects) numbers our engine treats as canon, and it
is the specification for a future importer of original saves
(`src/storage/twrImport.ts` is today a stub; see PARITY.md). `src/tests/canon.test.ts`
asserts our engine constants against this page so drift gets caught in CI.

**Reliability.** The upstream notes were derived from a single Windows version
of the game. Everything is little-endian. Structures after the floor map are
variable-width, so absolute offsets only hold through the header. Fields the
notes marked "unconfirmed" are flagged below.

---

## 1. Header (fixed offsets)

| Offset | Size | Field | Meaning |
| --- | --- | --- | --- |
| 0x00 | u16 | version | `0x2400` in known saves — usable as a magic number |
| 0x02 | u16 | level | 1–5 = star rating; **6 = TOWER** |
| 0x04 | i32 | balance | Current funds, in stored units (see §2) |
| 0x08 | i32 | otherIncome | Finance-window line |
| 0x0C | i32 | constructionCosts | Finance-window line |
| 0x10 | i32 | lastQuarterMoney | Finance-window line |
| 0x14 | u16 | frameTime | Time of day in frames, 0–2599 (see §3) |
| 0x16 | i32 | currentDay | Days since "WD 1 / 1Q / Year 1" (signed!) |
| 0x1A… | — | misc | Screen position words at 0x26/0x28; rest of a ~518-byte block undocumented |

The first floor record begins at about `0x9C4`.

## 2. Money scale

The game **displays 100× the stored value** (everywhere except the finance
window). A stored balance of `20000` renders as `$2,000,000` — which matches our
`ECON.startingMoney` of 2,000,000 display-dollars. Any importer must multiply
stored amounts by 100; our engine keeps display-dollars and must never adopt the
×100 storage quirk itself.

## 3. Time system

One day is **2,600 frames**, starting at 7:00 AM. Wall-clock seconds per frame
vary by period — the in-game clock **crawls through lunch and races through the
night** (the original's signature rhythm):

| Frames | In-game span | Hours covered | Notes |
| --- | --- | --- | --- |
| 0–400 | 7:00–12:00 | 5h | slow frames |
| 400–800 | 12:00–12:30 | 0.5h | lunch crush — clock ~10× slower than the morning |
| 800–1200 | 12:30–13:00 | 0.5h | lunch crush continues |
| 1200–1600 | 13:00–17:00 | 4h | |
| 1600–2000 | 17:00–21:00 | 4h | |
| 2000–2400 | 21:00–1:00 | 4h | |
| 2400–2600 | 1:00–7:00 | 6h | night flies by |

- **The date changes at frame 2300** — i.e. midnight lands at frame 2300, which
  the span table above reproduces exactly (2000 + 3h × 100 frames/h = 2300).
  Treat *frame 2300 = midnight* as the anchor when deriving rates.
- **Known inconsistency:** the upstream notes give per-frame durations whose
  night row (200 frames × 126 s = 7 h) contradicts the 6-hour 1:00–7:00 span.
  We derive per-frame rates from the **spans** (ground truth) and ignore the
  contradictory per-frame second values.
- `src/engine/timePacing.ts` implements this table as a presentation-layer
  pacing curve; the simulation itself stays on a uniform 1,440-minute day.

## 4. Floors

**120 floor slots**, index 0–119:

| TDT index | Meaning | Verticopolis floor |
| --- | --- | --- |
| 0–9 | B10 … B1 | −9 … 0 |
| 10 | Ground (1F) | 1 |
| 11–109 | 2F … 100F | 2 … 100 |
| 110–119 | see note | — (not buildable here) |

Each floor record: `u16 tenantCount`, `u16 leftEdge`, `u16 rightEdge`, then
`tenantCount` × 18-byte tenant records, then a 94-entry `u16` index map into the
tenant array. Tenant record fields: left/right extents (**8-pixel units — one
unit = one of the original's segments = one of our tiles**; half-open range),
`i8` type (negative ⇒ under construction), `u8` status/occupant count, a
per-type data index, a `u32` people offset, index-in-floor, a rent-class byte,
and a few undocumented bytes.

> **Ambiguity:** the upstream notes state both "index 110 = floor 100" and
> "index 10 = 1F", which cannot both hold under a uniform offset (10 → 1 gives
> 109 → 100). We adopt the uniform `ours = tdt − 9` mapping and treat indexes
> ≥ 110 as bonus/padding rows to clamp-or-drop with a report; revisit against a
> real save. (Backlog: TDT-110 ambiguity.)

## 5. Tenant type IDs

| ID | Original tenant | Our `FacilityKind` (importer mapping) |
| --- | --- | --- |
| 0 | Floor | `floor` (structural pave) |
| 3 | Hotel single (unconfirmed) | `hotelSingle` |
| 4 | Hotel twin (unconfirmed) | `hotelDouble` (lossy name) |
| 5 | Hotel suite (unconfirmed) | `hotelSuite` |
| 6 | Restaurant (unconfirmed) | `restaurant` |
| 7 | Office | `office` |
| 9 | Condo | `condo` |
| 10 | Retail shop (unconfirmed) | `shop` |
| 11 | Parking space (unconfirmed) | `parking` |
| 12 | Fast food | `fastFood` |
| 13 | Medical center (unconfirmed) | `medical` |
| 14 | Security (unconfirmed) | `security` |
| 15 | Housekeeping (unconfirmed) | `housekeeping` |
| 17 | SECOM — a **cut feature** (string table only) | `security` (approximate) |
| 18 / 34 | Movie theater (two IDs; which is used is unconfirmed) | `cinema` |
| 20 | Recycling center (unconfirmed) | `recycling` |
| 24 | Lobby | `lobby` |
| 29 | Party hall (unconfirmed) | `partyHall` |
| 31 | Metro | `metro` |
| 36 | Cathedral | `weddingHall` (deliberate divergence — see PARITY.md) |
| 42 | "Structures" (string table only) | — |
| 45 | Parking ramp (unconfirmed) | `parkingRamp` |
| 48 | Burned area (unconfirmed) | cleared floor (report) |

## 6. People

A `u32` count, then per-person records: home floor + tenant index, number
within the tenant, tenant type, a status byte, current floor (`i8`, negative ⇒
outside the building), and — notably — a **`u16` stress** and **`u16` eval**
per person. Known per-tenant populations: **condo = 3, office = 6**, fast food
= 48 (**workers + customers** — never a census figure; our census counts
occupants only).

## 7. Retail subtype table

A fixed **512-slot** table (18 bytes each; negative floor ⇒ empty slot) assigns
each retail-family tenant a named subtype:

- **Restaurants (type 6):** English Pub, French Restaurant, Chinese Restaurant,
  Sushi Bar, Steak House.
- **Fast food (type 12):** Japanese Soba, Chinese Cafe, Hamburger Stand,
  Ice Cream, Coffee Shop.
- **Shops (type 10):** Men's Clothing, Pet Store, Flower Shop, Book Store,
  Drug Store, Boutique, Electronics, Bank, Hair Salon, Post Office, Sports Gear.

The 512-slot fixed table is a file-format artifact — the subtype *names* are
the canon we care about.

## 8. Transport pools

- **Elevators:** a variable-width block of **~24 elements** — confirming the
  single 24-shaft pool shared by standard + service + express
  (`POOLED_CAPS` in `src/engine/facilities.ts`). Element size depends on car
  count and floors; the interior layout is only partially documented (why the
  importer's v1 synthesizes transports instead of decoding them).
- **Stairs/escalators:** a fixed **64-entry** table (10 bytes each: present
  flag, type 0 = escalator / 1 = stairs, position, base floor) — confirming the
  shared 64-link walkway pool.

## 9. Finance block

After the elevator block (offset varies): per-category `i32` arrays —
population, income, and maintenance — each with a tower total.

- **10 income categories:** Office, Single Room, Twin Room, Hotel Suite, Shops,
  Fast Food, Restaurant, Party Hall, Theater, Condo.
- **10 maintenance categories:** Lobby, Elevator, Express Elevator, Service
  Elevator, Escalator, Parking Ramp, Recycling Center, Metro Station,
  Housekeeping, Security.

## 10. Named tenants

At the end of the file: 16-byte fields holding null-terminated names,
**max 15 characters** (the original let players name certain tenants). The
name↔tenant linking mechanism is undocumented.

## 11. Caveats for the importer

- The original game barely validates its own saves — treat every count and
  offset as hostile input (size ceilings, caps before loops, typed errors).
- `currentDay` is signed; negative and overflow values are representable.
- Mac-version byte order is unknown; assume Windows little-endian only.
- Everything after the floor map floats — walk, don't seek.
