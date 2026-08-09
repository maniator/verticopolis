import { describe, it, expect, vi } from "vitest";
import { runHostCommand, availableCommands } from "./hostCommands";
import { runLegacyDownload, resetExportFlowForTests } from "./exportFlow";
import { CRASH_SCREEN_ID } from "../ui/crashScreen";
import {
  makeApp,
  totalCalls,
  totalDispatch,
  ALL_COMMANDS,
  mountSplash,
  openModal,
  installSeamHooks,
} from "./hostCommands.fixture";

/**
 * The shell-to-game command seam: DISPATCH and GUARDS.
 *
 * Two of the design's three invariants live here: every command lands on the SAME
 * call the in-game control makes (never a synthesized click, never a duplicated
 * path), and the GAME decides whether a command may run rather than the shell.
 * The third (the availability the shell is told never disagrees with what the
 * dispatch would do) is in `hostCommandsAvailability.test.ts`, together with the
 * binding and the pump.
 */

installSeamHooks();

describe("runHostCommand: each command runs the control's own code path", () => {
  it.each([
    ["new-game", "promptNewTower"],
    ["save", "onSave"],
    ["open-saves", "onShowSaves"],
    ["export", "promptExport"],
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
    expect(totalDispatch(spies)).toBe(0);
    expect(spies.sayVisibly).not.toHaveBeenCalled();
  });

  it("refuses only the five commands with no tower to act on behind the splash", () => {
    // New Tower and Load Tower are NOT in this list, and that is the point: they
    // are the two things the title screen exists for, so graying them out on the
    // very screen whose job is starting or loading a tower is the wrong answer.
    // These five have nothing to act on before a tower exists.
    const { app, spies } = makeApp();
    mountSplash(spies);
    const refused = ["save", "export", "undo", "redo", "stats"] as const;
    for (const command of refused) runHostCommand(app, command);
    expect(totalDispatch(spies)).toBe(0);
    expect(spies.sayVisibly).toHaveBeenCalledTimes(refused.length);
    // Every call, not just the last: asserting only the final message would let
    // four of the five say something else, or nothing recognizable, unnoticed.
    for (const call of spies.sayVisibly.mock.calls) {
      expect(call).toEqual(["Start or load a tower first", "info"]);
    }
  });

  it("lets Help and Settings through on the splash, because the screen offers them", () => {
    const { app, spies } = makeApp();
    mountSplash(spies);
    runHostCommand(app, "help");
    runHostCommand(app, "settings");
    expect(spies.showHelp).toHaveBeenCalledOnce();
    expect(spies.showSettings).toHaveBeenCalledOnce();
    expect(spies.sayVisibly).not.toHaveBeenCalled();
  });

  it("routes New Tower and Load Tower to the title screen's own buttons while it is up", () => {
    // The splash's versions differ from the in-game ones: Load Tower opens the
    // load-only picker, and New Tower carries the dismiss callback that leaves
    // the title screen standing when the player backs out. Taking the in-game
    // path here would hand the player the wrong dialog, and `promptNewTower`
    // would show an abandon warning for a tower that does not exist yet.
    const { app, spies } = makeApp();
    mountSplash(spies);
    runHostCommand(app, "new-game");
    runHostCommand(app, "open-saves");
    expect(spies.splashNew).toHaveBeenCalledOnce();
    expect(spies.splashLoad).toHaveBeenCalledOnce();
    expect(spies.promptNewTower).not.toHaveBeenCalled();
    expect(spies.onShowSaves).not.toHaveBeenCalled();
    expect(spies.sayVisibly).not.toHaveBeenCalled();
  });

  it("takes the in-game path for New Tower and Load Tower once the splash is down", () => {
    const { app, spies } = makeApp();
    expect(document.getElementById("splash")).toBeNull();
    runHostCommand(app, "new-game");
    runHostCommand(app, "open-saves");
    // With no title screen published, nothing routes to it and both commands fall
    // through to the in-game dialogs. Asserting the splash spies stayed silent is
    // the half that matters: a registry left populated by an earlier test would
    // swallow both commands here and the in-game assertions below would fail
    // for a reason that looks nothing like the real cause.
    expect(spies.splashNew).not.toHaveBeenCalled();
    expect(spies.splashLoad).not.toHaveBeenCalled();
    expect(spies.promptNewTower).toHaveBeenCalledOnce();
    expect(spies.onShowSaves).toHaveBeenCalledOnce();
  });

  it("refuses everything while a blocking choice is up, even with no open dialog element", () => {
    // `shownChoice` and `shownUpdate` are read directly rather than trusted to
    // imply `#modal.open`. They do imply it today, but that invariant lives in
    // two other modules; if either ever renders its choice elsewhere, the shell
    // would be told everything is available AND New Tower would run out from
    // under a live choice.
    for (const flag of ["shownChoice", "shownUpdate"] as const) {
      const { app, spies } = makeApp();
      (app as unknown as Record<string, boolean>)[flag] = true;
      expect((document.getElementById("modal") as HTMLDialogElement).open).toBe(false);
      for (const command of ALL_COMMANDS) runHostCommand(app, command);
      expect(totalDispatch(spies), `${flag} did not block dispatch`).toBe(0);
      expect(availableCommands(app), `${flag} did not clear availability`).toEqual([]);
    }
  });

  it("refuses everything while a dialog is open, and routes the line into it", () => {
    // `sayVisibly` is the point: a <dialog> paints over the toast rail at any
    // z-index, so a plain toast from here would be announced to nobody (GH #658).
    const { app, spies } = makeApp();
    openModal();
    for (const command of ALL_COMMANDS) runHostCommand(app, command);
    expect(totalDispatch(spies)).toBe(0);
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
    expect(totalDispatch(spies)).toBe(0);
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
    expect(totalDispatch(spies)).toBe(0);
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
    expect(totalDispatch(spies)).toBe(0);
    expect(spies.sayVisibly).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it("checks the command before the guards, so an unknown value is inert rather than refused", () => {
    const { app, spies } = makeApp();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mountSplash(spies);
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
    // ALL_COMMANDS, not availableCommands(app). Iterating the guard's output only
    // visited commands the default in-game state leaves available, so a command
    // refused there would be skipped with no assertion and no failure: green on
    // exactly the hole this test exists to close. Cross-checked against the
    // implementation's own set so the literal list cannot drift from the contract.
    expect([...ALL_COMMANDS].sort()).toEqual([...availableCommands(app)].sort());
    for (const command of ALL_COMMANDS) {
      const before = totalCalls(spies);
      runHostCommand(app, command);
      expect(totalCalls(spies), `${command} reached no handler`).toBe(before + 1);
    }
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("export refuses re-entry while an export is in flight (GH #760 follow-on)", () => {
  afterEach(() => resetExportFlowForTests());

  it("refuses Export Tower with a visible message while the export latch is held, then allows it once freed", async () => {
    const { app, spies } = makeApp();
    // An export is mid native save dialog, holding the shared single-flight
    // latch. On macOS the app menu stays live, so Export Tower can fire again.
    let settle!: () => void;
    const flight = runLegacyDownload({ toast: () => {} }, () => new Promise<void>((r) => (settle = r)));

    runHostCommand(app, "export");
    expect(spies.promptExport).not.toHaveBeenCalled();
    expect(spies.sayVisibly).toHaveBeenCalledWith("An export is already in progress.", "info");

    // The latch frees when the export settles; a fresh Export Tower dispatches.
    settle();
    await flight;
    runHostCommand(app, "export");
    expect(spies.promptExport).toHaveBeenCalledTimes(1);
  });
});
