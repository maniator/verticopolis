---
app: none
crate: patch
---
## Engine
- Each crate release is published to crates.io as `verticopolis-engine`, and its WASM build to npm as `@verticopolis/engine` (earlier versions are `@maniator/verticopolis-engine` on GitHub Packages, which gets no new versions).
- The gameplay event catalog lives inside the crate now, at `engine-rs/src/gameplay/catalog.json`, so the packaged crate builds on its own; `gameplay::CATALOG_JSON` and the conformance lock digest are unchanged.
- The crate and npm READMEs are short pages that link the full guides on docs.verticopolis.com.
