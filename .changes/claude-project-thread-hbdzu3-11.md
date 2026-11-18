---
app: patch
crate: none
---
## Player
- An installed copy of the game now refuses an older version's page when a rollback lands while an update installs. Before, it could store that page with the new version's files, and a cold start with no network then asked for files the update had removed (#2206).
