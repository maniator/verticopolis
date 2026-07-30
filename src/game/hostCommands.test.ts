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
 * Three invariants carry the design and all three are pinned here: every command
 * lands on the SAME call the in-game control makes (never a synthesized click,
 * never a duplicated path), the GAME decides whether a command may run, and the
 * availability the shell is told must never disagree with what the dispatch
 * would actually do. A browser session binds nothing at all.
 */

type Spies = Record<
  | "promptNewTower"
  | "onSave"
  | "onShowSaves"
  | "onShowStats"
  | "onUndo"
  | "onRedo"
  | "showHelp"
  | "showSettings"
  | "sayVisibly"
  | "isEditorBusy",
  ReturnType<typeof vi.fn>
>;

function makeApp(): { app: GameApp; spies: Spies } {
  const spies: Spies = {
    promptNewTower: vi.fn(),
    onSave: vi.fn(),
    onShowSaves: vi.fn(),
    onShowStats: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    showHelp: vi.fn(),
    showSettings: vi.fn(),
    sayVisibly: vi.fn(),
    isEditorBusy: vi.fn(() => false),
  };
  const app = {
    ui: {
      promptNewTower: spies.promptNewTower,
      showHelp: spies.showHelp,
      showSettings: spies.showSettings,
      sayVisibly: spies.sayVisibly,
      isEditorBusy: spies.isEditorBusy,
      cb: {
        onSave: spies.onSave,
        onShowSaves: spies.onShowSaves,
        onShowStats: spies.onShowStats,
        onUndo: spies.onUndo,
        onRedo: spies.onRedo,
      },
    },
  } as unknown as GameApp;
  return { app, spies };
}

/** Every dispatch target, so a refusal case can assert that NOTHING ran rather
 *  than only checking the one command it sent. */
const TARGETS = [
  "promptNewTower",
  "onSave",
  "onShowSaves",
  "onShowStats",
  "onUndo",
  "onRedo",
  "showHelp",
  "showSettings",
] as const;
const totalCalls = (s: Spies) => TARGETS.reduce((n, k) => n + s[k].mock.calls.length, 0);

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

const mountDom = () => {
  document.body.innerHTML = `<dialog id="modal"></dialog>`;
};

/** Open the shared modal the way the guard reads it, and assert the fixture took:
 *  a happy-dom quirk leaving `.open` false would make every refusal below pass
 *  vacuously. */
function openModal(): void {
  const dialog = document.getElementById("modal") as HTMLDialogElement;
  dialog.setAttribute("open", "");
  expect(dialog.open).toBe(true);
}

const basePort = (): PlatformPort => ({
  isNativeWrapper: true,
  saveFile: () => Promise.resolve(),
  openExternal: () => {},
});

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
  it.each([
    ["new-game", "promptNewTower"],
    ["save", "onSave"],
    ["open-saves", "onShowSaves"],
    ["undo", "onUndo"],
    ["redo", "onRedo"],
    ["stats", "onShowStats"],
    ["help", "showHelp"],
    ["settings", "showSettings"],
  ] as const)("%s dispatches to %s and nothing else", (command, target) => {
    const { app, spies } = makeApp();
    runHostCommand(app, command);
    expect(spies[target]).toHaveBeenCalledOnce();
    expect(totalCalls(spies)).toBe(1);
  });

  it("undo and redo go through the callbacks the toolbar arrows use", () => {
    // Not `app.undo()` directly. Every other command routes through `cb`, and the
    // moment `onUndo` grows a guard or a tracking call, a direct call here would
    // silently diverge from the button. Pinned by asserting the cb spies, which
    // are the only undo path this fake app exposes.
    const { app, spies } = makeApp();
    runHostCommand(app, "undo");
    runHostCommand(app, "redo");
    expect(spies.onUndo).toHaveBeenCalledOnce();
    expect(spies.onRedo).toHaveBeenCalledOnce();
  });

  it("says nothing when a command runs", () => {
    const { app, spies } = makeApp();
    for (const command of ALL_COMMANDS) runHostCommand(app, command);
    expect(spies.sayVisibly).not.toHaveBeenCalled();
    expect(totalCalls(spies)).toBe(ALL_COMMANDS.length);
  });
});

