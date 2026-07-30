import type { GameApp } from "../main";
import type { HostCommand } from "../platform/types";
import { getPlatform } from "../platform";
import { CRASH_SCREEN_ID } from "../ui/crashScreen";

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
const HANDLED: ReadonlySet<string> = new Set<HostCommand>([
  "new-game",
  "save",
  "open-saves",
  "undo",
  "redo",
  "stats",
  "help",
  "settings",
]);

/**
 * Commands that are safe while the title screen is up.
 *
 * The splash is a real screen with its own controls (Continue, Load Tower, New
 * Tower, How to Play), so "the splash is up" is not by itself a reason to
 * refuse. These two open self-contained dialogs that touch no tower state, and
 * How to Play is already a splash button, so a player who opens Help from the
 * menu there gets exactly what the screen in front of them offers.
 *
 * The other three stay refused, each for its own reason rather than a blanket
 * one. `save` would write the untouched boot tower over a real save. `new-game`
 * and `open-saves` have splash-specific variants (the picker's abandon warning
 * is suppressed when there is nothing to abandon, and Load Tower routes through
 * the founder welcome), and routing the in-game version from here would quietly
 * give the player the wrong one.
 */
const SPLASH_SAFE: ReadonlySet<string> = new Set<HostCommand>(["help", "settings"]);

/** A refusal: the reason, and whether the player can actually be told. */
interface Refusal {
  reason: string;
  /** False behind the crash screen. That card is a `showModal()` dialog, so the
   *  page behind it is inert and the toast rail paints under its backdrop; there
   *  is nowhere to put a notice. The card itself is the message, so this path
   *  refuses in silence rather than pretending to speak. */
  speakable: boolean;
}

/** Why a command was refused, or null when it may run. Split out so the guard
 *  order is readable and testable on its own. */
function refusalFor(app: GameApp, command: HostCommand): Refusal | null {
  // The crash screen owns everything while it is up: the renderer is dead and
  // the tower was already flushed, so a Save from the menu would be acting on a
  // session that has stopped. `bindKeys` guards keyboard input the same way and
  // for the same reason.
  if (document.getElementById(CRASH_SCREEN_ID)) {
    return { reason: "Not available right now", speakable: false };
  }
  if (document.getElementById("splash") && !SPLASH_SAFE.has(command)) {
    return { reason: "Start or load a tower first", speakable: true };
  }
  // A menu can be reached while a dialog is open, which no in-game button can:
  // they sit behind it. Opening a second dialog would displace the first, and a
  // New Tower accepted behind a choice-bearing dialog is the kind of thing a
  // player never sees coming.
  if ((document.getElementById("modal") as HTMLDialogElement | null)?.open) {
    return { reason: "Close the open window first", speakable: true };
  }
  // A live press inside the editor card. The frame loop declines even a stats
  // refresh in this state so the card cannot move under the pointer; opening a
  // dialog out from under the press is the louder version of the same problem.
  if (app.ui.isEditorBusy() && OPENS_A_DIALOG.has(command)) {
    return { reason: "Finish what you are doing first", speakable: true };
  }
  return null;
}

/** Commands that put something new on screen, so an in-flight editor press
 *  matters. `save`, `undo`, and `redo` do not displace anything. */
const OPENS_A_DIALOG: ReadonlySet<string> = new Set<HostCommand>([
  "new-game",
  "open-saves",
  "stats",
  "help",
  "settings",
]);

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
  const refusal = refusalFor(app, command as HostCommand);
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
  switch (command as HostCommand) {
    case "new-game":
      // The same picker the toolbar's New Tower opens, including its fold-in
      // abandon warning: a menu item must not be a shortcut past a confirmation
      // the button shows.
      app.ui.promptNewTower();
      return;
    case "save":
      app.ui.cb.onSave();
      return;
    case "open-saves":
      app.ui.cb.onShowSaves();
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
      // Exhaustiveness guard. Adding a value to HostCommand and to HANDLED while
      // forgetting the case above would otherwise produce a menu item that is
      // reported available, enabled by the shell, and silently does nothing,
      // with typecheck, lint, and the whole suite still green.
      const unreachable: never = command as never;
      console.warn(`[platform] Host command "${String(unreachable)}" has no handler`);
      return;
    }
  }
}

/** Every command that would run right now, for a shell that grays out the rest.
 *  Derived from the same guard the dispatch uses, so the two cannot disagree. */
export function availableCommands(app: GameApp): HostCommand[] {
  return [...HANDLED].filter((c) => refusalFor(app, c as HostCommand) === null) as HostCommand[];
}

/** The availability set as a comparable key, so the tick below can skip the
 *  cross-process call unless something actually changed. Mirrors the dirty-gate
 *  idiom the palette scan already uses (`UI.paletteScanKey`). */
let lastAvailabilityKey: string | null = null;
let pushAvailability: ((commands: readonly HostCommand[]) => void) | null = null;
/** The app the push closure reads from, so `tickHostCommands()` stays callable
 *  from any frame-loop or crash-path site without threading it through. */
let boundApp: GameApp | null = null;
/** Idempotence latch for {@link bindHostCommands}. */
let bound = false;

/**
 * Push the availability set to the shell when, and only when, it changes.
 * Called from the ~6 Hz UI pump rather than hooked to every event that could
 * matter (splash mount and dismiss, dialog open and close, the crash screen),
 * because recomputing three DOM lookups is cheaper than keeping five
 * notification sites correct forever, and a missed hook would be an invisible
 * bug. No shell, or a shell without the optional member, means no work at all.
 */
export function tickHostCommands(): void {
  if (!pushAvailability || !boundApp) return;
  const commands = availableCommands(boundApp);
  const key = commands.join(",");
  if (key === lastAvailabilityKey) return;
  try {
    pushAvailability(commands);
  } catch (err) {
    // A shell that throws on this must not take the frame loop with it. The key
    // is recorded only AFTER a successful push: marking it delivered first would
    // mean one transient throw (a frame mid-teardown, a contextBridge clone
    // failure) leaves the shell showing a stale set forever, because steady
    // in-game play never changes the set again to re-trigger a push.
    console.warn("[platform] Command availability push failed:", err);
    return;
  }
  lastAvailabilityKey = key;
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
    lastAvailabilityKey = null;
    tickHostCommands(); // publish the opening state before the first frame
  }
}

/** Test-only reset of the module's push state. */
export function __resetHostCommandsForTest(): void {
  pushAvailability = null;
  lastAvailabilityKey = null;
  boundApp = null;
  bound = false;
}
