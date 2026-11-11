---
app: patch
crate: patch
---
## Player
- Selling or bulldozing a condo that has already been sold now buys it back from its owners first, the same way an owner leaving does, so a sold condo can no longer be demolished for a refund on top of its sale price (#713).
## Engine
- `remove_facility` on a sold condo charges the household's buy-back price (`household_price` of its sale price) before the resale refund, refuses when the money cannot cover it, and logs the buy-back; unsold and gutted condos are unchanged.
