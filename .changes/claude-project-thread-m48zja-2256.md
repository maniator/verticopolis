---
app: patch
crate: patch
---
## Player
- The evening "New tenants:" report counts everyone who moved in that day, even when you reloaded the tower mid-day.
## Engine
- A save carries the day's move-ins so far (`moveIns`: `offices`, `condos`, `rooms`, `fitness`, `clinic` and `rentals`, each written only above zero, and the key only when one is), so the day's report after a reload matches the unbroken game's (#2256). Older saves load with the counts at zero as before, and older builds ignore the key. The conformance state hash and the `.TDT` export leave it out; the lock moved only for the two fixtures whose scenarios reload, where the report line now appears as it would unbroken.
