import type { Simulation } from "../engine/Simulation";
import { SaveGame } from "../storage/SaveGame";
import { IS_WRAPPED_BUILD } from "../platform";
import { exportStoredTower } from "./manualSavePersist";
import type { UI } from "../ui/UI";

/**
 * The .vctower export flow, split out of `saveLoad.ts` at the 500-line guard
 * when the single-flight latch landed (GH #760). `SaveLoad.exportGame` is a
 * thin delegation here, so the latch guards the one choke point on the sole
 * production route to an export: the saves dialog's Export button
 * (`confirmExport` in uiDialogs, then `onExport`, then `exportGame`). There
 * is no menu command or keyboard shortcut for export today; if one lands, it
 * must route through `exportGame` to stay inside the latch.
 */

/** The slice of {@link import("./saveLoad").SaveLoadDeps} the flow touches. */
export interface ExportFlowDeps {
  getSim(): Simulation;
  ui: Pick<UI, "toast" | "downloadFile">;
}

/**
 * How long a single export may hold the latch before the watchdog frees it.
 *
 * `exportRecord` is awaited RAW on purpose: the shell's save dialog
 * legitimately sits open for minutes while the player picks a folder, so a
 * request-scale timeout would cancel real sessions. But "never time out" plus
 * a single-flight latch would let a hung bridge brick Export for the rest of
 * the session, which is worse than the reentry the latch exists to stop. Ten
 * minutes is far past any plausible dialog session, so tripping it means the
 * bridge is stuck, and the honest move is to free the latch and say so. The
 * wrapped fallback's saveFile dialog is awaited raw under this same watchdog
 * (GH #773), on the same reasoning.
 */
export const EXPORT_WATCHDOG_MS = 10 * 60_000;

/**
 * Longest tower name the late-success toast will quote, in CODE POINTS.
 *
 * 28 matches the rename input's `maxlength`, and TDT import caps at 24, so no
 * name a player can make in the game is ever truncated here. The cap exists
 * for a save file edited outside the game: `serialization.ts` assigns
 * `data.towerName` with no coercion while every UI path coerces.
 */
const TOAST_NAME_MAX = 28;

/**
 * Format characters the toast's display name deletes, sparing the two joiners
 * and the tag range.
 *
 * Written as the whole `\p{Cf}` category minus an exception rather than as a
 * list of code points. The list form was tried three times and came up short
 * every time: first it held the C0/C1 controls alone, then it grew the bidi
 * controls and the zero width space, and the confirming review pass showed 152
 * of the 170 format characters still getting through. A category is complete
 * by construction, so there is nothing left here to omit.
 *
 * The exception is load-bearing. U+200C (zero width non-joiner) and U+200D
 * (zero width joiner) stay, because a ZWJ sequence is how a family emoji or a
 * professional emoji is spelled, the rename input's `maxlength="28"` admits
 * one, and every other surface renders it whole. Keeping them costs nothing
 * now: a name of nothing but joiners carries no ink, so {@link TOAST_INK}
 * sends it to the fallback without the strip having to catch it.
 *
 * The tag range U+E0020 to U+E007F is spared for the same reason. Tag
 * characters are format characters, and they are how a subdivision flag is
 * spelled: U+1F3F4 followed by the tags for "gbeng" or "gbsct" and a
 * terminator. Taking them left the base flag standing alone, so England and
 * Scotland quoted identically and rendered as a bare black flag, in this toast
 * while every other surface showed the flag whole. A subdivision flag is 14
 * UTF-16 units, which the rename input's `maxlength="28"` admits. Sparing the
 * range is as free as sparing the joiners: tags are `Default_Ignorable`, so a
 * name of nothing but tags carries no ink and still takes the fallback, and no
 * tag is a `\p{Bidi_Control}` code point, so all 12 of those still go.
 *
 * All 12 `\p{Bidi_Control}` code points are format characters, so this covers
 * the override (U+202E and its neighbors) that would otherwise reverse the
 * tail of the sentence, since nothing later in the toast terminates one. That
 * job stays separate from the ink test and neither replaces the other: a name
 * with plenty of ink can still carry an override.
 *
 * Accepted cost, stated in full: 98 of the category's code points survive (the
 * two joiners and the 96 tags), and every other format character goes. The
 * only ones that cost anything are the prepended concatenation marks, the
 * Arabic number sign and its family. They render nothing on their own and
 * shape only the digits that follow them, which is not something a name quoted
 * inside one toast needs to reproduce. The rest of what goes renders nothing
 * under any circumstances.
 *
 * The spared code points are written as escapes because as literals they are
 * invisible in a diff. The tag range is written in `\u{...}` form so the
 * lookahead tests whole code points; a `\uDB40` in the class would test a lone
 * surrogate and spare far more than the range.
 */
