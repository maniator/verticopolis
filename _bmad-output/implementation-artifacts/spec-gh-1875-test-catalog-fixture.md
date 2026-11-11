---
title: 'Tests read the Rust catalog from a fixture, not the TypeScript tables (#1875)'
type: 'refactor'
created: '2026-11-11'
status: 'in-review'
context: ['{project-root}/CONTRIBUTING.md']
---

## Intent

**Problem:** Every test's catalog comes from the TypeScript engine's tables (`src/engine/catalog.ts` `catalogFor`): the shared setup (`src/tests/viewWorldSetup.ts`) binds it as the fallback source and 32 files import it. Those tables go with `src/engine`, and they already differ from the shipped Rust catalog (the wedding hall is 16 by 1 there, 28 by 5 in Rust).

**Approach:** Commit the Rust engine's catalog for each mode as `src/simport/fixtures/catalog.<mode>.json`, read through `src/tests/catalogFixture.ts` (`catalogFor(mode)`, passing the binding's own shape check). The catalog is the engine's published rule table, pinned from the engine on purpose like the catalog digests: `portReads.integration.test.ts` holds each fixture to the engine's answer (`VC_UPDATE_PORT_FIXTURES=1` rewrites). The setup and the 32 importers switch to it; tests whose premise was the TypeScript hall's size use a marked catalog instead.

## Acceptance

- Given no engine package, `npm test` passes with the same coverage.
- Given the package, the fixture checks and the integration project pass.
