# Engine hour-boundary bench

The Rust engine's tick-cost bench. It lays a ~20k-unit tower (a dense office
grid, a sparse fast food row, parking basements and standard shafts), warms
up for 30 ticks, then walks one in-game day a minute at a time and reports the
average regular tick and the 24 ticks that cross an hour boundary.

```sh
cd engine-bench
cargo run --release
```

It is the same tower and walk as the TypeScript engine's bench it replaces
(`hourCost.bench.integration.test.ts`), so the series the audit started in
July 2026 carries on. `.github/workflows/engine-bench.yml` runs it every Monday
and puts the numbers in the job summary.

Timings are report-only. Shared runners are noisy, so read the series as a
trend. The run fails only when the tower does not build as planned or the walk
does not cross all 24 hour boundaries.

The crate sits outside `engine-rs/` on purpose: every file under `engine-rs/`
is part of the engine source hash, and a bench is not a simulation input.