const TOAST_STRIPPED_FORMATS = /(?![\u200C\u200D]|[\u{E0020}-\u{E007F}])\p{Cf}/gu;

/**
 * Matches one character that renders ink, which is what the named form of the
 * toast requires before it will quote anything.
 *
 * A positive test, phrased as "not one of the categories that render nothing".
 * The deny list it replaces could not close this class: no rule about format
 * characters reaches U+3164 HANGUL FILLER (`Lo`), U+2800 BRAILLE PATTERN BLANK
 * (`So`), or the variation selectors (`Mn`), and those are the characters an
 * invisible name is usually built from.
 *
 * What counts as inkless here, and why:
 *
 *  - `\p{Cc}`, `\p{Cf}`, `\p{Cs}`, `\p{Co}`, `\p{Cn}`: controls, format
 *    characters, unpaired surrogates, private use (no assigned appearance
 *    outside one particular font), and unassigned code points.
 *  - `\p{Z}`: every space separator, so a name of exotic spaces is not a name.
 *  - `\p{Mn}` and `\p{Me}`: a nonspacing or enclosing mark has no advance
 *    width and no standalone form, so a name of nothing but marks renders as
 *    marks hung on a dotted circle or on nothing at all. This is the judgment
 *    call in the set, and it is also what covers both variation selector
 *    ranges, U+FE00-U+FE0F and U+E0100-U+E01EF. `\p{Mc}` is deliberately NOT
 *    here: a spacing combining mark advances the pen and shows.
 *  - `\p{Default_Ignorable_Code_Point}`: Unicode's own name for code points a
 *    renderer is meant to show nothing for. It is what reaches U+3164 and the
 *    other Hangul fillers, U+115F, U+1160 and U+FFA0, which are `Lo`.
 *  - U+2800: an assigned printing character whose printed form is empty. It
 *    sits in no category of invisibles, so it is named on its own.
 */
const TOAST_INK = /[^\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Z}\p{Mn}\p{Me}\p{Default_Ignorable_Code_Point}\u2800]/u;

/**
 * Whether `text` holds at least one character that renders ink.
 *
 * Exported and tested in its own right, because three of the categories in
 * {@link TOAST_INK} cannot be reached through {@link toastDisplayName}: the
 * cleaning steps ahead of it already delete every `\p{Cc}` and every
 * `\p{Cf}` other than the joiners and the tags, and every `\p{Z}` is
 * JavaScript `\s`, so the collapse and the trim take those. Left to the flow
 * alone, dropping any of the three would change nothing a test could see. They
 * stay in the rule anyway, so that it states "renders nothing" completely on
 * its own terms and a later reordering of the cleaning steps cannot quietly
 * un-cover a category.
 */
export function hasVisibleInk(text: string): boolean {
  return TOAST_INK.test(text);
}

