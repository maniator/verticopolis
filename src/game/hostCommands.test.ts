import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GameApp } from "../main";
import type { PlatformPort, HostCommand } from "../platform/types";
import {
  runHostCommand,
  bindHostCommands,
  availableCommands,
  tickHostCommands,
  __resetHostCommandsForTest,
} from "./hostCommands";
import { CRASH_SCREEN_ID } from "../ui/crashScreen";

/**
 * The shell-to-game command seam (`src/platform/types.ts` `onHostCommand`).
 *
 * Two invariants carry the design and both are pinned here: every command lands
 * on the SAME call the in-game control makes (never a synthesized click, never
 * a duplicated code path), and the GAME decides whether a command may run, so a
 * shell never has to model splashes or dialogs. A browser session binds nothing
 * at all.
 */

type Spies = {
  promptNewTower: ReturnType<typeof vi.fn>;
  onSave: ReturnType<typeof vi.fn>;
  onShowSaves: ReturnType<typeof vi.fn>;
  showHelp: ReturnType<typeof vi.fn>;
  showSettings: ReturnType<typeof vi.fn>;
  showStats: ReturnType<typeof vi.fn>;
  undo: ReturnType<typeof vi.fn>;
  redo: ReturnType<typeof vi.fn>;
  announce: ReturnType<typeof vi.fn>;
  toast: ReturnType<typeof vi.fn>;
};

function makeApp(): { app: GameApp; spies: Spies } {
  const spies: Spies = {
    promptNewTower: vi.fn(),
    onSave: vi.fn(),
    onShowSaves: vi.fn(),
    showHelp: vi.fn(),
    showSettings: vi.fn(),
    showStats: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    announce: vi.fn(),
    toast: vi.fn(),
  };
  const app = {
    announce: spies.announce,
    undo: spies.undo,
    redo: spies.redo,
    ui: {
      promptNewTower: spies.promptNewTower,
      showHelp: spies.showHelp,
      showSettings: spies.showSettings,
      toast: spies.toast,
      cb: { onSave: spies.onSave, onShowSaves: spies.onShowSaves, onShowStats: spies.showStats },
    },
  } as unknown as GameApp;
  return { app, spies };
}

/** Every dispatch target, so a refusal case can assert that NOTHING ran rather
 *  than only checking the one command it sent. */
function totalCalls(spies: Spies): number {
  return (
    spies.promptNewTower.mock.calls.length +
    spies.onSave.mock.calls.length +
    spies.onShowSaves.mock.calls.length +
    spies.showHelp.mock.calls.length +
    spies.showSettings.mock.calls.length +
    spies.showStats.mock.calls.length +
    spies.undo.mock.calls.length +
    spies.redo.mock.calls.length
  );
}

const ALL_COMMANDS: HostCommand[] = [
  "new-game",
  "save",
  "open-saves",
  "undo",
  "redo",
  "stats",
  "help",
  "settings",
];

function mountDom(): void {
  document.body.innerHTML = `<dialog id="modal"></dialog>`;
}

/** Open the shared modal the way the guard reads it, and assert the fixture
 *  actually took: a happy-dom quirk that left `.open` false would otherwise
 *  make every refusal assertion below pass vacuously. */
function openModal(): void {
  const dialog = document.getElementById("modal") as HTMLDialogElement;
  dialog.setAttribute("open", "");
  expect(dialog.open).toBe(true);
}

beforeEach(() => {
  mountDom();
  __resetHostCommandsForTest();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  __resetHostCommandsForTest();
});

