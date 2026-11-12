---
app: minor
crate: minor
readmes: unchanged
---
## Player
- In Modern, homes now need parking from three stars (#1973): one space for every 2 occupied condos, 3 apartments or 6 studios. Classic condos still need none, as in the original game.
- In Modern, a working Metro station halves the parking offices and homes need. Hotel suites still need a space each.
- In Modern, offices and homes share the spaces the hotel suites leave, lowest floors first. A home without parking is held at Good and never leaves over it, and while parking covers under half of what offices and homes need, homes fill and condos sell at half the usual pace. The stats screen counts homes in its parking demand and, while parking falls short, shows how much of the need is covered, and the room inspector names the shortfall and how much of the need is covered.
## Engine
- New `services::parking`: `ParkingDemand` gains `homes` and `shared_need`, Modern counts tenanted homes by household share (`CONDOS_PER_SPACE`, `APARTMENTS_PER_SPACE`, `STUDIOS_PER_SPACE`) and applies `METRO_PARKING_SHARE` to offices and homes, and `parking_move_in_reading()` answers the office and home move-in factors from one garage flood.
- `ServiceShortfalls` allocates Modern parking across offices and homes together; `parking_coverage()` and `parking_for()` replace the office-only reads. New gripe and vacate cause `homeParking` (never sinks, never empties a home), appended to the port's `vacateReasons`, and `statsSheet` gains `parkingHomes` after `parkingSuites` and `parkingCoverage` (NaN while parking is not short) after `parkingTotal`, as `statsReport`'s `parkingDemand` gains `homes` and `coverage`, so `VIEW_LAYOUT_VERSION` is 18. Mode choices are named rules on `GameMode`: `homes_need_parking` and `metro_eases_parking`.
- The conformance lock moves for the Modern scenarios whose towers have homes at three stars or more without enough parking. The five Modern fire and ransom scenarios now tick 208 hours (not 256) to their offer, which arrives sooner now, and the smoke Modern fuzz golden follows.
