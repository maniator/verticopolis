---
app: patch
crate: patch
readmes: unchanged
---

## Player

- People no longer stay in a cinema, party hall, restaurant or other venue after it closes. When it closes, everyone inside heads home through the building, and nobody sets out for a film or a party in its last hour, so a cinema is empty once the midnight show lets out.

## Engine

- A venue's visitors keep its opening hours (`Kind::is_open_at`): a dweller leaves when its venue closes, a visitor who arrives after closing turns back, and meal trips and venue visits start only while the venue is open, and for an attendance venue only while it is still open next hour (`crowd::spawn::open_for_visits`). The step passes its clock hour to the crowd (`Crowd::hour`). The conformance lock, frame days, port edits and fuzz goldens are re-pinned, and the Classic ransom scenario's first threat moved to hour 664.
