---
app: patch
crate: minor
---
## Player
- On Modern's real-world calendar, offices, clinics and fitness clubs now pay a third of their quarterly rent every month, on the same day as the monthly bills. A new tower no longer waits 90 days for its first rent while the overhead drains its cash, and the office line in Stats stops sliding between quarters (#2255). Classic and Modern's short 1994 calendar are unchanged.
## Engine
- Modern collects lease rent (offices, clinics, fitness clubs) every maintenance period, scaled to that period's share of a real-world quarter; Classic still collects it each quarter. On the real-world calendar the bulletin line reads "Monthly office rent collected" (#2255).
- Each catalog calendar publishes `leasePeriodDays`, the days between two lease collections, and its `quarterlyRentScale` is now the share one collection pays; catalog version 20.
## Contributors
- ibiller reported Modern's slow first rent and the sliding office income, with their tower attached (#2255).
