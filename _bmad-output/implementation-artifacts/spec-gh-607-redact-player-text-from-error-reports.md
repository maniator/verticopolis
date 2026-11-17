---
title: 'Keep tower names and other player text out of error reports (#607)'
type: 'feature'
created: '2026-11-17'
status: 'in-review'
context:
  - '{project-root}/docs/analytics-data-map.md'
  - '{project-root}/docs/performance/hot-path-review.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `$exception` forwards the thrown message, the raw stack (whose first line repeats the message) and a fingerprint built from the message. When an error quotes a tower name, a file name, a facility name or a snippet of a save (`FileNameTakenError` does, and so do browser JSON parse errors), that player text reaches PostHog. The Privacy page says this can happen; the owner wants it gone.

**Approach:** Scrub every `$exception` before it leaves the page: replace each piece of player text the game knows about with a fixed placeholder, and blank the quoted input that browser JSON errors echo. Every other event is already a closed list of codes; confirm that in the audit and keep it so.

## Boundaries & Constraints

**Always:** scrub the message, the raw stack, the type, the `source` URL and the sent fingerprint. Match case-insensitively and only on whole words (no letter or digit on either side), longest name first. Scrub only reports that pass the cap and dedup, so a repeating error costs nothing new. Never throw on the error path. Update `docs/analytics-data-map.md`, the help site's Privacy page and the code comments that promised this as follow-up.

**Ask First:** dropping the message entirely (the issue's allowlist option), or sending any new field.

**Never:** a hook on a per-frame or per-pump path (the tower name is pushed to the UI every pump, so it is read at report time instead); a new guard test; storing player text anywhere but page memory.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Current tower name | message `Couldn't save "Harmony Tower"` | value `Couldn't save "<player text>"`, stack line 1 the same, fingerprint built from the scrubbed message | n/a |
| Saved file name | `FileNameTakenError` for a My Towers file | name replaced | n/a |
| Renamed tower or facility | old and new names remembered in page memory | both replaced | n/a |
| Inside a word | tower `Tower`, type `TowerTooLargeError` | type unchanged | n/a |
| One character | tower `A` | nothing replaced (too short to say anything) | n/a |
| JSON echo | `Unexpected token 'M', "My save" is not valid JSON` | quoted spans blanked | n/a |
| Source throws | a provider throws or the engine is gone | that provider skipped, report still sent | never-throw |
| Repeat | same error every frame | scrub runs once | n/a |

</frozen-after-approval>

## Code Map

- `src/analyticsErrors.ts` -- builds `$exception`; dedup, cap, payload
- `src/analyticsPlayerText.ts` (new) -- page-memory registry of player text, sources, and the scrubber
- `src/game/playerTextSources.ts` (new) -- registers the game's sources: current tower name, My Towers, linked folder, Recent list
- `src/game/appBoot.ts` -- calls the wiring once
- `src/game/editorActions.ts` -- remembers tower and facility names on rename
- `src/ui/uiImport.ts` -- remembers an imported file's name
- `src/ui/uiDialogs.ts` -- remembers a 1994 tower's name when its import report opens
- `docs/analytics-data-map.md`, `help-site/src/content/docs/privacy.md` -- privacy copy

## Tasks & Acceptance

**Execution:**
- [x] `src/analyticsPlayerText.ts` -- `rememberPlayerText`, `addPlayerTextSource`, `scrubPlayerText`, `scrubJsonEcho`; 32 remembered entries; min length 2
- [x] `src/analyticsErrors.ts` -- dedup on the raw fingerprint (memory only), then scrub and send the scrubbed fingerprint
- [x] `src/game/playerTextSources.ts` + `appBoot.ts` -- register the sources
- [x] `src/game/editorActions.ts`, `src/ui/uiImport.ts` -- remember at rename and import
- [x] tests for every matrix row; docs and privacy copy; change note (`app: patch`)

**Acceptance Criteria:**
- Given any tower or file name the player has in My Towers, a linked folder, Recent, the open tower, or a rename or import this page life, when an uncaught error quotes it, then the sent `$exception` holds `<player text>` in its place in every field.
- Given the analytics vocabulary, when audited, then no other event carries free text (codes from closed lists only).

## Spec Change Log

- 2026-11-17, review round 1 (`bmad-code-review`, lean pass): the whole-word pattern used a lookbehind, which older Safari cannot compile, so a report holding a known name would be dropped there; it now captures the left edge instead. Each field is lowercased once per change rather than once per name. "Tower" and "Tower One" (the game's names for an unnamed tower or file) are no longer treated as player text. KEEP: dedup before scrub, scrub-then-clamp windows.
- 2026-11-17, independent review of 80fb906 (NO-GO, 3 patches): a V8 JSON echo holds quotes of its own, so pairing quotes left pieces behind; the echo is now blanked from the first quote to the last (or to the end), in the message and in the stack's copy of it. A value longer than its read window drops the window's last longest-name characters before the bound, so earlier replacements cannot pull a cut name below it. The open tower's name is also read from the name box on screen, since a trapped engine throws on `towerName()`.
- 2026-11-17, Codex on 93be82a (P2): the lowercase `includes` prefilter disagreed with the pattern's Unicode case folding (Greek final sigma, long s) and let a name through. The names now compile into one pattern per report (`playerTextMatcher`), longest first, with no prefilter.
- 2026-11-17, Codex on 976467e (P2): the registry deduplicated names by their lowercase form, which merged `İstanbul` and `i\u0307stanbul` although the pattern folds them apart, so the second went through. It now drops exact duplicates only.

## Design Notes

Dedup stays keyed on the raw message so a per-frame error never pays for a scrub; the key lives in memory and is never sent. Names come from sources read at report time (at most 10 reports a page life), so nothing is added to a pump, tick or frame. Known limit: a facility name given in an earlier visit and never renamed this page life is not known to the scrubber; such names are not used in any thrown message today.

## Verification

**Commands:**
- `npx vitest run src/analyticsPlayerText.test.ts src/analyticsErrors.test.ts src/game/playerTextSources.test.ts` -- pass
- `npm run typecheck && npm run lint` -- pass
