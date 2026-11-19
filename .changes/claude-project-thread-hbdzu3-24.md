---
app: patch
crate: patch
readmes: unchanged
---
## Player
- Undo and Redo keep the room or elevator you have open, and its card, unless the step took it away, and a step that only puts back a name or a rent is quicker on a large tower (#1802).

## Engine
- An undo or redo step keeps the port's generation, since it is the same tower: hosts follow it from the frame as they follow an edit. A step that puts back only a room's rent, name, No Rate, films or ticket price raises no tower revision, as those edits raise none going forward, and a step that takes rooms out and puts others back walks the unit list's tail once instead of twice (#1802).
