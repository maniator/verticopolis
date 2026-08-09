import type { GameApp } from "../main";
import type { HostCommand } from "../platform/types";
import { getPlatform } from "../platform";
import { runSplashAction } from "../ui/splashActions";
import { isExportInFlight } from "./exportFlow";
import {
  type InteractionState,
  isCrashed,
  isSplashUp,
  readInteractionState,
  changeKey,
  availabilityKeyChanged,
  commitAvailabilityKey,
  resetAvailabilityKey,
} from "./interactionState";

/**
 * The shell-to-game half of the platform seam (`src/platform/types.ts`).
 *
 * A wrapper shell (today the Electron desktop shell, through its native
 * application menu) asks the game to run a command. This module is where that
 * ask becomes the same call an in-game button already makes. Two rules shape
 * everything here:
 *
 *  1. **Every command routes to the control's own code path.** Nothing below
 *     synthesizes a click, reads an element id to decide what to do, or
 *     reimplements a control's logic. Driving the DOM from outside the game was
 *     the rejected design: element ids are not a contract, and a shell that
 *     depends on them breaks silently on any UI refactor.
 *  2. **The shell sends intent; the game decides.** The shell cannot know
 *     whether a command can run right now, so it never disables the affordance
 *     that sends one. The guards below are the game's, matching what its own
 *     controls do, and a refusal is announced rather than swallowed. The
 *     alternative (teaching the shell about splashes and dialogs) would put
 *     game state in another process and desynchronize the moment either side
 *     changed.
 *
 * The native menu is ADDITIVE. Every in-game control it duplicates stays
 * exactly where it is: removing them would fork the interface shared with the
 * web, Android, and iOS builds, and would strand anyone playing on a controller,
 * on a handheld, or through a living-room launcher, none of whom can reach a
 * menu bar.
 *
 * Note on undo and redo: these route to the same callbacks the toolbar's arrows
 * use, so like those buttons they are TOWER-scoped regardless of what has focus.
 * The keyboard path in `bindKeys` deliberately differs, yielding Ctrl+Z to a
 * focused field with its own edit history. Both are intentional: a menu item is
 * a global application affordance, a keystroke is field-local by convention.
 *
 * Inert in the browser: `onHostCommand` is optional and no browser port
 * defines it, so `bindHostCommands` binds nothing and no browser session
 * behaves differently.
 */

/** Every command the game will act on. The runtime check matters even though
 *  the type is a union: the value crosses a process boundary from a separate
 *  repository, so it arrives as an unvalidated string. */
/**
 * Build a policy set from a table that names EVERY command explicitly.
 *
 * The enforcement is the PARAMETER TYPE, not the `satisfies` at the call sites: an
 * object literal passed as `Record<HostCommand, boolean>` must name every key
 * (a missing one is an error) and may not invent one (excess property check). The
 * `satisfies` clauses are belt and braces, kept because they also pin the literal
 * if anyone ever loosens this signature.
 *
 * The tables used to be `new Set<HostCommand>([...])`, which caught a typo and not
 * an omission. That mattered most for `OPENS_A_DIALOG`, where the default for a
 * forgotten command is "does not open a dialog", so a new dialog-opening command
 * would have been allowed to open out from under a live editor press: exactly the
 * failure that set exists to prevent. Listing the false entries is the price of
 * making the compiler check the list, and it also documents each decision.
 */
function setFromFlags(flags: Record<HostCommand, boolean>): ReadonlySet<HostCommand> {
  // `ReadonlySet<HostCommand>`, not `<string>`: the looser type let
  // `SPLASH_SAFE.has("new_game")` (underscore, not hyphen) typecheck and silently
  // answer false forever.
  return new Set(Object.entries(flags).filter(([, on]) => on).map(([k]) => k as HostCommand));
}

const HANDLED_RECORD = {
  "new-game": true,
  save: true,
  "open-saves": true,
  export: true,
  undo: true,
  redo: true,
  stats: true,
  help: true,
  settings: true,
  // `satisfies` makes the compiler check this against the union both ways: a
  // command added to `HostCommand` and forgotten here is a missing-key error, and
  // a typo here is an excess-property error. A hand-written `new Set<HostCommand>`
  // only caught the second, so the list could silently under-cover the contract.
} satisfies Record<HostCommand, true>;