/**
 * The tower name as the late-success toast may quote it (GH #774).
 *
 * Sanitize then bound, mirroring the shape `towerNameFromFilename` already
 * uses for the import side. Two steps carry weight beyond tidiness: the
 * straight double quote becomes an apostrophe so the quoting in the toast
 * cannot nest, and the cap counts and cuts by code point so an astral emoji
 * is never split into a lone surrogate. An empty return is the caller's
 * signal to drop the naming clause entirely.
 *
 * Exported for the sweep in the wording suite, which walks whole Unicode
 * categories and would be far too slow driven through the flow.
 *
 * ## Deviation from the copy ruling, recorded rather than silent
 *
 * The copy ruling on #774 specified a strip-based step list ending at "empty
 * result takes the fallback". Three review rounds then showed that a deny list
 * of invisible characters cannot close the invisible-name class. The list grew
 * from the C0/C1 controls, to those plus bidi and the zero width space, and
 * the confirming pass still found 152 of the 170 format characters surviving,
 * with U+2060 WORD JOINER reproducing the exact empty-quotes failure the round
 * before it claimed to have closed. Worse, U+3164 HANGUL FILLER (the canonical
 * invisible name character), U+115F, U+1160, U+FFA0, the variation selectors
 * and U+2800 are `Lo`, `Mn` and `So`, so no rule written about format
 * characters could ever have reached them.
 *
 * The repo owner authorized a positive visible-ink test in place of the
 * ruling's step 5: after cleaning, a name holding no character that renders
 * ink takes the fallback. Every other ruled step stands. The deviation is
 * recorded in a comment on #774, so a reader of the ruling can see why the
 * shipped code differs from the ruled steps.
 *
 * ## What the rule guarantees
 *
 * Whenever the toast takes the NAMED form, the quoted span renders at least
 * one visible glyph. The truncating branch holds it too, since U+2026 is
 * itself ink. What it does not promise is that the visible glyph is the one a
 * reader would have picked. A hand-edited name whose only ink sits past the
 * 28th code point truncates to invisible characters plus the ellipsis and
 * shows as "…" inside the quotes. That still says something true, that the
 * name ran longer than the toast will print, and it is reachable only from a
 * save edited outside the game.
 *
 * ## The other place this reads wider than the ruled steps
 *
 * Whitespace maps to a space BEFORE the strip. The ruling strips first and
 * collapses second, but the newline, carriage return, tab, vertical tab and
 * form feed are controls AND whitespace, so that order deletes them and joins
 * the words around them ("Sky", newline, "High" would read "SkyHigh"). Mapping
 * first keeps the break the name was written with, while a control that is not
 * whitespace still goes.
 */
