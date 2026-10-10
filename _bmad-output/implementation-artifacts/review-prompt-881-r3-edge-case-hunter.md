# Reviewer prompt: Edge Case Hunter (PR #881, round 3)

Run this in a fresh session with a checkout of maniator/verticopolis at
branch `claude/engine-tdt-port`, commit `1663ecb`. Invoke the
`bmad-review-edge-case-hunter` skill on the diff below, with read access to
the whole project.

```bash
git fetch origin main claude/engine-tdt-port
git checkout 1663ecb
git diff 347e42232620cd776901fa3fdb998fb77fe18467...1663ecb
```

Context: `engine-rs/src/tdt/` ports `src/storage/tdt*` (TypeScript, the
reference) to Rust. The lock `conformance/tdt-cases.json` (227 cases: 172
import, 55 export) is written by
`src/tests/integration/tdtCases.integration.test.ts` and replayed by
`cargo run --release --bin tdt`. Since review rounds 1 and 2 the branch merged
main twice (96e7f4d, ba445e9, including #891's engine changes and a rebuilt
`src/public/engine` package), and 1663ecb switched the tenant-count refusal
to `with_thousands`.

Walk every branch and boundary in the Rust port against the TypeScript
reference (`src/storage/tdtParse.ts`, `tdtEncoder.ts`, and siblings):
population census, elevators and transport (pooling, spans, car counts),
floor and lobby and view mapping, money, every refusal and its exact text,
JavaScript number semantics (`jsmath`), and whether the merges changed
anything the TDT code depends on (`with_thousands`, the wasm binding surface,
`engine.d.ts`, the committed package hash). Report only unhandled edge cases
or divergences from the TypeScript behavior, each with the input that
triggers it.

Output: a Markdown list. Each finding: one-line title, file and line, the
triggering input or path, TypeScript behavior versus Rust behavior. Paste it
back into the session that ran `/gds-code-review`.