const HANDLED: ReadonlySet<string> = new Set(Object.keys(HANDLED_RECORD));

/**
 * Commands that run while the title screen is up.
 *
 * The splash is a real screen with its own controls (Continue, Load Tower, New
 * Tower, How to Play), so "the splash is up" is not by itself a reason to
 * refuse anything. These four all have a home there: How to Play is already a
 * splash button, Settings is self-contained and touches no tower state, and New
 * Tower and Load Tower are the two things a player most obviously wants from a
 * title screen. Graying out New and Open on the very screen whose main job is
 * starting or loading a tower is the wrong answer, and it was the first thing
 * that looked broken when the packaged app was driven by hand.
 *
 * New Tower and Load Tower route to the SPLASH's own buttons rather than the
 * in-game paths (see `runHostCommand`), because the two differ: the splash's
 * Load Tower opens the load-only picker, and its New Tower carries the dismiss
 * callback that keeps the title screen standing if the player backs out.
 *
 * The five that stay refused are refused for their own reasons, not a blanket
 * one. `save` would write the untouched boot tower over a real save. `export`
 * has no tower to pack into a file yet. `undo` and `redo` have no history to
 * walk before a tower exists. `stats` would report on a tower the player has
 * not opened.
 */
const SPLASH_SAFE: ReadonlySet<HostCommand> = setFromFlags({
  "new-game": true,
  save: false,
  "open-saves": true,
  // No tower exists on the title screen, so there is nothing to export; refused
  // for the same reason as save and stats.
  export: false,
  undo: false,
  redo: false,
  stats: false,
  help: true,
  settings: true,
} satisfies Record<HostCommand, boolean>);

/** A refusal: the reason, and whether the player can actually be told. */
interface Refusal {
  reason: string;
  /** False behind the crash screen. That card is a `showModal()` dialog, so the
   *  page behind it is inert and the toast rail paints under its backdrop; there
   *  is nowhere to put a notice. The card itself is the message, so this path
   *  refuses in silence rather than pretending to speak. */
  speakable: boolean;
}

/** Why a command was refused, or null when it may run. Pure, so the guard order is
 *  readable and testable on its own without touching a document. */
function refusalForState(s: InteractionState, command: HostCommand): Refusal | null {
  // The crash screen owns everything while it is up: the renderer is dead and
  // the tower was already flushed, so a Save from the menu would be acting on a
  // session that has stopped. `bindKeys` guards keyboard input the same way and
  // for the same reason.
  if (s.crashed) {
    return { reason: "Not available right now", speakable: false };
  }
  // `splashUp` is `interactionState.isSplashUp()`, the ONE answer the dispatch
  // reads too (it routes New Tower and Load Tower through the splash's own
  // buttons only when `isSplashUp()`). Guard and dispatch reading one source is
  // what stops them disagreeing about whether the title screen is up: the class
  // of bug this refactor (#716) exists to remove.
  if (s.splashUp && !SPLASH_SAFE.has(command)) {
    return { reason: "Start or load a tower first", speakable: true };
  }
  // A menu can be reached while a dialog is open, which no in-game button can:
  // they sit behind it. Opening a second dialog would displace the first, and a
  // New Tower accepted behind a choice-bearing dialog is the kind of thing a
  // player never sees coming.
  //
  // The two blocking-choice flags are read directly rather than trusted to imply
  // `#modal.open`. They do imply it today, but that is an invariant held in two
  // other modules (`appModals`, `updateFlow`), and if either ever renders its
  // choice through a different element the shell would be told every command is
  // available AND the dispatch would run New Tower out from under a live
  // choice. Reading the flags costs two property loads and removes the
  // dependency.
  if (s.blockingChoice || s.dialogOpen) {
    return { reason: "Close the open window first", speakable: true };
  }
  // A live press inside the editor card. The frame loop declines even a stats
  // refresh in this state so the card cannot move under the pointer; opening a
  // dialog out from under the press is the louder version of the same problem.
  if (s.editorBusy && OPENS_A_DIALOG.has(command)) {
    return { reason: "Finish what you are doing first", speakable: true };
  }
  return null;
}