describe("runHostCommand: each command runs the control's own code path", () => {
  it("new-game opens the same picker the toolbar's New Tower opens", () => {
    const { app, spies } = makeApp();
    runHostCommand(app, "new-game");
    expect(spies.promptNewTower).toHaveBeenCalledOnce();
    expect(totalCalls(spies)).toBe(1);
  });

  it("save runs the quick-save callback", () => {
    const { app, spies } = makeApp();
    runHostCommand(app, "save");
    expect(spies.onSave).toHaveBeenCalledOnce();
    expect(totalCalls(spies)).toBe(1);
  });

  it("open-saves opens the saves picker", () => {
    const { app, spies } = makeApp();
    runHostCommand(app, "open-saves");
    expect(spies.onShowSaves).toHaveBeenCalledOnce();
    expect(totalCalls(spies)).toBe(1);
  });

  it("help and settings open their dialogs", () => {
    const { app, spies } = makeApp();
    runHostCommand(app, "help");
    runHostCommand(app, "settings");
    expect(spies.showHelp).toHaveBeenCalledOnce();
    expect(spies.showSettings).toHaveBeenCalledOnce();
    expect(totalCalls(spies)).toBe(2);
  });

  it("undo and redo run the tower history, the same calls the keyboard makes", () => {
    // Deliberately NOT the menu's own undo role: the shell registers no
    // accelerator for these, so Ctrl+Z still reaches `bindKeys` untouched and
    // keeps yielding to a focused rename field's native text undo.
    const { app, spies } = makeApp();
    runHostCommand(app, "undo");
    runHostCommand(app, "redo");
    expect(spies.undo).toHaveBeenCalledOnce();
    expect(spies.redo).toHaveBeenCalledOnce();
    expect(totalCalls(spies)).toBe(2);
  });

  it("stats opens the statistics dialog", () => {
    const { app, spies } = makeApp();
    runHostCommand(app, "stats");
    expect(spies.showStats).toHaveBeenCalledOnce();
    expect(totalCalls(spies)).toBe(1);
  });

  it("nothing is announced when a command runs", () => {
    const { app, spies } = makeApp();
    for (const command of ALL_COMMANDS) runHostCommand(app, command);
    expect(spies.announce).not.toHaveBeenCalled();
    expect(totalCalls(spies)).toBe(ALL_COMMANDS.length);
  });
});

describe("runHostCommand: the game owns availability, not the shell", () => {
  it("refuses everything behind the crash screen, and says so", () => {
    // The renderer is dead and the tower was already flushed; a Save from a menu
    // would act on a stopped session. bindKeys guards keyboard input identically.
    const { app, spies } = makeApp();
    document.body.insertAdjacentHTML("beforeend", `<dialog id="${CRASH_SCREEN_ID}"></dialog>`);
    for (const command of ALL_COMMANDS) runHostCommand(app, command);
    expect(totalCalls(spies)).toBe(0);
    expect(spies.announce).toHaveBeenCalledTimes(ALL_COMMANDS.length);
    expect(spies.announce).toHaveBeenLastCalledWith("Not available right now");
  });

  it("refuses only the tower-touching commands behind the splash", () => {
    // The splash is a real screen with its own controls, so "the splash is up"
    // is not by itself a reason to refuse. `save` would write the untouched
    // boot tower over a real save; `new-game` and `open-saves` have
    // splash-specific variants (suppressed abandon warning, founder welcome)
    // that routing the in-game version from here would quietly bypass.
    const { app, spies } = makeApp();
    document.body.insertAdjacentHTML("beforeend", '<div id="splash"></div>');
    for (const command of ["new-game", "save", "open-saves"] as const) runHostCommand(app, command);
    expect(totalCalls(spies)).toBe(0);
    expect(spies.announce).toHaveBeenCalledTimes(3);
    expect(spies.announce).toHaveBeenLastCalledWith("Start or load a tower first");
  });

  it("lets Help and Settings through on the splash, because the screen offers them", () => {
    // How to Play is a splash button in its own right. A menu whose Help does
    // nothing on the first screen a player sees reads as a broken menu, and
    // both of these open self-contained dialogs that touch no tower state.
    const { app, spies } = makeApp();
    document.body.insertAdjacentHTML("beforeend", '<div id="splash"></div>');
    runHostCommand(app, "help");
    runHostCommand(app, "settings");
    expect(spies.showHelp).toHaveBeenCalledOnce();
    expect(spies.showSettings).toHaveBeenCalledOnce();
    expect(spies.announce).not.toHaveBeenCalled();
  });

  it("still refuses the splash-safe commands when a dialog is already open", () => {
    // Splash-safe does not mean unconditional: a second dialog would displace
    // the first.
    const { app, spies } = makeApp();
    document.body.insertAdjacentHTML("beforeend", '<div id="splash"></div>');
    openModal();
    runHostCommand(app, "help");
    expect(spies.showHelp).not.toHaveBeenCalled();
    expect(spies.announce).toHaveBeenCalledExactlyOnceWith("Close the open window first");
  });

  it("refuses everything while a dialog is open, and says so", () => {
    // A menu can be reached with a dialog up, which no in-game button can: they
    // sit behind it. A New Tower accepted behind the Saves picker is exactly the
    // failure this guard exists for.
    const { app, spies } = makeApp();
    openModal();
    for (const command of ALL_COMMANDS) runHostCommand(app, command);
    expect(totalCalls(spies)).toBe(0);
    expect(spies.announce).toHaveBeenCalledTimes(ALL_COMMANDS.length);
    expect(spies.announce).toHaveBeenLastCalledWith("Close the open window first");
  });

  it("runs again once the dialog closes", () => {
    const { app, spies } = makeApp();
    const dialog = document.getElementById("modal") as HTMLDialogElement;
    openModal();
    runHostCommand(app, "save");
    expect(totalCalls(spies)).toBe(0);
    dialog.removeAttribute("open");
    expect(dialog.open).toBe(false);
    runHostCommand(app, "save");
    expect(spies.onSave).toHaveBeenCalledOnce();
  });

  it("a refusal is visible as well as announced", () => {
    // Always-enabled menu items are the deliberate design (the shell sends
    // intent, never permission), so a no-op the player cannot perceive is the
    // single worst outcome of it. `announce` alone reaches only assistive
    // technology, so a sighted player would see exactly the nothing they were
    // promised they would not see.
    const { app, spies } = makeApp();
    document.body.insertAdjacentHTML("beforeend", '<div id="splash"></div>');
    runHostCommand(app, "save");
    expect(spies.announce).toHaveBeenCalledOnce();
    expect(spies.toast).toHaveBeenCalledOnce();
    expect(String(spies.toast.mock.calls[0][0]).length).toBeGreaterThan(0);
    // Same wording on both surfaces, so a support report and a screen reader
    // describe the same thing.
    expect(spies.toast.mock.calls[0][0]).toBe(spies.announce.mock.calls[0][0]);
  });
});

