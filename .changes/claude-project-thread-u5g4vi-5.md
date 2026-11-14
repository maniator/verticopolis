---
app: patch
crate: patch
readmes: unchanged
---

## Player

- Nobody vanishes on the way anymore. Someone who waits too long for their first elevator walks back the way they came and leaves from there, and anyone already partway up the tower, or on the way home, keeps going until they get there. People waiting for an elevator or stairs you bulldoze find another way up, or walk back out if they had only just set out.

## Engine

- Patience no longer removes a visitor or tenant from the crowd. One still on the floor their trip began on turns back (`motion::turn_back`) to where they set out (`Person::start_x`, engine-internal) and leaves there; one past their first ride, or returning, keeps waiting. A shaft that goes from under someone on foot sends them back the same way if they are still setting out, or on by a new route to their trip's last floor (`motion::reroute`); only a rider whose car went, or someone with no way on, leaves the crowd. Housekeepers keep their own rule. The conformance lock, frame days, port edits and fuzz goldens are re-pinned, and the Classic ransom scenario's first threat moved to hour 40.