/** The single-command form, for the dispatch path. `availableCommands` reads the
 *  state once and calls `refusalForState` directly rather than going through this,
 *  which is the whole reason the state was hoisted. */
function refusalFor(app: GameApp, command: HostCommand): Refusal | null {
  // Crash first, without reading anything else. The extraction made every source
  // eager, and on the crash path the app is the least trustworthy thing to read.
  if (isCrashed()) return { reason: "Not available right now", speakable: false };
  // An export already holds the single-flight latch, so its native save dialog is
  // open. On macOS the app menu stays live during that dialog, so File > Export
  // Tower can fire again; refuse it visibly here rather than let it open a second
  // wizard that would silently do nothing. Checked outside `refusalForState` (the
  // pure, state-driven guard) because the latch is a live runtime flag, not part
  // of the hoisted InteractionState snapshot, exactly like the crash check above.
  if (command === "export" && isExportInFlight()) {
    return { reason: "An export is already in progress.", speakable: true };
  }
  return refusalForState(readInteractionState(app), command);
}

/** Commands that put something new on screen, so an in-flight editor press
 *  matters. `save`, `undo`, and `redo` do not displace anything. */
const OPENS_A_DIALOG: ReadonlySet<HostCommand> = setFromFlags({
  "new-game": true,
  save: false,
  "open-saves": true,
  // Export opens the two-step export choice dialog, so an in-flight editor press
  // matters, exactly like open-saves and stats.
  export: true,
  undo: false,
  redo: false,
  stats: true,
  help: true,
  settings: true,
});

/**
 * Run one command, or refuse it and say so. Exported for tests and for any
 * future affordance that needs the same dispatch; shells reach it through
 * {@link bindHostCommands}.
 */
export function runHostCommand(app: GameApp, command: string): void {
  if (!HANDLED.has(command)) {
    // A shell sending something outside the contract is a shell bug. Say so
    // where its author will look, and do nothing.
    console.warn(`[platform] Ignoring unknown host command: ${command}`);
    return;
  }
  // Narrowed ONCE, here, where the runtime check just proved it. Everything below
  // takes a real `HostCommand`, which is what makes the exhaustiveness guard in
  // `dispatch` a guard rather than decoration.
  const known = command as HostCommand;
  const refusal = refusalFor(app, known);
  if (refusal) {
    // A menu item that appears to do nothing is the single worst outcome of an
    // always-enabled design, so a refusal has to be perceivable. `sayVisibly`
    // is the existing answer (GH #658): it puts the line inside whatever dialog
    // is in the way, because a `<dialog>` paints over the toast rail at any
    // z-index, and toasts only when there is no dialog to be behind. Its notice
    // carries `role="alert"`, so this is announced as well as shown, and calling
    // `announce` too would say it to a screen reader twice.
    if (refusal.speakable) app.ui.sayVisibly(refusal.reason, "info");
    return;
  }
  dispatch(app, known);
}

/**
 * Run a validated command. Split from {@link runHostCommand} so its parameter is
 * a real `HostCommand` rather than a `string`.
 *
 * That split is the whole point. The switch used to read `switch (command as
 * HostCommand)` with a `never` assignment in its default, which looked like an
 * exhaustiveness guard and was not one: the subject was a cast EXPRESSION, so
 * TypeScript narrowed nothing in the default branch, and `command as never`
 * laundered whatever was left anyway. A ninth command with no `case` compiled
 * clean, which is exactly the failure the comment claimed to prevent. With the
 * parameter typed, the `never` assignment below is checked for real.
 */
