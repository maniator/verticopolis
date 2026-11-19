---
app: patch
crate: patch
readmes: unchanged
---
## Player
- People and staff now run out of patience only while waiting for a car. Walking to a shaft, climbing stairs or an escalator and riding never use any of it, so a housekeeper on a long stair route no longer gives up halfway up (#2386).

## Engine
- A trip's patience (`GIVE_UP`, `STAFF_GIVE_UP`) counts only the time spent waiting for a car, in both modes, and the per-floor allowance at car speed is gone. A person's `age` is now that waiting time from the trip's start, and the give-up check runs only in the `Waiting` state (#2386).
