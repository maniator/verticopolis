# @verticopolis/engine

The [Verticopolis](https://verticopolis.com) simulation engine, compiled to
WebAssembly: every rule, price, cap, command, save format and gameplay event
of the tower game, with builds for Node (`node/`) and the browser (`web/`).
Your code draws the tower and handles input; the engine runs it.

## Install

```sh
npm install @verticopolis/engine
```

```js
const { Engine } = require("@verticopolis/engine");

const engine = Engine.newGame(42, "classic");
for (let minute = 0; minute < 60; minute++) engine.tick(1); // one game hour
console.log(engine.money());
engine.free();
```

## Documentation

The full guide lives on the engine docs site,
[docs.verticopolis.com](https://docs.verticopolis.com):

- [JavaScript package](https://docs.verticopolis.com/javascript/): install,
  the Node and browser quick starts, every call, saves and versioning.
- [Host API guide](https://docs.verticopolis.com/api/) and the
  [Rust crate](https://docs.verticopolis.com/crate/)
  ([`verticopolis-engine`](https://crates.io/crates/verticopolis-engine) on
  crates.io), for a host written in Rust.
- [Conformance suite](https://docs.verticopolis.com/conformance/): how a host
  proves it runs the real simulation.
- [Changelog](./CHANGELOG.md), one section per engine version.

The source is in
[`engine-rs/`](https://github.com/maniator/verticopolis/tree/main/engine-rs)
of the [Verticopolis repository](https://github.com/maniator/verticopolis).

## License

MIT. See [`LICENSE`](./LICENSE). The licenses of the Rust crates compiled
into the WebAssembly are in `web/THIRD-PARTY.json`.