function dispatch(app: GameApp, command: HostCommand): void {
  switch (command) {
    case "new-game":
      // On the title screen, run the SPLASH's own New Tower, which keeps the
      // screen standing if the player backs out of the confirmation. Off it, the
      // same picker the toolbar's New Tower opens, including its fold-in abandon
      // warning: a menu item must not be a shortcut past a confirmation the
      // button shows. The splash decision is `isSplashUp()`, the SAME answer the
      // availability guard reads, so guard and dispatch cannot disagree about
      // whether the title screen is up; `runSplashAction` then runs the splash's
      // own bound handler. Its boolean return is deliberately ignored (we return
      // regardless), because `Onboarding` mounts the `#splash` element and
      // publishes the action registry as one synchronous operation, and clears
      // both together, so `isSplashUp()` true implies a live registry: the
      // handler always runs, never a dead click. Falling through to the in-game
      // picker on a miss would open the wrong dialog over the title screen, the
      // exact thing #715's round-3 review removed.
      if (isSplashUp()) {
        runSplashAction("new");
        return;
      }
      app.ui.promptNewTower();
      return;
    case "save":
      app.ui.cb.onSave();
      return;
    case "open-saves":
      // The splash's Load Tower opens the load-only picker and routes a founder
      // through the welcome; the in-game one is a different dialog. Same shared
      // `isSplashUp()` decision as New Tower above.
      if (isSplashUp()) {
        runSplashAction("load");
        return;
      }
      app.ui.cb.onShowSaves();
      return;
    case "export":
      // The same UI entry the in-game export control uses: the two-step export
      // choice dialog (.vctower primary, 1994 .TDT legacy). Routed through a UI
      // method like New Tower above, not a bare call, so guard and dispatch stay
      // symmetric. It refuses on the splash via SPLASH_SAFE, so a tower always
      // exists by the time we reach it.
      app.ui.promptExport();
      return;
    case "undo":
      // Through the same callback the toolbar arrow uses. Every other command
      // routes through `cb`, and the moment `onUndo` grows a guard or a tracking
      // call, calling `app.undo()` here would silently diverge from the button.
      app.ui.cb.onUndo();
      return;
    case "redo":
      app.ui.cb.onRedo();
      return;
    case "stats":
      app.ui.cb.onShowStats();
      return;
    case "help":
      app.ui.showHelp();
      return;
    case "settings":
      app.ui.showSettings();
      return;
    default: {
      // Exhaustiveness guard, and a real one now: no cast, so a value added to
      // `HostCommand` without a case above fails typecheck HERE. Without it, the
      // new command would be reported available, enabled by the shell, and
      // silently do nothing, with typecheck, lint, and the whole suite green.
      const unreachable: never = command;
      // Still reached at runtime if a cast is ever forced past the compiler.
      console.warn(`[platform] Host command "${String(unreachable)}" has no handler`);
      return;
    }
  }
}

/** Every command that would run right now, for a shell that grays out the rest.
 *  Derived from the same guard the dispatch uses, so the two cannot disagree. */
export function availableCommands(app: GameApp): HostCommand[] {
  // Same short-circuit as `refusalFor`: behind the crash screen nothing runs, and
  // saying so without reading the app keeps the crash-path tick from depending on
  // a UI layer that may be the thing that just failed.
  if (isCrashed()) return [];
  const state = readInteractionState(app);
  return [...HANDLED].filter((c) => refusalForState(state, c as HostCommand) === null) as HostCommand[];
}

/** The push closure and the app it reads from. The availability dirty-gate
 *  itself (`lastAvailabilityKey`) lives in `interactionState` now (AD-3, issue
 *  #716): it is keyed over the five chrome sources this module no longer reads
 *  directly, so its home moved with the reads. */
let pushAvailability: ((commands: readonly HostCommand[]) => void) | null = null;
/** The app the push closure reads from, so `tickHostCommands()` stays callable
 *  from any frame-loop or crash-path site without threading it through. */
let boundApp: GameApp | null = null;
/** Idempotence latch for {@link bindHostCommands}. */
let bound = false;

/**
 * Push the availability set to the shell when, and only when, it changes.
 * Polled rather than hooked to every event that could matter (splash mount and
 * dismiss, dialog open and close, the crash screen), because one cheap read of
 * interaction state beats keeping five notification sites correct forever, and a
 * missed hook would be an invisible bug. No shell, or a shell without the optional
 * member, means no work at all.
 *
 * Cost, stated accurately because the previous note here was wrong: one of the
 * three call sites (the frame loop's early return, taken while a choice or update
 * dialog is up) runs at FULL frame rate rather than at the 160 ms pump cadence.
 * That used to mean recomputing `refusalFor` per command, about 24 `getElementById`
 * calls plus 8 `isEditorBusy` calls per frame, while the comment claimed the dirty
 * gate made it "a no-op". It is now one `readInteractionState` per tick: three
 * element lookups (the crash card, the splash, and the modal), two flag reads,
 * and one `isEditorBusy`, then eight pure comparisons. The dirty gate still
 * skips the cross-process call.
 */
