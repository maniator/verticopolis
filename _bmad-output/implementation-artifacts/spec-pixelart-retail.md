---
title: 'Pixel-art retail: eleven canon trades, each a distinct store, on the striped-awning and lit-sign anchor'
type: 'feature'
created: '2026-07-14'
status: 'done'
updated: '2026-07-15'
baseline_commit: '2edf133'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-pixel-art-overhaul.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-pixelart-people-system.md'
  - '{project-root}/_bmad-output/planning-artifacts/design/arch-pixel-art-overhaul-2026-07-14.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-retail-subtypes-and-variety.md'
  - '{project-root}/CLAUDE.md'
---

<frozen-after-approval reason="human-owned intent ratified in the art bible, the arch doc, and the E4 epic; do not modify unless a human renegotiates the retail look canon or the retail subtype ordinal">

## Intent

**Problem:** Retail is the widest cosmetic gap left in the overhaul. The engine already carries the eleven canon shop trades (`SHOP_SUBTYPES` in `retailSubtypes.ts`, shipped with the retail-subtype seam), but the render in `pixelSprites/shop.ts` under-sells them: every trade shares one striped awning with no lit sign, its interior is a thin sketch (one or two props), and its shopper or clerk is drawn at the old squat `person()` scale, so a Bank and a Flower Shop read as the same beige box at a skim. That misses two ratified pillars: one iconic silhouette per kind, and density that tells the story (3 to 5 readable props plus an occupant). The board (Figma page 04, twelve tiles) shows the target: each trade is a genuinely different store, and the reference draw code is committed at `pixelart-figma/build-scripts/page-04-retail.build.js`.

**Approach:** Enrich `shop()` so each of the eleven canon trades furnishes its own room, port tile for tile from the board build script (the pixel-exact source, per arch section 7). Every subtyped shop keeps the two anchor shapes the player names a shop by: the striped awning (already shared) and a lit sign board mounted below it (new, added on the subtyped path only). Each trade gets its own awning color, its own lit sign, its own interior composition, and its shopper or clerk at the room-occupant scale from the redesigned `person()` family (inherited from `spec-pixelart-people-system`: the 15px seated build for behind-counter staff and seated clients, the 18px standing build for open-floor clerks and browsing customers). The generic fallback for an unset or unknown subtype stays byte-stable: its shelves, goods array, math, awning, and occupant call site are untouched by this spec, so a legacy save with no subtype renders exactly as before. The closed-hours `closedShutter()` path stays byte-stable too. The retail look table is subtype-keyed with no geo axis (art bible axis map), and the subtype key list is a load-bearing TDT ordinal: this spec touches only look-table VALUES and the draw functions, never the keys or their order. Because the enriched interiors overflow the 500-line ceiling, the look table is extracted to `pixelSprites/shop.looks.ts` (re-exported through the barrel) before any enrichment lands.

## Boundaries & Constraints

**Always:**
- The eleven canon trades each render a distinct store: its own awning color, its own lit sign, its own interior, and at least one shopper or clerk at room-occupant scale. Density is 3 to 5 readable props plus the occupant.
- The two anchor shapes are preserved on every subtyped shop: the striped awning (the existing shared stripe loop) and the lit sign board below it. The lit sign is a static warm glow keyed only on `lit`, never on `d.anim` (no per-frame redraw; the cinema marquee is the only animated exception in the overhaul and this is not it).
- Occupants use the `person()` family from `spec-pixelart-people-system` at room-occupant scale (15px seated / 18px standing), never the 24px walker scale. Behind-counter and seated figures (pharmacist, bank tellers, post clerk, salon client) use the seated build; open-floor clerks and browsing customers use the standing build. Silhouettes are ink-dark, minimum 3px wide.
- Integer pixel coordinates only. Round before every `fillRect`. Each `F(A, x, y, w, h, color, opacity)` in the board script maps to `ctx.fillStyle = color; ctx.globalAlpha = opacity ?? 1; ctx.fillRect(x, y, w, h)`, scaled to the screen rect.
- Reserved colors are never reused for decoration: stress red `#C24A3A`, vacancy grays `#C9CCC4` / `#B2B0A4`, notice amber `#E8A030`, dirty tray `#D4623A`, ready lamp `#FFD86A`, closed sign `#E0556B`. The `closedShutter()` CLOSED plate keeps `#E0556B` for its sanctioned state use.
- `SHOP_LOOKS` stays keyed by the exact eleven canon names in `SHOP_SUBTYPES` order. `subtypeVisuals` asserts key-set equality against the canon list and pairwise distinctness; after enrichment all eleven entries stay pairwise-distinct and the key order stays aligned with the ordinal.
- The shop reads only bake-signature inputs: `subtype`, `lit`, `occupants`, and the `open` flag (via the closed gate), plus the deterministic `hash(u.id)`. No new `d.anim` read and no full-collection scan enter a draw routine.
- American English; no em-dashes in new prose or comments.

