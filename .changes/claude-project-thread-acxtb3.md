---
app: minor
crate: minor
---
## Player
- Modern: elevators can re-tune their own schedules. Tick Auto in an elevator's Schedule window and it sets how many cars run each hour every morning at 5 AM from the traffic it measured, so a schedule never goes stale as the tower grows. Your staging floors, door time and waiting-car response stay as you set them. New Modern elevators start with Auto on; elevators in towers saved before this version start with it off. Classic is unchanged.

## Engine
- `Schedule::auto_tune` (`autoTune` in the save, one more `scheduleShaft` slot, view layout 31): at 5 AM each game day (`schedule_auto::AUTO_TUNE_HOUR`) a Modern shaft on Auto takes `auto_tune_proposal`'s rows for the hours its ring has measured; other hours, the staging and the timings stay. A Modern elevator is built with it on. A save with a shaft on Auto is version 12 and carries `elevatorLoad`, the hourly load rings, so a reload re-tunes the same. Undo steps on the shaft survive a re-tune (`Schedule::same_but_auto_rows`). The conformance lock moved for Modern scenarios only.
