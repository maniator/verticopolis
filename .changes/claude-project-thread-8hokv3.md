---
app: minor
crate: patch
readmes: unchanged
---
## Player
- Modern: a nightclub now disturbs homes and hotel rooms on nearby floors only while it is open (8 PM to 2 AM). It is louder then, so a condo along the club's own floor dips to Good overnight, but the club alone no longer drives that tenant out, and it no longer keeps a nearby condo from selling. A condo right beside the club, within earshot of its door, still can't hold a tenant, and the Won't lease line says so before anyone moves in.
- Modern: a fitness club, spa or daycare nearby now raises the ceiling on a room held down by noise, a far lobby or too few shops, so a gym down the hall can lift a noisy condo back to Excellent.
- Modern: the spa and the daycare no longer count as noisy neighbors for the rooms beside them, so a spa next to your hotel rooms only helps them.
- Modern: the daycare now does more for smaller families: a couple gets 40% of its bonus, up from 25%.
## Engine
- Modern satisfaction rules: the nightclub halo applies only in its open hours, with `NIGHTCLUB_NOISE_MAX` raised from 0.08 to 0.12, and the move-in gate walks its horizon hour by hour, counting the club only in its open hours; amenity halos lift a capped room's ceiling by up to `AMENITY_CAP_LIFT_MAX` (0.15); `Kind::is_quiet_venue` (spa, daycare) drops out of the same-floor noise check; the daycare's smallest-family share is 0.4. The Modern conformance scenarios and the split-tower frame-day golden move.