describe("runHostCommand: input from another repository is untrusted", () => {
  it("ignores a command outside the contract and tells the shell author", () => {
    const { app, spies } = makeApp();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    runHostCommand(app, "quit");
    runHostCommand(app, "");
    runHostCommand(app, "__proto__");
    expect(totalCalls(spies)).toBe(0);
    expect(spies.announce).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("checks the command before the guards, so an unknown value is inert rather than announced", () => {
    // An unknown command is a shell bug in every game state. Announcing "Not
    // available yet" for it would send the shell author hunting the wrong thing.
    const { app, spies } = makeApp();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    document.body.insertAdjacentHTML("beforeend", '<div id="splash"></div>');
    runHostCommand(app, "nonsense");
    expect(spies.announce).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("availability: the game tells the shell what to gray out", () => {
  it("reports every command in a normal in-game state", () => {
    const { app } = makeApp();
    void app;
    expect(availableCommands().sort()).toEqual([...ALL_COMMANDS].sort());
  });

  it("reports only the splash-safe commands on the splash", () => {
    document.body.insertAdjacentHTML("beforeend", '<div id="splash"></div>');
    expect(availableCommands().sort()).toEqual(["help", "settings"]);
  });

  it("reports nothing behind the crash screen or an open dialog", () => {
    openModal();
    expect(availableCommands()).toEqual([]);
    document.body.innerHTML = `<dialog id="${CRASH_SCREEN_ID}"></dialog>`;
    expect(availableCommands()).toEqual([]);
  });

  it("never reports a command the dispatch would refuse", () => {
    // The two must be derived from one guard. If they drift, the shell offers an
    // enabled item that is then refused, which is the exact confusion the
    // graying-out exists to remove.
    const { app, spies } = makeApp();
    document.body.insertAdjacentHTML("beforeend", '<div id="splash"></div>');
    for (const command of availableCommands()) {
      spies.announce.mockClear();
      runHostCommand(app, command);
      expect(spies.announce, `${command} was reported available but refused`).not.toHaveBeenCalled();
    }
  });

  it("pushes on bind and then only when the set actually changes", () => {
    const setCommandsAvailable = vi.fn();
    const { app } = makeApp();
    document.body.insertAdjacentHTML("beforeend", '<div id="splash"></div>');
    bindHostCommands(app, {
      isNativeWrapper: true,
      saveFile: () => Promise.resolve(),
      openExternal: () => {},
      setCommandsAvailable,
    });
    expect(setCommandsAvailable).toHaveBeenCalledOnce();
    expect(setCommandsAvailable.mock.calls[0][0].sort()).toEqual(["help", "settings"]);

    // A tick with nothing changed must not cross the process boundary again:
    // this runs on the ~6 Hz pump, so an unguarded push would be constant IPC.
    tickHostCommands();
    tickHostCommands();
    expect(setCommandsAvailable).toHaveBeenCalledOnce();

    // Leaving the splash changes the set, so exactly one more push.
    document.getElementById("splash")?.remove();
    tickHostCommands();
    expect(setCommandsAvailable).toHaveBeenCalledTimes(2);
    expect(setCommandsAvailable.mock.calls[1][0].sort()).toEqual([...ALL_COMMANDS].sort());
    tickHostCommands();
    expect(setCommandsAvailable).toHaveBeenCalledTimes(2);
  });

  it("does nothing at all without a shell that can gray items out", () => {
    // Every browser session, and any shell that omits the optional member.
    const { app } = makeApp();
    bindHostCommands(app, {
      isNativeWrapper: true,
      saveFile: () => Promise.resolve(),
      openExternal: () => {},
    });
    expect(() => tickHostCommands()).not.toThrow();
  });

  it("a throwing shell cannot take the frame loop down with it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { app } = makeApp();
    bindHostCommands(app, {
      isNativeWrapper: true,
      saveFile: () => Promise.resolve(),
      openExternal: () => {},
      setCommandsAvailable: () => {
        throw new Error("ipc gone");
      },
    });
    expect(warn).toHaveBeenCalled();
    document.body.insertAdjacentHTML("beforeend", '<div id="splash"></div>');
    expect(() => tickHostCommands()).not.toThrow();
  });
});

describe("bindHostCommands: inert in the browser, live in a shell", () => {
  const basePort = (): PlatformPort => ({
    isNativeWrapper: true,
    saveFile: () => Promise.resolve(),
    openExternal: () => {},
  });

  it("binds nothing when the port has no command channel", () => {
    // Every browser session, and any shell that drives nothing. The optional
    // call must not throw on the three-member contract.
    const { app, spies } = makeApp();
    expect(() => bindHostCommands(app, basePort())).not.toThrow();
    expect(totalCalls(spies)).toBe(0);
  });

  it("subscribes exactly once and routes what it receives", () => {
    const { app, spies } = makeApp();
    let deliver: ((command: HostCommand) => void) | undefined;
    const onHostCommand = vi.fn((handler: (command: HostCommand) => void) => {
      deliver = handler;
    });
    bindHostCommands(app, { ...basePort(), onHostCommand });
    expect(onHostCommand).toHaveBeenCalledOnce();
    expect(deliver).toBeTypeOf("function");
    deliver?.("help");
    expect(spies.showHelp).toHaveBeenCalledOnce();
  });

  it("keeps a failure inside the game rather than throwing into the shell's IPC callback", () => {
    // The handler runs on the far side of a process boundary, where nothing can
    // catch it; an escaping throw would surface as an unhandled error in the
    // shell's own event loop.
    const { app, spies } = makeApp();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    spies.showHelp.mockImplementation(() => {
      throw new Error("dialog exploded");
    });
    let deliver: ((command: HostCommand) => void) | undefined;
    bindHostCommands(app, {
      ...basePort(),
      onHostCommand: (handler) => {
        deliver = handler;
      },
    });
    expect(() => deliver?.("help")).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
  });
});
