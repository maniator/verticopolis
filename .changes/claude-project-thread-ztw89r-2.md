---
app: patch
crate: patch
readmes: unchanged
---
## Player
- Modern: an elevator on Auto now learns from the line waiting at its stops, so the 5 AM re-tune gives back the cars a busy shaft needs instead of cutting it again the next morning. Once the line clears, the extra cars finish their trips and park before the shaft drops back to its scheduled count, so the fleet no longer flips on and off at the edge of a full carload.
- Classic: an elevator never runs the Auto rules, even in a tower that came in with Auto ticked.
## Engine
- `sample_elevator_util` feeds the hourly demand ring with riders aboard plus the crowd's line at the shaft's stops (`crowd.shaft_lines`), so `retune_auto_schedules` sees a backlog the cars could not carry. Utilization still counts riders aboard only. Classic counts no lines, so its ring is unchanged.
- `Schedule::cars_for_backlog` keeps every car running while anyone still waits and an extra car is still out (moving or away from its home floor), so the rule no longer flips at exactly one carload. New `DispatchRules::auto_backlog`, on only where the mode has schedule assist (Modern), keeps a Classic shaft on its written rows whatever its `auto_tune` flag says.
- New rule tests in `rule_tests::auto_backlog`: a re-tune wins cars back from any cut while a line waits, a quiet Auto shaft still tunes down, and the split-tower-29 Auto shaft keeps its worst line under three carloads for a whole day (49 with the fix, 265 without).