**Ask First:**
- Adding a field to the `ShopLook` interface (for example a distinct `sign` color). Allowed only if every one of the eleven entries gets the field in the same change; the record keys and their order stay untouched. Default is to derive the lit sign from the existing `awning` value, as the board does, so no new field is needed.
- Changing any `PAL`, `SHIRTS`, or `SKIN` entry, or introducing a `geoVariant` axis for retail. Retail is subtype-keyed with no geo axis; any optional per-unit garnish must use a NEW axis at or above 6 and hold luminance within 10 per RGB channel of its anchor.
- Reading `u.subtype` anywhere outside the render layer, or adding any input to the room bake signature.

**Never:**
- Never rename or reorder the `SHOP_LOOKS` keys, and never change the `SHOP_SUBTYPES` list or ordinal in `retailSubtypes.ts`. The TDT variant byte is an ordinal; a reorder silently corrupts every 1994 round-trip.
- Never enrich or restructure the generic fallback (`look === undefined`) branch. Its shelves, goods array, shelf math, lavender awning `#EFE9F5`, and occupant call site stay byte-stable. The generic path carries no lit sign.
- Never touch the closed-hours path: the `shop()` early return `closedShutter(d, x, y, w, h, "#b58ad6")` and the `drawRoom` business-hours gate stay byte-stable.
- No `SAVE_VERSION` bump, no `Unit` shape change, no TDT format change. This is visual-only.
- No mode branch (Classic or Modern) inside any draw routine; the art is identical in both.
- No new file over 500 lines; no new `fileSize.ratchet.txt` entry.

## I/O & Edge-Case Matrix

| Scenario | State / action | Expected behavior |
|----------|----------------|-------------------|
| Subtyped shop, open hours | `u.subtype` is a canon name, `lit`, within business hours | The trade's own awning color, a lit sign board below the awning, the trade's interior (3 to 5 props), and its shopper or clerk at room-occupant scale. |
| Any of the eleven trades | Men's Clothing, Pet Store, Flower Shop, Book Store, Drug Store, Boutique, Electronics, Bank, Hair Salon, Post Office, Sports Gear | Each is visually distinct from the other ten: a skim names the trade from its awning color plus its iconic interior silhouette. Pinned by `subtypeVisuals` distinctness. |
| Behind-counter staff | Drug Store pharmacist, Bank tellers, Post Office clerk, Hair Salon client | Drawn with the 15px seated build (head 5, torso 10, no legs), behind the counter or in the chair. |
| Open-floor figure | Browsing customer or a clerk standing in the open | Drawn with the 18px standing build (head 5, torso 9, legs 4). |
| Generic fallback | `u.subtype === undefined` (legacy or never set) | Byte-stable legacy shop: two shelves of the six-color goods, lavender awning `#EFE9F5`, the hash-gated shopkeeper, no lit sign. This spec makes no edit to the branch. |
| Unknown subtype string | `u.subtype` set to a non-canon string that slipped a whitelist | `SHOP_LOOKS[u.subtype]` is undefined, `look` resolves undefined, the generic fallback renders. No throw. |
| Closed hours | Outside `10 <= hour < 21`, or `drawRoom` business-hours gate | `closedShutter()` renders (accent `#b58ad6`), byte-stable. No interior, no lit sign. |
| Customer presence | `u.occupants > 0` or `hash(u.id) > 0.4` | The browsing customer draws (existing gate preserved). Staff clerks draw during open hours regardless, as they are staff, not population. No ghost customers beyond the existing single hash-gated figure. |
| Subtype reroll | Player runs "Change variety" and `u.subtype` changes | The bake signature carries `subtype`, so the room re-bakes to the new trade: awning color, lit sign, and interior all change. |
| Lit versus unlit | `lit` toggles | The lit sign glow and interior track `lit` only (in the signature); no per-frame animation. Unlit dims through the existing `drawRoom` night path. |
| File size after enrichment | `shop.ts` grows past 500 lines | The look table is already extracted to `shop.looks.ts`; if the interior switch still overflows, per-interior draws move to `shop.interiors.ts` with a thin dispatcher (arch section 5). No new ratchet entry. |

