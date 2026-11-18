---
app: patch
crate: patch
readmes: unchanged
---
## Player
- Modern: an elevator on Auto now puts every car to work whenever anyone is waiting at one of its stops. Before, it waited until more people stood in line than its running cars could take in one trip, so in a busy tower the morning commuters from the parking floors piled up by the hundreds in the basement while the few cars on shift came by already full.
## Engine
- Dispatch runs every car of a shaft whose schedule has `auto_tune` on while anyone waits at its stops, and the row's count while nobody does. `Schedule::cars_for_backlog` keeps its signature and follows the same rule; the car capacity, span and homes it takes are no longer read.
