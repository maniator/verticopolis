# Save Latency Mitigation Epics

## Epic 1: Async autosave compression

### Story 1.1: Background autosave compression

Given a player has an active tower, when the periodic autosave fires on a browser with native `CompressionStream("deflate-raw")`, then save compression runs through the async path and the saved tower remains loadable.

### Story 1.2: Latest-wins autosave coalescing

Given an autosave is already running, when another autosave request arrives, then the latest tower state is saved after the active write completes.

### Story 1.3: Critical synchronous flush preservation

Given the game is about to reload for an update or graphics recovery, when the save flush runs, then it still uses the synchronous durable path so the page cannot exit before the save completes.