export function tickHostCommands(): void {
  if (!pushAvailability || !boundApp) return;
  try {
    const commands = availableCommands(boundApp);
    const key = changeKey(commands);
    if (!availabilityKeyChanged(key)) return;
    pushAvailability(commands);
    commitAvailabilityKey(key);
  } catch (err) {
    // A shell that throws on this must not take the frame loop with it. The key
    // is recorded only AFTER a successful push: marking it delivered first would
    // mean one transient throw (a frame mid-teardown, a contextBridge clone
    // failure) leaves the shell showing a stale set forever, because steady
    // in-game play never changes the set again to re-trigger a push.
    // The RECOMPUTE is inside this try as well as the push. It was outside, which
    // meant a throw from any state source escaped `tickHostCommands` into whichever
    // caller was driving: the frame loop, or the crash handler, where it would have
    // preempted the crash report entirely.
    console.warn("[platform] Command availability push failed:", err);
  }
}

/**
 * Subscribe to the shell's commands, once, at boot. A port without
 * `onHostCommand` (every browser session, and any shell that drives nothing)
 * binds nothing at all.
 *
 * `platform` is injectable so the binding is testable without faking the build
 * mode; production callers pass nothing.
 */
export function bindHostCommands(app: GameApp, platform = getPlatform()): void {
  if (bound) {
    // The contract says "called at most once", and a second call would add a
    // second IPC listener on the shell side with no removal path, so every menu
    // click would run twice: two pickers, two saves, two undos.
    console.warn("[platform] bindHostCommands called twice; ignoring the second call");
    return;
  }
  bound = true;
  boundApp = app;
  // Reading these off the port once, before any await, so a port that swaps its
  // own members later cannot change what was bound.
  const subscribe = platform.onHostCommand;
  const setter = platform.setCommandsAvailable;
  try {
    subscribe?.call(platform, (command) => {
      // A throw here would cross back into the shell's IPC callback, where
      // nothing can handle it. Keep failures inside the game.
      try {
        runHostCommand(app, command);
      } catch (err) {
        console.warn("[platform] Host command failed:", err);
      }
    });
  } catch (err) {
    // A booby-trapped port (a throwing getter that survived the duck check)
    // must not take boot down with it; `isPlatformPort` guards its own reads
    // for exactly this reason and this is the consumption side of it.
    console.warn("[platform] Host command subscription failed:", err);
  }
  if (setter) {
    pushAvailability = (commands) => setter.call(platform, commands);
    resetAvailabilityKey();
    // Best effort, then retried. If a shell's setter throws on this very first
    // call the opening state does not land, but `lastAvailabilityKey` stays null
    // (it only advances after a successful push), so the next pump tick about
    // 160 ms later publishes whatever the set is then. That recovery is the
    // intended behavior; this call is not a guarantee.
    tickHostCommands();
  }
  // The quit-time flush (story D6). The handler is the same splash-guarded
  // SYNCHRONOUS flush the update path uses, but the failure posture inverts:
  // saveBeforeUpdate THROWS so its caller can refuse the reload, while at
  // quit there is no "decline", so a failure is swallowed (quit proceeds,
  // the store never clobbers on failure, the previous autosave is intact)
  // and logged, because a permanently failing quit flush must not be
  // invisible forever. Synchronous is the contract: the shell observes the
  // flush as the writeSync arriving on its own channel before this handler
  // returns, so nothing here may defer the save.
  const flushSubscribe = platform.onFlushRequest;
  try {
    flushSubscribe?.call(platform, () => {
      try {
        app.saveLoad.saveBeforeUpdate();
      } catch (err) {
        console.error("[platform] Quit-time flush failed; the previous autosave is intact:", err);
      }
    });
  } catch (err) {
    console.warn("[platform] Flush-request subscription failed:", err);
  }
}

/** Test-only reset of the module's push state. The availability dirty-gate is
 *  owned by `interactionState`, so clear it there too. */
export function __resetHostCommandsForTest(): void {
  pushAvailability = null;
  resetAvailabilityKey();
  boundApp = null;
  bound = false;
}
