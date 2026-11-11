---
title: 'Unit-test the engine port with mock ports and layout fixtures (#1923)'
type: 'refactor'
created: '2026-11-11'
status: 'in-review'
baseline_commit: '5fcbbda0'
context: ['{project-root}/CONTRIBUTING.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The port's unit tests (`src/simport/{portEvents,portCodes,headerClock,viewReader,cards,portRenderSim}.test.ts`) replay recorded Rust engine answers call by call. The owner rejected that as not unit testing: the tests check the engine through a replay, not what each unit asks the port and does with the answers.

**Approach:** Each unit test builds a mock `EnginePort` from `vi.fn()` spies. Its long answers come from JSON fixtures taken from the Rust engine (the view layout), with frames, structures and records encoded from that layout's slots. Each test asserts the calls made (method, arguments, count) and the decoded result. The engine-behavior checks move to an integration suite on the Rust engine, and one integration test holds each fixture to the engine's fresh answer.

## Boundaries & Constraints

**Always:** A mock refuses any method the test did not give it, so an unexpected port call fails. Fixtures live under `src/simport/fixtures/` and are rewritten only by `VC_UPDATE_PORT_FIXTURES=1` on the integration test. The plain `test` job keeps functions coverage at or above 94%. American English, no em-dashes.

**Ask First:** Dropping any engine-behavior assertion the current tests make instead of moving it.

**Never:** Record/replay of call sequences. Tests that read workflow, package.json script or Vitest config text. Deleting e2e tests or screenshots.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Delta frame in sequence | `frameSeq` = last + 1 | one `viewFrame(false)` call | N/A |
| Frame skipped | `frameSeq` jumps | `viewFrame(false)` then `viewFrame(true)` | N/A |
| Generation moves | `generation()` changes | `view()` read, rooms rebuilt, pool reset | N/A |
| Meta revision moves | header `metaRevision` changes | `unitMetaChanged(old)` then label/subtype per listed id | unknown ids skipped |
| Unknown card id | empty record | `undefined`, no label read | N/A |
| Refused command | record slot 0 is 0 | `lastReason()` called once | N/A |

</frozen-after-approval>

## Code Map

- `src/tests/portKit/mockPort.ts` -- new: strict spy port, layout fixture, frame/structure/record encoders
- `src/simport/fixtures/viewLayout.json` -- new: the Rust engine's `viewLayout()` answer
- `src/simport/*.test.ts` (six files) -- rewritten on the mock port
- `src/tests/integration/portReads.integration.test.ts` -- new: the fixture check, and the events, codes, clock and render engine checks
- `src/tests/integration/portReader.integration.test.ts` -- new: the reader and card engine checks
- `src/tests/portKit/portRecording.ts`, `src/simport/recordings/`, `port:record` -- deleted
- `.pr_agent.toml`, `docs/ci/pr-agent.md` -- drop the recordings ignore line
- `package.json` `test:wasm:host` -- runs the two new integration suites with the engine (`converted.txt` is only for `portSim` suites)

## Tasks & Acceptance

**Execution:**
- [x] `src/tests/portKit/mockPort.ts` -- strict spy port plus encoders -- one way to build answers
- [x] six unit tests -- rewrite with call assertions -- owner's unit-testing standard
- [x] `src/tests/integration/portReads.integration.test.ts` -- engine checks plus fixture check -- keeps engine coverage
- [x] delete the recording layer and its references -- nothing points at deleted files

**Acceptance Criteria:**
- Given no engine package, when `npm test` runs, then the six unit suites pass and none skip.
- Given the engine package, when the integration suite runs, then each fixture equals the engine's answer, and `VC_UPDATE_PORT_FIXTURES=1` rewrites a stale one.

## Verification

**Commands:**
- `npm run typecheck && npm run lint` -- expected: clean
- `npx vitest run --project unit src/simport` -- expected: pass without the engine
- `npx vitest run --project integration portReads portReader portSaves` -- expected: pass with the engine
