# Decision Log: Save Latency Mitigation

- 2026-07-07: Benchmarked a 12,975-unit save-shaped payload. Synchronous DEFLATE over JSON dominated the sync path at about 70 ms average. Native `CompressionStream` over JSON averaged about 27 ms and preserves the existing schema.
- 2026-07-07: Chose async JSON compression for routine autosave, not binary save migration. Binary remains out of scope until browser-device profiling proves it is needed.
- 2026-07-07: Preserved synchronous saves for update and crash-recovery paths because those must finish before reload.
- 2026-07-07: Clarified that v3 requires an explicit `upgradeV2toV3` migration hook in the save-version chain. The first v3 migration is a compatibility stamp, with future v3 fields added behind the same hook if needed.
- 2026-07-07: Renamed the autosave key to `verticopolis-save` with a legacy `simtower-clone-save` fallback so older saves still load and future writes move to the app-named key.
- 2026-07-08: Re-benchmarked on the player's real 12,975-unit save (towerone_6.vctower, also the reflow golden fixture). A hand-rolled schema stringifier of the same shape measured SLOWER than JSON.stringify (10.48 ms vs 7.10 ms): the cost is the bytes, not the stringifier. Rejected.
- 2026-07-08: Adopted sparse v3 units: serialize() omits unit fields sitting at the deserialize fallbacks (state "empty", satisfaction 1, occupants 0, everOccupied false, pendingIncome 0, catalog-name label). JSON drops to 33% (2.09 MB to 692 KB) with zero round-trip mismatches; the v3 stamp added earlier now marks this shape.
- 2026-07-08: Width carve-out (party ruling): rooms always persist their width because catalog widths are tuning that has drifted before (the v1 to v2 reflow exists for that reason); omitting width at catalog-default would silently re-lay rooms on a future catalog change. Only width-1 floor/lobby tiles omit width.
- 2026-07-08: Synchronous writer dropped to deflate level 1. On sparse payloads it costs 0.8% size for roughly 3x speed (87,227 vs 86,555 bytes; 7.3 ms vs 21.2 ms); on the old full shape it would have cost 12.7%, which is why it was never viable before. End-to-end sync flush: 48.3 ms to 16.4 ms, stored slot 132 KB to 116 KB.
- 2026-07-08: Binary codec stays out of scope (reaffirmed); feature-detected Uint8Array.prototype.toBase64 deferred to the backlog as a micro-win.
