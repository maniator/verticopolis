---
app: patch
crate: patch
readmes: unchanged
---
## Player
- Modern: an elevator on Auto no longer leaves a crowd waiting while its cars sit parked. When more people wait at its stops than its running cars can take in one trip, it puts every car back to work until the line clears. Before, a shaft Auto had cut to one car could never earn its cars back, and lines of a hundred or more built up at its lobbies.
## Engine
- Dispatch runs every car of a shaft whose schedule has `auto_tune` on while the crowd waiting at its stops is more than its on-shift cars hold (`Schedule::cars_for_backlog`). A schedule with Auto off keeps its rows as written.
