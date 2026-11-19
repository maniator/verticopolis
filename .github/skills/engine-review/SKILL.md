---
name: engine-review
description: 'Review guidance for a pull request that touches the save loaders (src/storage), the TDT import and export, the engine version the game pins (package.json), or code that drives the engine through its port: what to check in the game and where the simulation itself is reviewed. Use when any of those paths changes.'
---

# Engine review

Verticopolis runs one simulation: the Rust engine, built and published from
[Verticopolis/engine](https://github.com/Verticopolis/engine) as the
`@verticopolis/engine` package. The game pins a version in `package.json` and
runs that version's bytes. Frontends may differ; simulations may not. A
change to a simulation rule, the conformance lock, the loader table or the
canon caps is an engine pull request and is reviewed there, with that
repository's checklist. This skill is the checklist for the game's side: its
saves, its TDT files and the engine version it runs. It sits beside the repo's
review method (`gds-code-review` for engine-data work, `bmad-code-review` for
plumbing); it does not replace it.

## What to check, in order

1. **An engine bump says what moved.** A change to the
   `@verticopolis/engine` version in `package.json` names the engine release
   and what changed in it. One pin covers the player build, the tooling
   build (`tooling/`) and the conformance suite (`conformance/`). A bump that moves a conformance hash or a save
   field needs the matching game change in the same pull request (a refusal
   code, a card line, a fixture).
2. **Old saves keep loading.** A change to how the game reads, writes,
   compresses or migrates a save (`src/storage/`) needs a test that loads a
   save written before it, and a real old-format file where one exists. No
   lost saves is a release blocker.
3. **TDT import and export are engine-data fidelity.** `src/storage/tdt*`
   hands 1994 tower bytes to the engine's TDT codec and back. Treat a change
   there as engine work (the `gds-code-review` lens), checked against the
   real 1994 saves in `@verticopolis/engine/conformance`.
4. **The game asks the engine; it never decides.** Code that drives the
   engine through its port reads answers and sends commands. A rule, a cap, a
   price or a tuning value copied into TypeScript is a finding: it belongs in
   the engine and reaches the game through the catalog.
5. **Hot paths keep their cost down.** Apply
    [`docs/performance/hot-path-review.md`](../../../docs/performance/hot-path-review.md)
    (HP-1 to HP-12). Print its record table when the diff touches a hot-path
    surface (its section 1), or one line saying it does not. Two items matter
    most here. HP-8: a port or rewrite lists the caches, indexes and counters
    the old code kept for the function and its callees, and carries each one over
    or names the Rust structure that answers the same query at the same cost
    or less. Anything else is a dropped cache, which is always `patch`, and a
    reason in the PR or a comment in the port does not close it. Outside a
    port the same holds: a change that removes or bypasses a cache, index or
    counter is always `patch`, apart from the two removals HP-8 allows (an
    equivalent named in the record, or the query itself gone). HP-7: ported,
    rewritten and moved code is reviewed as new, so "the old code did the
    same" does not close a finding. An optimization must leave the lock, the
    RNG draw order and collection order untouched (the engine repository checks those).

## How to verify locally

```sh
npm ci                     # installs the pinned engine packages and copies the engine into src/public/engine
npm run test:wasm          # the integration suites that run the real engine
npx vitest run --project integration tdt storage   # the save and TDT round trips
```

A failure that points into the engine (a hash, a refusal, a loader case) is
reproduced and fixed in Verticopolis/engine, then picked up here by a version
bump.

## Where the rules live

- `CONTRIBUTING.md`: the game's rules and versioning.
- `docs/performance/hot-path-review.md`: the hot-path complexity checklist.
- [Verticopolis/engine](https://github.com/Verticopolis/engine): the
  simulation, the conformance suite, the loader table and the engine's own
  review rules.

## Prose in the diff

American English. No em-dashes in anything new (commas, colons, parentheses
or separate sentences instead). No "X, not Y" restatement and no marketing
vocabulary. A change to a deployed path adds a change note
(`.changes/<branch-slug>.md`) and never edits a version line.
