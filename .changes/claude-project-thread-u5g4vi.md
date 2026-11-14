---
app: none
crate: minor
readmes: unchanged
---
## Engine
- Real office commutes (`crowd::commuters`) land switched off behind `rules::REAL_OFFICE_COMMUTES_ON`, so the game plays as before. When on, Modern office workers walk in at the lobby or ride in on the Metro over 7 to 10 AM on weekdays, leave over 4 to 7 PM, and an office counts only the workers at their desks; Modern express cars move four times as fast (`GameMode::express_speed_factor`). Classic offices keep the clock's head count either way.
- `unitCard` adds a `workersComing` slot (the view layout goes to 24). It reads empty while real office commutes are off.
