---
app: patch
crate: minor
---
## Player
- The regular autosave no longer stutters the game for as long on big towers: on a maxed tower the pause is about half as long, and on a large mid-game tower about a third. The compression now runs in the background.
## Engine
- New `saveBytes(appVersion, savedAtMs)`: the save JSON with `savedAt` and `appVersion` appended as its last two keys, as UTF-8 bytes, so a host can store a save without holding it as a JavaScript string. The Rust side is `Simulation::stamped_save_bytes`.
