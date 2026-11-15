---
app: patch
crate: patch
---
## Player
- Housekeeping's morning report counts every room cleaned the day before, even when you reloaded the tower mid-day, and the stats screen keeps yesterday's shift through a reload. A housekeeping warning shown once today stays quiet after a reload. Right after a reload, people no longer wait for an elevator car the schedule has taken out of service.
## Engine
- A save carries the housekeeping tallies (`housekeeping`: `cleanedToday`, `yesterday` as cleaned and left dirty, and `nudgedDay` and `commuteNudgedDay`, the days the "can't reach" and "can't get in" nudges last fired), written only once there is something to keep. Older saves load with fresh tallies as before, and older builds ignore the key. The conformance state hash and the `.TDT` export leave it out.
- The crowd's save carries the elevator cars the schedule has stood down (`closedCars`, written only when there are some), so the router's first routes after a load skip them as the unbroken game's would (#2229).
- An office loads with no more workers at their desks than it holds, and a save's commuter desks are capped the same way, so a hand-edited head count cannot send extra workers home (#2230). A load keeps the desks of offices that are gone only while their workers fit under the people a save may hold (10,000), so a forged save cannot walk tens of thousands of workers out in one pass.
