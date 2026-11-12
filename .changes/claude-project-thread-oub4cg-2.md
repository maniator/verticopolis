---
app: minor
crate: minor
---
## Player
- In Modern, each movie theater has a ticket price: Low, Normal, High or Premium (#1950). A higher price earns more for each seat and draws fewer visitors; a lower one earns less per seat and draws more. A theater that sells out can raise its price and keep its seats full, and a half-empty one does better cheaper. The theater card's "Ticket price" button steps through the four. Every theater starts at Normal, and Classic theaters have no ticket price.
## Engine
- New `economy::tickets`: `TicketPrice` (key, label, `income_mult`, `pick_mult`), `GameMode::ticket_prices()`, `ticket_price_default()` and `ticket_price(key)`, and `Simulation::set_ticket_price(id, key)`, which answers the step set or `None` for a room that is no cinema or a step the mode does not list. Modern lists `low` (0.75 of Normal's income per seat, 1.25 of its visits), `normal`, `high` (1.3, 0.75) and `premium` (1.6, 0.55); Classic lists none.
- `Extras` gains `ticket_price`, saved as `ticketPrice` on a Modern theater whose step is not Normal; a Classic save or an unknown step loads as Normal. An undo step puts a ticket price back like a film policy.
- A theater's ticket income is multiplied by its step's `income_mult`. The crowd's cinema visits are weighed by `pick_mult`: the theaters' whole share of the spawn options by their mean, and each theater's floor and seat in the venue draw by its own. A tower whose theaters all charge Normal draws exactly as before, so the conformance lock's scenarios do not move; only the catalog digests do.
- The catalog's economy gains `ticketPrices` and `ticketPriceDefault`; `CATALOG_VERSION` is 10. The port gains `setTicketPrice(id, code)` (codes from the new `ticketPrices` layout list, record slot `priceCode`), and `unitCard` gains a `ticketPrice` slot, so `VIEW_LAYOUT_VERSION` is 16. `unitDetail` reports `ticketPrice` too.
