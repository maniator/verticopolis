---
app: patch
crate: patch
readmes: unchanged
---

## Player

- Nobody vanishes on the way anymore. Someone who waits too long for their first elevator walks back the way they came and leaves from there, and anyone already partway up the tower, or on the way home, keeps going until they get there.

## Engine

- Patience no longer removes a visitor or tenant from the crowd. One still on the floor their trip began on turns back (`motion::turn_back`) to where they set out (`Person::start_x`, engine-internal) and leaves there; one past their first ride, or returning, keeps waiting. Housekeepers keep their own rule. The conformance lock, frame days, port edits and fuzz goldens are re-pinned, and the Classic ransom scenario's first threat moved to hour 40.
