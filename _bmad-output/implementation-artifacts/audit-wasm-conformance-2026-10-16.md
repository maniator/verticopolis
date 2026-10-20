# Conformance and TDT readiness audit, 2026-10-16

Repository state checked through GitHub issue and PR tools. All eleven primary issues below are open. This file supplies evidence to the lead's canonical plan and does not replace that plan.

| Issue | Classification | Evidence and remaining acceptance |
| --- | --- | --- |
| #878 | Release blocker, existing PR #1062 | Explicit owner requirement before the default flip. PR implements vitest parity CI, cadence annotations and commute readout. Head 300c7d9 has unresolved Codex finding r4290332820: samples lost on detach between merges. Gallery baseline mint at flip remains assigned to #945. |
| #858 | Loader compatibility gap | Fractional numeric fields, mistyped optional fields, JSON overflow and lone surrogates, and legacy reflow differ on hand-edited saves. Issue has no claim comments. Own-writer conformance does not prove these cases. Requires a focused loader design and paired coercion regressions. |
| #864 | Coverage prerequisite | No fixture reaches five-star/TOWER inspection and the underwhelming-suite path. Derive fixture with documented script, assert construction and topology, pin conformance and ratchet measured Rust coverage. Coordinate shared fixture with performance owner, who owns measurement. |
| #865 | Refusal-order conformance gap | Runner's expectFail checks only ok. Add optional reason field in both runners, annotate all refusals and reach locked placement branches from four-star fixture. This can ship independently of #864. |
| #869 | Coverage gap, dependent on #864 for wedding hall | Quarterly Modern rent, rental payout, thief escape, metro rain relief, special venue/VIP, subtype recovery, ghost origin and forged-loader branches lack referee cases. Both runtime scenarios and loader case locks need expansion. |
| #883 | Reproducible lock prerequisite | Pin en-US refusal formatting and compare inflated bytes, avoiding zlib encoding drift. No existing claim comment. Gate includes non-English locale and another Node release. |
| #884 | Codec boundary and forged-export gap | Matching 718-probe subset is unpinned. Comments document remaining raw floor/x/width string and array differences and the exact deliberately narrower raw-site reader. Number grammar fixed in #881 does not close raw-site semantics. Filename helper tests and full boundary lock remain needed. |
| #885 | Partially complete, codec routing prerequisite | Existing differential suite already runs in test:wasm. Corrected issue comment: default 1,070 exports and 533 imports, scaled 25,413 imports and 25,020 exports with known forged-field exclusions. Remaining: nightly volume workflow, fixed-point properties, local owner-save comparison and six harness-hardening items. Do not duplicate or enlarge ordinary PR CI fuzz volume. |
| #886 | Codec routing and release prerequisite | Need exhaustive test-to-lock/Rust mapping for approximately 180 TS cases and direct Rust helper unit equivalents. Existing representative lock is insufficient. No claim comments. |
| #887 | Forged-export correctness prerequisite | TS throws or hangs on malformed shapes handled differently by Rust. Later comment adds string arrays, absent/non-string towerName and NaN-to-null JSON boundary. Decide shared refusal/drop behavior and pin both sides before codec routing. |
| #920 | Separate original-game fidelity research | Eleven claims are shared behavior, proven byte-equal by 227-case lock and prior 8,000-input differential. Requires original-game/Wine observations before changing both implementations. It is not evidence of Rust port divergence. #740 already owns express payload sizing. |

## Existing PR #1062 takeover evidence

- PR: https://github.com/maniator/verticopolis/pull/1062
- Existing head: 300c7d9c47347976f2c54797428ee06d487cd76f, claude/vitest-on-wasm-3k4ylx.
- Owner request: issuecomment-6219563961, 2026-10-16 16:07:22 UTC, asks both hosts to preserve commute samples and forbids merge before review resolution.
- Bot completion report: issuecomment-6220684270, 17:07:53 UTC, reports commit 47974ae and follow-up PR metadata. Repository REST lookup returns 422 for that commit; global repository commit search returns none. Matching PR search finds #1062 and historical merged accumulator work only. The implementation is unavailable to integrate from those references.
- Takeover claim: https://github.com/maniator/verticopolis/pull/1062#issuecomment-6222745721
- Isolated worktree: .worktrees/wasm-conformance, branch codex/wasm-conformance, based on the existing PR head.
- Focused fix specification: spec-1062-commute-handoff.md.
- Preserve existing #1062 PR. Do not open a duplicate PR for this regression.

## Release conclusion

No release-readiness assertion follows from these results. In particular, #878 remains unmerged, codec routing prerequisites remain open, hand-edited compatibility is incomplete, and written performance sign-off belongs to the separate performance owner.
