---
app: minor
crate: minor
readmes: unchanged
---
## Player
- Modern: while you place a fitness club, spa or daycare, green bands mark the floors it helps, strongest nearest; a nightclub shows violet bands for the floors its noise reaches at night (#1980).
- Modern: inspecting a condo, apartment or hotel room now names the amenity helping it most, and how much happier it can be when noise, a far lobby or too few shops hold it back.
## Engine
- New `rules::Halo` and `HaloEffect`, with `GameMode::halos()`, `halo_of(kind)` and `halo_strength(halo, d, family_size)`: the Modern venues' cross-floor halos (fitness club, spa, daycare, nightclub) as one table, which a rule test holds the hourly satisfaction step to, kind by kind. Classic has none.
- The catalog's facility entries gain `halo` (effect, floors, max, capLift, feltBy, openHoursOnly, familyScaled), null for a venue with none; `CATALOG_VERSION` is 12.
- `DiagnosticFacts` gains `amenity` (the venue's kind key and its ceiling lift), and `unitFacts` gains the `amenity` (kind code) and `amenityLift` slots, so `VIEW_LAYOUT_VERSION` is 17. No conformance scenario moves; the catalog digests do.
