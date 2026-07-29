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
 * web, Android, and iOS builds, and would strand players on a controller, on a
 * Steam Deck, or in Big Picture, none of whom can reach a menu bar.
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

/** Why a command was refused, or null when it may run. Split out so the guard
 *  order is readable and testable on its own. */
function refusalFor(command: HostCommand): string | null {
  // The crash screen owns everything while it is up: the renderer is dead and
  // the tower was already flushed, so a Save from the menu would be acting on a
  // session that has stopped. `bindKeys` guards keyboard input the same way and
  // for the same reason.
  if (document.getElementById(CRASH_SCREEN_ID)) return "Not available right now";
  if (document.getElementById("splash") && !SPLASH_SAFE.has(command)) {
    return "Start or load a tower first";
  }
  // A menu can be reached while a dialog is open, which no in-game button can:
  // they sit behind it. Opening a second dialog would displace the first, and a
  // New Tower accepted behind a choice-bearing dialog is the kind of thing a
  // player never sees coming.
  if ((document.getElementById("modal") as HTMLDialogElement | null)?.open) {
    return "Close the open window first";
  }
  return null;
}

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
  const refusal = refusalFor(command as HostCommand);
  if (refusal) {
    // Both surfaces, on purpose. A menu item that appears to do nothing is the
    // single worst outcome of the always-enabled design, and `announce` alone
    // reaches only assistive technology, so a sighted player would see exactly
    // the nothing they were promised they would not see.
    app.announce(refusal);
    app.ui.toast(refusal, "info");
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
      app.undo();
      return;
    case "redo":
      app.redo();
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
  }
}

/** Every command that would run right now, for a shell that grays out the rest.
 *  Derived from the same guard the dispatch uses, so the two cannot disagree. */
export function availableCommands(): HostCommand[] {
  return [...HANDLED].filter((c) => refusalFor(c as HostCommand) === null) as HostCommand[];
}

/** The availability set as a comparable key, so the tick below can skip the
 *  cross-process call unless something actually changed. Mirrors the dirty-gate
 *  idiom the palette scan already uses (`UI.paletteScanKey`). */
let lastAvailabilityKey: string | null = null;
let pushAvailability: ((commands: readonly HostCommand[]) => void) | null = null;

/**
 * Push the availability set to the shell when, and only when, it changes.
 * Called from the ~6 Hz UI pump rather than hooked to every event that could
 * matter (splash mount and dismiss, dialog open and close, the crash screen),
 * because recomputing three DOM lookups is cheaper than keeping five
 * notification sites correct forever, and a missed hook would be an invisible
 * bug. No shell, or a shell without the optional member, means no work at all.
 */
export function tickHostCommands(): void {
  if (!pushAvailability) return;
  const commands = availableCommands();
  const key = commands.join(",");
  if (key === lastAvailabilityKey) return;
  lastAvailabilityKey = key;
  try {
    pushAvailability(commands);
  } catch (err) {
    // A shell that throws on this must not take the frame loop with it.
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
  platform.onHostCommand?.((command) => {
    // A throw here would cross back into the shell's IPC callback, where
    // nothing can handle it. Keep failures inside the game.
    try {
      runHostCommand(app, command);
    } catch (err) {
      console.warn("[platform] Host command failed:", err);
    }
  });
  const setter = platform.setCommandsAvailable;
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
}
