# Decision Log: Save Latency Mitigation

- 2026-07-07: Benchmarked a 12,975-unit save-shaped payload. Synchronous DEFLATE over JSON dominated the sync path at about 70 ms average. Native `CompressionStream` over JSON averaged about 27 ms and preserves the existing schema.
- 2026-07-07: Chose async JSON compression for routine autosave, not binary save migration. Binary remains out of scope until browser-device profiling proves it is needed.
- 2026-07-07: Preserved synchronous saves for update and crash-recovery paths because those must finish before reload.
- 2026-07-07: Clarified that v3 requires an explicit `upgradeV2toV3` migration hook in the save-version chain. The first v3 migration is a compatibility stamp, with future v3 fields added behind the same hook if needed.
