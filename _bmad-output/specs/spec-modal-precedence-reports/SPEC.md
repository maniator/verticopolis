---
id: SPEC-modal-precedence-reports
companions:
  - ../../project-context.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Modal Precedence for the Import and Export Reports

> **Status: parked.** Ratified and ready to build, but sequenced *after* the
> dialog-actions visibility work. That fix addresses data loss the owner has
> actually hit; this one is a P3 race with a timing window. Both fixes need the
> same seam (a dialog declaring that it owns pending work), so building this one
> second lets it adopt that seam rather than invent it.

## Why

**A pain to solve**, and a self-defeating one. `showImportReport` and `showExportReport` refuse to open while `ui.isModalOpen()` and report that refusal with `ui.toast(...)`. A `<dialog>` renders in the browser's top layer, above every z-index on the page, so the refusal message is unreadable **by construction**: it can only ever fire when an open modal is guaranteed to be covering it. Its entire content is what-to-do-next, delivered where nobody can read it.

The cost is a discarded tower. By the time the report is refused, the file has been fully read and parsed, so the player loses completed work and is asked to re-pick the file from cloud storage, with no idea why.

Reachable today: title screen, Load Tower, Choose file (the picker closes itself and the OS picker opens), pick a `.TDT`, `FileReader` reads asynchronously while the page is interactive again (seconds on an Android cloud provider), the player reopens Load Tower, the read completes, the report bails and toasts under the reopened dialog. The picker re-renders looking identical. Filed as GH #658; the same race is reachable from the in-game saves manager, which also closes itself before handing off to the file picker.

## Capabilities

- **CAP-1**
  - **intent:** A report that cannot open immediately always tells the player so, somewhere they can actually see it.
  - **success:** No refusal or deferral path reports itself only through a toast raised while a modal is open. A test asserts the message is reachable in the rendered DOM the player is looking at, not merely that a reporting function was called.

- **CAP-2**
  - **intent:** The app can tell a modal that is merely on screen from one that owns a pending decision or unsaved work.
  - **success:** The guard exposes both facts rather than one boolean. Classification **fails safe**: a modal is protected unless it declares itself displaceable, so a dialog added later defaults to protected. Tests pin that the event-choice and update-prompt dialogs read as protected, that the elevator-schedule dialog reads as protected while it holds unsaved edits, and that at least one informational dialog reads as displaceable.

- **CAP-3**
  - **intent:** A report arriving over a modal that owns nothing opens immediately, honoring the import the player already asked for by picking the file.
  - **success:** With a displaceable modal open (Help, Settings, Saved Towers, the tower picker, congratulations), the report replaces it and is on screen without further player action. A test pins the replacement and that the displaced dialog leaves no pending handler behind.

- **CAP-4**
  - **intent:** A report arriving over a modal that owns a pending decision waits rather than destroying it.
  - **success:** With the event-choice or update-prompt dialog open, the report does not open and does not clobber; it waits on a leash tied to **that specific dialog resolving**, and opens once it does. A test pins that the blocking dialog's own resolution still fires exactly once and that the report follows it.

- **CAP-5**
  - **intent:** A wait that cannot be honored ends in a plain statement, never in silence.
  - **success:** When the leash breaks (a tower swap, a second import landing first, the blocked dialog resolving into another blocking state), the parsed tower is dropped and the player is told plainly, visibly, that the import did not open. A test asserts the player-visible message, per CAP-1's standard.

- **CAP-6**
  - **intent:** Exporting behaves the same way as importing.
  - **success:** `showExportReport` follows the same precedence, waiting, and failure-reporting rules as `showImportReport`. Tests cover the export path for CAP-1 and CAP-3.

## Constraints

- **A toast can never be the channel for a message raised while a modal is open.** The `<dialog>` top layer beats every z-index, so "visible" means either inside the dialog that is in the way, or after the way clears. This is the defect itself, so no fix may reintroduce it.
- **Displacing a protected modal is forbidden.** `openModalTemplate` calls `replaceChildren()`, so displacing `showEventChoice` erases it mid-flight and its fire-once `onResolve` never runs while the frame loop holds the sim frozen on `shownChoice`. That is a deadlock with no dialog and no way out.
- **Classification defaults to protected.** A hand-maintained list of dismissible dialogs would have missed the elevator-schedule dialog, which `preventDefault`s Esc while it holds unsaved edits: it owns real work without owning a pending resolution. The cost of forgetting to classify a new dialog must be an unnecessary wait, never lost player work.
- **The wait is leashed to one dialog resolving, not open-ended.** The import report closes over a fully parsed `Simulation`; held across a tower swap or a second import it would eventually adopt the wrong tower, or ambush a player who has moved on.
- **Tests assert the player was informed, not that a branch was taken.** "We called `toast()`" is not the same claim as "the player was told". This bug shipped precisely because the failure is only reachable from the state that conceals it.
- American English, no em-dashes in new copy, comments, commit or PR text.

## Non-goals

- A general modal stacking or z-index system. One shared `<dialog>` stays the model; this is about who gets it and what happens to whoever is waiting.
- Persisting a pending import across a reload.
- Any change to the `.vctower` or `.TDT` formats, to import fidelity, or to what the reports themselves say about a tower.
- Changing the emergency-choice or update-prompt freeze semantics. They stay blocking; this work only stops other surfaces from destroying them.
- Reworking the toast rail. Its stacking against the splash was settled separately; a dialog will always beat it, which is why the fix routes around it rather than through it.

## Success signal

A player picks a `.TDT` from cloud storage on a phone, gets impatient during the read, and reopens the tower picker. The fidelity report opens over the picker anyway and their tower is one tap away. In the one case where it genuinely cannot open, they are told so in words they can read, rather than watching a dialog re-render as though nothing happened while a parsed tower is discarded.

## Assumptions

- The elevator-schedule dialog's dirty state is the only unsaved-work case among current dialogs that is not already a pending-resolution case. Re-verify when the shared dismissal helper lands, since that helper is expected to make ownership explicit per dialog.

## Open Questions

- Where the shared "this dialog owns pending work" declaration lives is being settled by the dialog-actions visibility work that ships first. This spec adopts whatever seam that lands rather than defining a second one.