</frozen-after-approval>

## Code Map

Real functions and files. Render-only; no engine seam. Extract first, then enrich, then apply the person family.

### File-size prep: extract the look table (`pixelSprites/shop.looks.ts`, NEW)

- Move the `ShopLook` interface (`shop.ts:11-29`) and the `SHOP_LOOKS` record (`shop.ts:30-42`) verbatim into a new `pixelSprites/shop.looks.ts`, mirroring the `food.looks.ts` target in arch section 5 and the E1-S4 extraction. Keep the eleven keys and their order exactly as `SHOP_SUBTYPES` (`retailSubtypes.ts:26-38`).
- `shop.ts` imports `SHOP_LOOKS` and `ShopLook` from `./shop.looks` for its own use and re-exports them (`export { SHOP_LOOKS, type ShopLook } from "./shop.looks"`) so `pixelSprites.ts:97` (`export { SHOP_LOOKS, type ShopLook } from "./pixelSprites/shop"`) and the `subtypeVisuals` import (`from "../../render/pixelSprites"`) both keep resolving with no path change.
- `barrelSurface.test.ts` pins `SHOP_LOOKS` (value, line 114) and `ShopLook` (type, line 42) on the `pixelSprites` barrel; the re-export chain must keep both present.

### The shared anchor: striped awning plus lit sign (`pixelSprites/shop.ts`, `shop()`)

- The shell, accent pick, and striped-awning loop (`shop.ts:52-61`) stay as the shared prologue and render byte-identically for the generic path. Do not alter the stripe loop.
- After the `if (look === undefined) { ... return; }` generic early return (`shop.ts:62-76`), add the enriched anchor for subtyped shops only: the awning top-highlight line, the scalloped valance row, and the `awningShadow` band under it (board `awning()`, build script line 13), then the lit sign board (board `signboard()`, line 14): a small marquee in the subtype's `awning` color with a warm `glowLit` halo. Keyed on `lit`, static, no `d.anim`.

### Per-trade interiors (the eleven canon trades)

Each `case` in the `shop.ts` switch (`shop.ts:80-308`) is enriched to its board tile. The board tile function is the pixel-exact reference; port its rectangles, scaled to the screen rect, reading `look.goods` for the detail palette.

