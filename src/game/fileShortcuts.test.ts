import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const state = vi.hoisted(() => ({ splash: false, dialog: false, stopped: false }));
vi.mock("./interactionState", () => ({
  isSplashUp: () => state.splash,
  isDialogOpen: () => state.dialog,
  isEngineStopped: () => state.stopped,
}));

import { fileCommandFor, typesText, wireFileShortcuts, type FileCommands } from "./fileShortcuts";

let target: EventTarget;
let commands: { [K in keyof FileCommands]: Mock<() => void> };
let report: Mock<(command: keyof FileCommands, grayed: boolean) => void>;

beforeEach(() => {
  Object.assign(state, { splash: false, dialog: false, stopped: false });
  target = new EventTarget();
  commands = { open: vi.fn<() => void>(), save: vi.fn<() => void>(), saveAs: vi.fn<() => void>() };
  report = vi.fn<(command: keyof FileCommands, grayed: boolean) => void>();
  wireFileShortcuts(commands, target as unknown as Window, report);
});
afterEach(() => vi.restoreAllMocks());

/** Press a key on the wired target; returns whether the browser default was taken. */
function press(key: string, mods: Partial<Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "repeat">> = {}): boolean {
  const e = new KeyboardEvent("keydown", { key, cancelable: true, ...mods });
  target.dispatchEvent(e);
  return e.defaultPrevented;
}

describe("the File menu's keys", () => {
  it("name Open, Save and Save As with Ctrl or Cmd, and nothing else", () => {
    const k = (key: string, m: object = {}) => fileCommandFor({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...m });
    expect(k("o", { ctrlKey: true })).toBe("open");
    expect(k("s", { ctrlKey: true })).toBe("save");
    expect(k("S", { ctrlKey: true, shiftKey: true })).toBe("saveAs");
    expect(k("s", { metaKey: true })).toBe("save");
    expect(k("s")).toBeNull(); // plain S pans the view
    expect(k("O", { ctrlKey: true, shiftKey: true })).toBeNull();
    expect(k("s", { ctrlKey: true, altKey: true })).toBeNull();
    expect(k("z", { ctrlKey: true })).toBeNull();
  });

  it("run the menu's commands in a tower and take the browser's own Open and Save Page", () => {
    expect(press("o", { ctrlKey: true })).toBe(true);
    expect(press("s", { ctrlKey: true })).toBe(true);
    expect(press("S", { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(commands.open).toHaveBeenCalledOnce();
    expect(commands.save).toHaveBeenCalledOnce();
    expect(commands.saveAs).toHaveBeenCalledOnce();
    expect(report.mock.calls).toEqual([
      ["open", false],
      ["save", false],
      ["saveAs", false],
    ]);
  });

  it("leave other keys alone", () => {
    expect(press("s")).toBe(false);
    expect(press("z", { ctrlKey: true })).toBe(false);
    expect(Object.values(commands).every((c) => c.mock.calls.length === 0)).toBe(true);
    expect(report).not.toHaveBeenCalled();
  });

  it("on the title screen open a file but never save, as the grayed items do", () => {
    state.splash = true;
    expect(press("s", { ctrlKey: true })).toBe(true);
    press("S", { ctrlKey: true, shiftKey: true });
    press("o", { ctrlKey: true });
    expect(commands.save).not.toHaveBeenCalled();
    expect(commands.saveAs).not.toHaveBeenCalled();
    expect(commands.open).toHaveBeenCalledOnce();
    expect(report.mock.calls).toEqual([
      ["save", true],
      ["saveAs", true],
      ["open", false],
    ]);
  });

  it("do nothing over an open dialog, after the engine stopped, or on a held key's repeats", () => {
    state.dialog = true;
    expect(press("s", { ctrlKey: true })).toBe(true);
    state.dialog = false;
    state.stopped = true;
    press("o", { ctrlKey: true });
    state.stopped = false;
    press("s", { ctrlKey: true, repeat: true });
    expect(Object.values(commands).every((c) => c.mock.calls.length === 0)).toBe(true);
    expect(report).not.toHaveBeenCalled();
  });

  it("leave a text box its keys: nothing runs and the browser keeps the press", () => {
    const own = { open: vi.fn<() => void>(), save: vi.fn<() => void>(), saveAs: vi.fn<() => void>() };
    const heard = vi.fn();
    const root = document.createElement("div");
    document.body.append(root);
    wireFileShortcuts(own, root, heard);
    const box = Object.assign(document.createElement("input"), { type: "text" });
    const area = document.createElement("textarea");
    const check = Object.assign(document.createElement("input"), { type: "checkbox" });
    root.append(box, area, check);
    /** A press that starts in `el` and bubbles to the listener. */
    const pressIn = (el: Element, key: string, mods: KeyboardEventInit) => {
      const e = new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true, ...mods });
      el.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(pressIn(box, "s", { ctrlKey: true })).toBe(false);
    expect(pressIn(area, "o", { metaKey: true })).toBe(false);
    expect(Object.values(own).every((c) => c.mock.calls.length === 0)).toBe(true);
    expect(heard).not.toHaveBeenCalled();
    expect(pressIn(check, "s", { ctrlKey: true })).toBe(true); // a checkbox takes no typing
    expect(own.save).toHaveBeenCalledOnce();
    expect([box, area, check].map(typesText)).toEqual([true, true, false]);
    root.remove();
  });
});
