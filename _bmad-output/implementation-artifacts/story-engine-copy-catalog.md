---
story: engine-copy-catalog
status: ready-for-dev
depends_on: engine-rust-port
---

# Story: one copy catalog for the engine's prose

## Why

The engine writes prose: about 50 `emit` sites in `src/engine` plus the
refusal reasons and event messages, and the Rust port carries a second copy
of every sentence. That duplication is why prose parity sits outside the
conformance contract. One catalog, read by both engines, makes the prose
parity automatic, shrinks the Rust crate and the WASM surface (ids and
numbers cross it, never formatted strings), and opens localization later
without an engine change. Copy stays in the repository: the game boots
offline, the Steam build fetches nothing, and a sentence belongs to the
engine version it describes.

## Acceptance criteria

1. **AC1 Ids out, text in one file.** The engine emits a message id with
   parameters; `src/copy/en.json` holds every engine-emitted sentence with
   placeholders. The TypeScript reads it at runtime, the Rust embeds it at
   build time through `include_str!`, and a test proves both load the same
   file.
2. **AC2 Save format.** Log entries carry the id and parameters; entries from
   older saves keep their stored text. Save version bump, migration keeps old
   text, the conformance view already drops text so the lock does not move.
3. **AC3 Style enforced in one place.** The no-em-dash, no "X, not Y" and
   American English rules run as a test over the catalog.
4. **AC4 Same text rendered.** A golden test renders every id with sample
   parameters on both sides and compares the strings.

## Out of scope

- UI copy under `src/ui` and `src/game` (about 1,800 longer literals); a
  second pass on the same catalog once the engine half has settled.
- A CDN or CMS for copy; rejected on the offline, privacy and version-skew
  grounds recorded in the roadmap.
