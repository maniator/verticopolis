---
app: patch
crate: patch
readmes: unchanged
---
## Player
- In Modern towers, a hotel room whose guest sleeps in now pays for the night at the 8 AM checkout with everyone else, so bulldozing it or losing it to a fire before the guest leaves no longer loses that night's rent.
## Engine
- `hotel_checkout` books every asleep room's rent, including the rooms Modern holds for late checkout, and `hotel_late_checkout` only turns the held rooms over, so a held room removed before 14:00 no longer drops its night's rent (#2283).