describe("runHostCommand: the game owns availability, not the shell", () => {
  it("refuses everything behind the crash screen, and deliberately says nothing", () => {
    // The card is a showModal() dialog, so the page behind it is inert and the
    // toast rail paints under its backdrop. There is nowhere to put a notice, and
    // the card itself is the message, so this path must not pretend to speak.
    const { app, spies } = makeApp();
    document.body.insertAdjacentHTML("beforeend", `<dialog id="${CRASH_SCREEN_ID}"></dialog>`);
    for (const command of ALL_COMMANDS) runHostCommand(app, command);
    expect(totalCalls(spies)).toBe(0);
    expect(spies.sayVisibly).not.toHaveBeenCalled();
  });

  it("refuses only the tower-touching commands behind the splash", () => {
    const { app, spies } = makeApp();
    document.body.insertAdjacentHTML("beforeend", '<div id="splash"></div>');
    for (const command of ["new-game", "save", "open-saves", "undo", "redo", "stats"] as const) {
      runHostCommand(app, command);
    }
    expect(totalCalls(spies)).toBe(0);
    expect(spies.sayVisibly).toHaveBeenCalledTimes(6);
    expect(spies.sayVisibly).toHaveBeenLastCalledWith("Start or load a tower first", "info");
  });

  it("lets Help and Settings through on the splash, because the screen offers them", () => {
    const { app, spies } = makeApp();
    document.body.insertAdjacentHTML("beforeend", '<div id="splash"></div>');
    runHostCommand(app, "help");
    runHostCommand(app, "settings");
    expect(spies.showHelp).toHaveBeenCalledOnce();
    expect(spies.showSettings).toHaveBeenCalledOnce();
    expect(spies.sayVisibly).not.toHaveBeenCalled();
  });

  it("refuses everything while a dialog is open, and routes the line into it", () => {
    // `sayVisibly` is the point: a <dialog> paints over the toast rail at any
    // z-index, so a plain toast from here would be announced to nobody (GH #658).
    const { app, spies } = makeApp();
    openModal();
    for (const command of ALL_COMMANDS) runHostCommand(app, command);
    expect(totalCalls(spies)).toBe(0);
    expect(spies.sayVisibly).toHaveBeenCalledTimes(ALL_COMMANDS.length);
    expect(spies.sayVisibly).toHaveBeenLastCalledWith("Close the open window first", "info");
  });

  it("refuses a dialog-opening command during a live editor press, but not save or undo", () => {
    // The frame loop declines even a stats refresh while a press is in flight so
    // the card cannot move under the pointer; opening a dialog out from under it
    // is the louder version. Save, undo, and redo displace nothing.
    const { app, spies } = makeApp();
    spies.isEditorBusy.mockReturnValue(true);
    for (const command of ["new-game", "open-saves", "stats", "help", "settings"] as const) {
      runHostCommand(app, command);
    }
    expect(totalCalls(spies)).toBe(0);
    expect(spies.sayVisibly).toHaveBeenCalledTimes(5);
    runHostCommand(app, "save");
    runHostCommand(app, "undo");
    expect(spies.onSave).toHaveBeenCalledOnce();
    expect(spies.onUndo).toHaveBeenCalledOnce();
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
});

describe("runHostCommand: input from another repository is untrusted", () => {
  it("ignores a command outside the contract and tells the shell author", () => {
    const { app, spies } = makeApp();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const bad of ["quit", "", "__proto__", "toString"]) runHostCommand(app, bad);
    expect(totalCalls(spies)).toBe(0);
    expect(spies.sayVisibly).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it("checks the command before the guards, so an unknown value is inert rather than refused", () => {
    const { app, spies } = makeApp();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    document.body.insertAdjacentHTML("beforeend", '<div id="splash"></div>');
    runHostCommand(app, "nonsense");
    expect(spies.sayVisibly).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("every handled command has a dispatch arm", () => {
    // The exhaustiveness guard's runtime half. Adding a value to HostCommand and
    // to HANDLED while forgetting the switch case would otherwise produce a menu
    // item that is reported available, enabled by the shell, and silently does
    // nothing, with typecheck and lint both green.
    const { app, spies } = makeApp();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const command of availableCommands(app)) {
      const before = totalCalls(spies);
      runHostCommand(app, command);
      expect(totalCalls(spies), `${command} reached no handler`).toBe(before + 1);
    }
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("availability: the game tells the shell what to gray out", () => {
  it("reports every command in a normal in-game state", () => {
    const { app } = makeApp();
    expect(availableCommands(app).sort()).toEqual([...ALL_COMMANDS].sort());
  });

  it("reports only the splash-safe commands on the splash", () => {
    const { app } = makeApp();
    document.body.insertAdjacentHTML("beforeend", '<div id="splash"></div>');
    expect(availableCommands(app).sort()).toEqual(["help", "settings"]);
  });

  it("reports nothing behind an open dialog or the crash screen", () => {
    const { app } = makeApp();
    openModal();
    expect(availableCommands(app)).toEqual([]);
    document.body.innerHTML = `<dialog id="${CRASH_SCREEN_ID}"></dialog>`;
    expect(availableCommands(app)).toEqual([]);
  });

  it("never reports a command the dispatch would refuse, in any guarded state", () => {
    // The two must derive from one guard. If they drift, the shell offers an
    // enabled item that is then refused, which is the exact confusion the graying
    // exists to remove.
    const states: Array<[string, () => void]> = [
      ["splash", () => document.body.insertAdjacentHTML("beforeend", '<div id="splash"></div>')],
      ["open dialog", openModal],
      ["crash screen", () => document.body.insertAdjacentHTML("beforeend", `<dialog id="${CRASH_SCREEN_ID}"></dialog>`)],
    ];
    for (const [label, enter] of states) {
      mountDom();
      const { app, spies } = makeApp();
      enter();
      for (const command of availableCommands(app)) {
        spies.sayVisibly.mockClear();
        const before = totalCalls(spies);
        runHostCommand(app, command);
        expect(spies.sayVisibly, `${command} reported available but refused during ${label}`).not.toHaveBeenCalled();
        expect(totalCalls(spies), `${command} reported available but did nothing during ${label}`).toBe(before + 1);
      }
    }
  });

  it("also reports correctly during a live editor press", () => {
    const { app, spies } = makeApp();
    spies.isEditorBusy.mockReturnValue(true);
    expect(availableCommands(app).sort()).toEqual(["redo", "save", "undo"]);
  });

  it("pushes on bind and then only when the set actually changes", () => {
    const setCommandsAvailable = vi.fn();
    const { app } = makeApp();
    document.body.insertAdjacentHTML("beforeend", '<div id="splash"></div>');
    bindHostCommands(app, { ...basePort(), setCommandsAvailable });
    expect(setCommandsAvailable).toHaveBeenCalledOnce();
    expect([...setCommandsAvailable.mock.calls[0][0]].sort()).toEqual(["help", "settings"]);

    // A tick with nothing changed must not cross the process boundary again:
    // this runs on the ~6 Hz pump, so an unguarded push would be constant IPC.
    tickHostCommands();
    tickHostCommands();
    expect(setCommandsAvailable).toHaveBeenCalledOnce();

    document.getElementById("splash")?.remove();
    tickHostCommands();
    expect(setCommandsAvailable).toHaveBeenCalledTimes(2);
    expect([...setCommandsAvailable.mock.calls[1][0]].sort()).toEqual([...ALL_COMMANDS].sort());
    tickHostCommands();
    expect(setCommandsAvailable).toHaveBeenCalledTimes(2);
  });

  it("a failed push is retried rather than recorded as delivered", () => {
    // The dirty gate must not be poisoned by a transient throw. Marking the key
    // delivered before the push meant one failure left the shell showing a stale
    // set for the rest of the session, because steady play never changes the set
    // again to re-trigger a push.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let failNext = true;
    const setCommandsAvailable = vi.fn(() => {
      if (failNext) {
        failNext = false;
        throw new Error("ipc gone");
      }
    });
    const { app } = makeApp();
    bindHostCommands(app, { ...basePort(), setCommandsAvailable });
    expect(setCommandsAvailable).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalled();

    // Same state, so a healthy dirty gate would skip. It must retry instead,
    // because the previous push never landed.
    tickHostCommands();
    expect(setCommandsAvailable).toHaveBeenCalledTimes(2);
    // Now it succeeded, so the gate closes.
    tickHostCommands();
    expect(setCommandsAvailable).toHaveBeenCalledTimes(2);
  });

  it("does nothing at all without a shell that can gray items out", () => {
    const { app } = makeApp();
    bindHostCommands(app, basePort());
    expect(() => tickHostCommands()).not.toThrow();
  });
});

describe("bindHostCommands: inert in the browser, live in a shell", () => {
  it("binds nothing when the port has no command channel", () => {
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
    deliver?.("help");
    expect(spies.showHelp).toHaveBeenCalledOnce();
  });

  it("refuses a second bind, so no command can run twice", () => {
    // The shell side registers an ipcRenderer listener per call with no removal
    // path, so a second bind would mean two pickers, two saves, two undos.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { app } = makeApp();
    const onHostCommand = vi.fn();
    bindHostCommands(app, { ...basePort(), onHostCommand });
    bindHostCommands(app, { ...basePort(), onHostCommand });
    expect(onHostCommand).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("survives a port whose member throws on read, instead of dying in boot", () => {
    // `isPlatformPort` guards its own reads for this reason; this is the
    // consumption side, which runs inside runBootFlow.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { app } = makeApp();
    const trapped = {
      ...basePort(),
      onHostCommand: () => {
        throw new Error("revoked");
      },
    };
    expect(() => bindHostCommands(app, trapped)).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });

  it("keeps a failure inside the game rather than throwing into the shell's IPC callback", () => {
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

describe("the availability pump is independent of sim speed", () => {
  it("still publishes while the tower is paused", () => {
    // Non-obvious and worth pinning. The ~6 Hz UI pump in `runFrame` is
    // wall-clock gated (`now - app.lastUiUpdate > 160`) and that gate sits
    // OUTSIDE the `minutesPerSecond` sim-advance loop, so a paused tower
    // (SPEEDS[0]) still reaches this call and the shell menu keeps updating.
    //
    // If the gate ever moved inside the advance loop, a paused game would freeze
    // the desktop menu's enabled state, which is exactly the kind of regression
    // nobody would notice until a player paused and wondered why New Game had
    // gone gray. This asserts the property `tickHostCommands` depends on: it is
    // driven purely by DOM state, never by the clock or the speed.
    const setCommandsAvailable = vi.fn();
    const { app } = makeApp();
    document.body.insertAdjacentHTML("beforeend", '<div id="splash"></div>');
    bindHostCommands(app, { ...basePort(), setCommandsAvailable });
    expect([...setCommandsAvailable.mock.calls[0][0]].sort()).toEqual(["help", "settings"]);

    // Leave the splash with no clock advancing at all: no timers, no frames, no
    // sim state touched. The next tick must still see the change and publish.
    document.getElementById("splash")?.remove();
    tickHostCommands();
    expect(setCommandsAvailable).toHaveBeenCalledTimes(2);
    expect([...setCommandsAvailable.mock.calls[1][0]].sort()).toEqual([...ALL_COMMANDS].sort());
  });
});
