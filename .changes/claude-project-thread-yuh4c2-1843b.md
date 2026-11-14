---
app: patch
crate: patch
readmes: unchanged
---

## Player

- Undo no longer refuses, and drops, taking out a lobby tile you had built back with redo, when the basement beside it went in while that tile was out.
- Undo no longer refuses, and drops, taking out lobby tiles that joined two parts of the ground floor a sale had divided, when each part still stands on its own older lobby.

## Engine

- The undo check dates a unit an undo or redo put back by its return rather than its first build (#1846), and a step that takes out ground-floor lobby tiles passes a run that reaches the root of a part those tiles joined when they went in (#1848). Both only allow undos the check used to refuse; nothing it refused before for a real reason now applies.
