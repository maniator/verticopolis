# Reviewer prompt: Blind Hunter (PR #881, round 3)

Run this in a fresh session with no other context. Invoke the
`bmad-review-adversarial-general` skill and give it ONLY the diff below as its
content. Do not read any other file in the repository, the spec, or the
project docs: this layer is blind by design.

Get the diff (both commits are pushed to maniator/verticopolis):

```bash
git fetch origin main claude/engine-tdt-port
git diff 347e42232620cd776901fa3fdb998fb77fe18467...1663ecb
```

Review target: the Rust port of the 1994 `.TDT` importer and exporter
(`engine-rs/src/tdt/`), its WASM binding (`engine-rs/src/wasm.rs`,
`src/dualrun/engine.d.ts`, the rebuilt `src/public/engine/` package), and
its lock (`conformance/tdt-cases.json` with its TypeScript generator).

Output: a Markdown list of findings. Each finding: one-line title, file and
line from the diff, the evidence, and why it is wrong. No praise, no summary.
Paste the list back into the session that ran `/gds-code-review`.
