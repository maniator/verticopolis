---
app: patch
crate: patch
readmes: unchanged
---
## Player
- Housekeepers now come in through the lobby before their shift and leave through it at the end, and no longer appear at the Housekeeping room or vanish at a hotel room.
- A housekeeper who finishes a room goes straight on to the nearest dirty one, and rides back to the Housekeeping room only when none is left, so a busy hotel is clean sooner in the afternoon.
## Engine
- Housekeepers are shift workers in the crowd: each crew's six walk in from the lobby two hours before the shift (and at any later hour on duty a crew is short, as after a load), by the staff route when one reaches the lobby and the passenger route when not, chain rooms on the staff route (a housekeeper who just finished a room takes the nearest dirty room their crew may take), ride home when nothing is left, and leave through the lobby when the shift ends. A housekeeper whose trip breaks stops where they stand and is sent on instead of leaving the crowd.
- Housekeepers on shift no longer count toward the crowd's 140-person sample. A housekeeper who finishes a room is sent on after the crowd chunk they finished in, from the dirty rooms read once per step; one dispatch pass per step serves those waiting at their housekeeping rooms, and the hourly pass reads the rooms fresh.
- The conformance lock moves, since housekeepers now travel in the crowd and the rooms clean at different minutes; the Classic ransom scenario now reaches its bomb threat after 376 hourly ticks.
