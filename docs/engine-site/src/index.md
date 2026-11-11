# Verticopolis engine

The simulation engine of [Verticopolis](https://verticopolis.com), a tower
building game inspired by SimTower (1994). One engine runs everywhere: the
web game runs it as WebAssembly, and any other host can run it as a Rust
crate or a JavaScript package. Your code owns what a player sees and hears;
the engine owns what happens in the tower.

These pages are built from the engine release named in the title.

- **[JavaScript package](javascript.md):** `@maniator/verticopolis-engine`,
  the WebAssembly build for Node and the browser.
- **[Rust crate](rust.md):** `verticopolis-engine`, for a native host.
- **[Host API guide](api.md):** every call a frontend makes, the
  conformance harness and the build metadata.
- **[Rust API reference](rust/verticopolis_engine/index.html):** the crate's
  generated documentation.
- **[Conformance suite](conformance.md):** the scripted games every engine
  build must replay exactly.
- **[Engine changelog](changelog.md):** what changed in each engine release.

The source is in
[maniator/verticopolis](https://github.com/maniator/verticopolis), under
`engine-rs/`.