- `racks` (Men's Clothing) `shop.ts:81-99`, board `mens` (line 18): two rails of hanging garments, a folded-shirt table, a suited mannequin (hand-drawn form, not a silhouette), a tall fitting mirror, a browsing customer (standing).
- `pets` (Pet Store) `shop.ts:100-123`, board `pets` (line 23): a stack of critter cages, a glowing blue aquarium with fish, a pet-supply shelf, a customer (standing).
- `florist` (Flower Shop) `shop.ts:124-146`, board `florist` (line 28): tiered flower stands of multicolor blooms on green stems, floor buckets, a hanging fern, a wrap counter, a florist (standing).
- `books` (Book Store) `shop.ts:147-165`, board `books` (line 34): three tall bookcases of colored spines, a lit reading table with a warm `glowLit` lamp, a rolling ladder, a reader (seated).
- `pharmacy` (Drug Store) `shop.ts:166-182`, board `drug` (line 39): a dispensing counter with a white-coated pharmacist (seated, keeps the `"#F4F0E4"` tint at `shop.ts:174`), aisles of medicine bottles, a chilled fridge, a customer (standing).
- `boutique` (Boutique) `shop.ts:183-203`, board `boutique` (line 45): a spotlit dress on a form with a `glowLit` pool, a short designer rail, a tall gilt mirror, a velvet bench, a small chandelier, a browsing customer (standing).
- `screens` (Electronics) `shop.ts:204-222`, board `electronics` (line 52): a dark front, a wall of glowing demo screens (each a soft glow), a gadget counter of phones with blue accent light, a clerk (standing).
- `bank` (Bank) `shop.ts:223-248`, board `bank` (line 56): a teller counter with divider windows and seated tellers (seated build, new figures), a big round vault door, a queue rope, the brass coin (`PAL.brass`), a customer (standing).
- `salon` (Hair Salon) `shop.ts:249-268`, board `salon` (line 62): two styling stations, a stylist (standing) cutting a seated client (both new figures), the red-white barber pole, a wash basin, a product shelf.
- `post` (Post Office) `shop.ts:269-286`, board `post` (line 70): a wall of brass PO boxes, a service counter with a seated clerk and a scale, stacked parcels, a blue mail drop box, a customer (standing).
- `sports` (Sports Gear) `shop.ts:287-307`, board `sports` (line 76): a jersey on the wall, a ball bin, a rack of bats and sticks, a shoe wall, a gear mannequin, energetic orange awning.

### Occupants at room-occupant scale (inherit the `person()` family)

- The board reference draws every shop figure with one 15px room-occupant build (`person()`, build script line 10). The finalized people geometry refines this to seated (15px) for behind-counter staff and seated clients, standing (18px) for open-floor clerks and customers. Pass the correct `seated` flag at each call site; the redesigned `person()` from `spec-pixelart-people-system` supplies the geometry behind the call-compatible signature.
- The trailing customer (`shop.ts:309`, gated `u.occupants > 0 || hash(u.id) > 0.4`) is superseded or supplemented by the per-trade figures above; keep the same occupancy gate for any browsing customer so no ghost shopper appears in an idle shop.

### The generic fallback (byte-stable, do not edit)

- The `look === undefined` branch (`shop.ts:62-76`), including the six-color goods array, the two-shelf math, and `person(ctx, x + w - 9, floorY, 1.5, (u.id * 11) | 0)`, is untouched by this spec. The shared person redesign lands in the people-system spec (E1); this spec introduces no edit to the branch, so the generic render shifts only by that inherited shared-figure delta, never by a retail change.

### Tests and bookkeeping

- `src/tests/integration/subtypeVisuals.integration.test.ts`: already pins key-set equality and pairwise distinctness for `SHOP_LOOKS` and the TDT round-trip for every canon name; must stay green after the value enrichment. Add no key, remove no key.
- `src/tests/fileSize.guard.test.ts` and `src/tests/barrelSurface.test.ts`: re-verify after the `shop.looks.ts` extraction (and any `shop.interiors.ts` split); no new ratchet entry; the barrel surface (`SHOP_LOOKS`, `ShopLook`) unchanged.
- `src/render/pixelSprites/common.test.ts`: the `closedShutter` label branch stays covered; the closed path is byte-stable.
- `_bmad-output/implementation-artifacts/backlog.md`: close the E4 retail item; the `facility-visual-variety` retail portion (per-variant palette) is now shipped by this overhaul. Record any `shop.interiors.ts` split follow-up only if it does not land here.
- `package.json`: bump minor (player-facing visual capability).

## Tasks & Acceptance

**Execution (dependency order: extract, then anchor, then interiors, then figures, then bookkeeping):**
- [x] Extract `ShopLook` and `SHOP_LOOKS` to `pixelSprites/shop.looks.ts`; re-export through `shop.ts` and the `pixelSprites.ts` barrel; keep keys and order identical to `SHOP_SUBTYPES`.
- [x] Add the lit sign board plus the awning valance and `awningShadow` band on the subtyped path in `shop()`, keyed on `lit`, static (no `d.anim`); leave the shared stripe loop and the generic path byte-stable.
- [x] Enrich each of the eleven interior `case` blocks to its board tile (racks, pets, florist, books, pharmacy, boutique, screens, bank, salon, post, sports), integer coordinates, reading `look.goods`, avoiding every reserved color for decoration.
- [x] Apply the room-occupant `person()` builds at each call site (seated for behind-counter staff and seated clients; standing for open-floor clerks and customers); add the new bank teller, salon stylist and client, and other per-trade figures; keep the browsing-customer occupancy gate.
- [x] If `shop.ts` still exceeds 500 lines, split per-interior draws into `pixelSprites/shop.interiors.ts` with a thin dispatcher; no new ratchet entry.
- [x] Verify guards: `subtypeVisuals` (key-set, distinctness, round-trip), `fileSize.guard`, `barrelSurface`, `common.test.ts`.
- [x] `package.json`: bump minor; close the E4 backlog item.

**Acceptance Criteria:**
- Given a shop with a canon `subtype`, when it bakes lit within business hours, then it renders the trade's own awning color, a lit sign board below the awning, an interior of 3 to 5 props matching its board tile, and its shopper or clerk at room-occupant scale, at integer pixels.
- Given all eleven canon trades, when each renders, then all eleven `SHOP_LOOKS` entries stay pairwise-distinct and the key-set equals `SHOP_SUBTYPES` in order, so `subtypeVisuals` is green and each trade is namable at a skim.
- Given a unit with `subtype === undefined` or an unknown string, when it renders, then the generic fallback draws byte-stable (lavender awning, six-color shelves, hash-gated shopkeeper, no lit sign) and this spec introduced no edit to that branch.
- Given a shop outside business hours, when it renders, then `closedShutter()` draws byte-stable with accent `#b58ad6` and the `#E0556B` CLOSED plate, and no interior or lit sign appears.
- Given a subtype reroll, when `u.subtype` changes, then the room re-bakes through the existing `subtype` signature field to the new trade's awning, sign, and interior, with no new signature input and no `d.anim` read.
- Given the enriched interiors, when the decoration palette is checked, then no reserved color (`#C24A3A`, `#C9CCC4`, `#B2B0A4`, `#E8A030`, `#D4623A`, `#FFD86A`, `#E0556B`) appears as decoration, and any optional per-unit garnish uses a `geoVariant` axis at or above 6 within 10 per RGB channel of its anchor.
- Given the extraction, when the guards run, then `fileSize.guard` passes with no new ratchet entry, `barrelSurface` still resolves `SHOP_LOOKS` and `ShopLook`, and no file exceeds 500 lines.
- Given all four quality gates (`typecheck`, `lint`, `test`, `build`), then all are green; the e2e visual churn is limited to shop-tile pixels, and any non-art pixel move is treated as a bug.

## Design Notes

**The anchor is the shared prologue; enrichment rides after the generic early return.** `shop()` draws the shell, accent, and striped awning before it branches. Keeping that prologue and placing the lit sign, valance, and `awningShadow` band only after the `look === undefined` return is what makes the generic path byte-stable for free: the generic branch runs the identical prologue it runs today and never reaches the new code. This is cheaper and more reviewable than a flagged awning helper.

**The subtype ordinal is the load-bearing constraint, not the look values.** `SHOP_LOOKS` looks up by name, so its literal order does not change a lookup; the order matters because it mirrors `SHOP_SUBTYPES`, whose index is the TDT variant byte. This spec edits only the VALUES (colors, interior kind) and the draw functions, so the ordinal in `retailSubtypes.ts` and the `subtypeVisuals` key-set both stay intact. A value change cannot corrupt a save; a key reorder would.

**Extract before enriching, per the file-size strategy.** The eleven richer interiors plus the lit-sign anchor overflow the 500-line ceiling. Moving the look table to `shop.looks.ts` first (re-exported through the barrel) buys headroom without touching any import path, and the arch's `shop.interiors.ts` split is the reserved fallback if the switch alone still overflows. New files ship under 500 lines from the start.

**Retail is subtype-keyed, so there is no geo axis here by design.** The art bible axis map assigns retail no `geoVariant` axis (the look is chosen by `subtype`), which is why two shops of the same trade look identical on purpose (a chain reads as a chain). Any future per-unit garnish takes a fresh axis at or above 6 and holds luminance within 10 per channel, so it never disturbs the night scrim or heatmap reads.

## Verification

**Commands:**
- `npm run typecheck`: expected clean (the `shop.looks.ts` extraction and barrel re-export resolve).
- `npm run lint`: expected clean.
- `npm test`: expected all green, including `subtypeVisuals` (key-set, distinctness, TDT round-trip), `fileSize.guard`, `barrelSurface`, and `common.test.ts`.
- `npm run build`: expected succeeds.
- Visual regression (`e2e/visual.spec.ts-snapshots`) and screenshots (`docs/screenshots/**`): regenerate only via the pinned Playwright image per CLAUDE.md; the shop-tile churn is expected, any non-art pixel move is a bug.
- Deep review: `/gds-code-review` in-session (gameplay-facing render), per CLAUDE.md and arch section 9.