export function toastDisplayName(name: unknown): string {
  if (typeof name !== "string") return "";
  const cleaned = name
    .replace(/\s/g, " ")
    .replace(/\p{Cc}/gu, "")
    .replace(TOAST_STRIPPED_FORMATS, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/"/g, "'");
  if (!hasVisibleInk(cleaned)) return "";
  const points = Array.from(cleaned);
  if (points.length <= TOAST_NAME_MAX) return cleaned;
  return points.slice(0, TOAST_NAME_MAX - 1).join("") + "…";
}

/**
 * What to say when an export the player was told had stalled finally lands.
 *
 * The player has moved on, usually into another tower, and was told minutes
 * ago that the export was not responding, so naming the tower is what closes
 * the loop. With no usable name the sentence drops the clause and still says
 * the true thing; a placeholder name inside quote marks would read as a tower
 * actually called that.
 */
function lateExportedToast(name: string): string {
  if (name === "") return "The earlier export finished. Check where you saved it.";
  return `The earlier export of "${name}" finished. Check where you saved it.`;
}

/** The run id currently holding the single-flight latch; 0 when free. */
let latchOwner = 0;
let nextRun = 0;

/**
 * Test seam, mirroring `resetManualSaveForTests` for this module's state.
 *
 * Frees the latch but leaves `nextRun` alone, so run ids stay unique for the
 * life of the module. Resetting the counter recycled them, and a run still in
 * flight across a reset would then read a LATER run's latch as its own: it
 * would take the in-latch wording it is no longer entitled to and free the new
 * run's latch on the way out, pushing that new run onto the late path. That
 * inverts both sides of the `latchOwner !== run` test, which now decides
 * wording as well as reentry.
 */
export function resetExportFlowForTests(): void {
  latchOwner = 0;
}

/**
 * Hand the player their tower as a compressed .vctower file.
 *
 * Single-flight (GH #760): the desktop port contract makes the shell's save
 * dialog modal to the game window, but a platform whose app-level menu is not
 * blocked by a window-modal dialog (macOS) can still fire Export mid-dialog,
 * and a nonconforming shell can too. A second run would stack a second flush
 * plus a second dialog, or drop a live-path download dialog on top of the
 * stored-export one. Reentry is a quiet no-op: on every reachable reentry
 * path the first dialog is already on screen, so a toast would only compete
 * with it.
 *
 * The watchdog is the latch's escape hatch, and deliberately does NOT abandon
 * the awaited call: it frees the latch and tells the player, and if the
 * original dialog settles late its outcome still lands (a late success still
 * exports, and names the tower it exported; a late cancel still says nothing).
 * The one exception is a late "fallback": every other late outcome finishes
 * something, but fallback would START the live path and drop a fresh dialog on
 * top of whatever the player is doing minutes later, so a run that no longer
 * holds the latch stops there (the Edge Case Hunter demonstrated the
 * collision). The settle path releases only a latch its own run still holds,
 * so a late settle can never unlock a newer export's dialog.
 */
export async function runExportFlow(deps: ExportFlowDeps, stampView: (sim: Simulation) => void): Promise<void> {
  if (latchOwner !== 0) return;
  const run = ++nextRun;
  latchOwner = run;
  const watchdog = setTimeout(() => {
    if (latchOwner !== run) return;
    latchOwner = 0;
    deps.ui.toast("The export is not responding. You can try exporting again.", "bad");
  }, EXPORT_WATCHDOG_MS);
  try {
    const sim = deps.getSim();
    // stampView FIRST, before either path: the stored-byte flush below
    // must carry the camera exactly as the live-serialize path always has
    // (a party catch: dropping it would export towers at a stale view).
    stampView(sim);
    // Capture the display name HERE, in the same synchronous step, for the
    // late-success toast below (GH #774). The `sim` local does survive an
    // `adoptSim` swap, so reading the name at settle time is usually right,
    // but a rename of this sim before the swap would drift it.
    const towerName = toastDisplayName(sim.tower.towerName);
    // Stored-byte export (story D7, D2's AC22): on a hydrated desktop
    // session, flush to auto and let the shell COPY the stored file, so
    // the destination bytes equal the stored bytes. Cancel is a CHOICE
    // (Copilot caught the success toast firing on it): say nothing, open
    // nothing else. Only "fallback" runs the live-serialize path below,
    // which is what every other build runs.
    if (IS_WRAPPED_BUILD) {
      const stored = await exportStoredTower(sim, SaveGame.exportFilename(sim));
      if (stored === "exported") {
        // A success that lands after the watchdog freed the latch gets its
        // own wording: the file really was written, but the player has since
        // been told the export stalled and has probably moved on, so the
        // toast has to say which export this is. A run still holding the
        // latch is the ordinary case and keeps the ordinary sentence.
        if (latchOwner !== run) {
          deps.ui.toast(lateExportedToast(towerName), "good");
          return;
        }
        deps.ui.toast("Tower exported. Check where you saved it.", "good");
        return;
      }
      if (stored === "canceled") return;
      // A late "fallback" (the hung bridge finally rejected or answered
      // malformed, long after the watchdog freed the latch) must not run the
      // live path: that OPENS a download or saveFile dialog, possibly on top
      // of a retry's dialog, the exact collision the latch exists to stop.
      // An immediate fallback still owns the latch and proceeds normally.
      if (latchOwner !== run) return;
    }
    const file = await SaveGame.export(sim);
    const delivered = deps.ui.downloadFile(SaveGame.exportFilename(sim), file);
    // The container is pure ASCII, so string length == bytes on disk.
    deps.ui.toast(`Tower exported (${(file.length / 1024).toFixed(1)} KB). Check your downloads.`, "good");
    // On a wrapped session this live path opened the shell's saveFile dialog,
    // which outlives the call, so hold the latch until it settles (GH #773):
    // releasing on return reopened the reentry window the latch exists to
    // close (a second flush plus a second dialog off the macOS menu). The
    // toast stays above the await on purpose: the port contract resolves
    // saveFile identically for a written file and a canceled dialog (types.ts,
    // cancel is not an error), so waiting for the settle could not tell the
    // player anything more, and the residual is that a cancel still gets this
    // toast. In a browser build the branch folds away and the anchor-click
    // download keeps its synchronous timing, toast included.
    if (IS_WRAPPED_BUILD) await delivered;
  } catch (err) {
    // Never fail silently: main.ts fires this with `void`, so an unhandled
    // rejection here would leave the player with no download and no feedback.
    deps.ui.toast("Export failed: " + (err as Error).message, "bad");
  } finally {
    clearTimeout(watchdog);
    if (latchOwner === run) latchOwner = 0;
  }
}
