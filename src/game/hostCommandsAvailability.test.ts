import { describe, it, expect, vi } from "vitest";
import { runHostCommand, bindHostCommands, availableCommands, tickHostCommands } from "./hostCommands";
import { CRASH_SCREEN_ID } from "../ui/crashScreen";
import type { HostCommand } from "../platform/types";
import { setLiveSplashActions } from "../ui/splashActions";
import {
  type Spies,
  makeApp,
  totalCalls,
  totalDispatch,
  ALL_COMMANDS,
  mountDom,
  mountSplash,
  unmountSplash,
  openModal,
  basePort,
  installSeamHooks,
} from "./hostCommands.fixture";

/**
 * The shell-to-game command seam: AVAILABILITY, BINDING, and the PUMP.
 *
 * The invariant this file carries is that the availability set the shell is told
 * can never disagree with what the dispatch would actually do, because the two
 * derive from one guard. If they drift, the shell offers an enabled item that is
 * then refused, which is the confusion the graying exists to remove. Dispatch and
 * the guards themselves are in `hostCommands.test.ts`.
 */

installSeamHooks();

describe("availability: the game tells the shell what to gray out", () => {
  it("reports every command in a normal in-game state", () => {
    const { app } = makeApp();
    expect(availableCommands(app).sort()).toEqual([...ALL_COMMANDS].sort());
  });

  it("reports the splash-safe commands on the splash, New Tower and Load Tower included", () => {
    const { app, spies } = makeApp();
    mountSplash(spies);
    expect(availableCommands(app).sort()).toEqual(["help", "new-game", "open-saves", "settings"]);
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
    // Each state carries how many commands it must still report, because the
    // assertions below live inside `for (const command of availableCommands(app))`
    // and an empty list silently contributes ZERO assertions. Two of these three
    // states report nothing, so without the count this loop was vacuous for them
    // and only the splash case did any work.
    //
    // "editor busy" is the important addition: it is the only state with
    // PER-COMMAND asymmetry (`OPENS_A_DIALOG`), so it is the only one where
    // availability and dispatch could realistically disagree about one command
    // while agreeing about the rest.
    const states: Array<[string, (s: Spies) => void, number]> = [
      ["splash", (s) => mountSplash(s), 4],
      ["editor busy", (s) => s.isEditorBusy.mockReturnValue(true), 3],
      ["open dialog", () => openModal(), 0],
      ["crash screen", () => document.body.insertAdjacentHTML("beforeend", `<dialog id="${CRASH_SCREEN_ID}"></dialog>`), 0],
    ];
    for (const [label, enter, expectedCount] of states) {
      mountDom();
      setLiveSplashActions(null);
      const { app, spies } = makeApp();
      enter(spies);
      const reported = availableCommands(app);
      expect(reported.length, `${label} should report ${expectedCount} commands`).toBe(expectedCount);
      for (const command of reported) {
        spies.sayVisibly.mockClear();
        const before = totalDispatch(spies);
        runHostCommand(app, command);
        expect(spies.sayVisibly, `${command} reported available but refused during ${label}`).not.toHaveBeenCalled();
        // The wider count, because on the splash New Tower and Load Tower land on
        // the title screen's own buttons rather than on an in-game target.
        expect(totalDispatch(spies), `${command} reported available but did nothing during ${label}`).toBe(before + 1);
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
    const { app, spies } = makeApp();
    mountSplash(spies);
    bindHostCommands(app, { ...basePort(), setCommandsAvailable });
    expect(setCommandsAvailable).toHaveBeenCalledOnce();
    expect([...setCommandsAvailable.mock.calls[0][0]].sort()).toEqual(["help", "new-game", "open-saves", "settings"]);

    // A tick with nothing changed must not cross the process boundary again:
    // this runs on the ~6 Hz pump, so an unguarded push would be constant IPC.
    tickHostCommands();
    tickHostCommands();
    expect(setCommandsAvailable).toHaveBeenCalledOnce();

    unmountSplash();
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

// The "availability pump is independent of sim speed" suite used to live here.
// It claimed to pin that the ~6 Hz pump gate sits OUTSIDE the sim-advance loop, so
// a paused tower still updates the shell menu, and then never called `runFrame`.
// Three review rounds flagged it. It has moved to `hostCommandsWiring.test.ts`,
// where it drives the real `runFrame` with `IS_WRAPPED_BUILD` mocked true and
// asserts the sim did not advance, which is what the claim always required.
