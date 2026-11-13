# verticopolis-engine

The simulation engine of [Verticopolis](https://verticopolis.com), a tower
building game inspired by SimTower (1994). This crate is the whole
simulation: every rule, price, build cap, command, save format and gameplay
event. It is the same engine the web game runs, compiled to WebAssembly
there and linked as a plain Rust library here. Your code owns what a player
sees and hears; the engine owns what happens in the tower.

## Add it

```sh
cargo add verticopolis-engine
```

The crate needs the Rust release named by `rust-version` in its `Cargo.toml`
and nothing else: no Node.js, no build script, no system library.

## Documentation

The full guide lives on the engine docs site,
[docs.verticopolis.com](https://docs.verticopolis.com):

- [Rust crate](https://docs.verticopolis.com/crate/): a quick start, how the
  engine works, features, saves and versioning.
- [Host API guide](https://docs.verticopolis.com/api/): every call a Rust
  frontend makes.
- [Rust API reference](https://docs.verticopolis.com/rust/verticopolis_engine/).
- [Conformance suite](https://docs.verticopolis.com/conformance/): how a host
  proves it runs the real simulation.
- [JavaScript package](https://docs.verticopolis.com/javascript/): the same
  engine as WebAssembly,
  [`@verticopolis/engine`](https://www.npmjs.com/package/@verticopolis/engine)
  on npm.
- [Changelog](https://github.com/maniator/verticopolis/blob/main/engine-rs/CHANGELOG.md).

## License

MIT.
