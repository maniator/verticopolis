import { describe, it, expect, beforeEach, vi } from "vitest";
import type { GameApp } from "../main";
import {
  isCrashed,
  isSplashUp,
  isDialogOpen,
  hasBlockingModal,
  isEditorBusy,
  readInteractionState,
  mode,
  changeKey,
  availabilityKeyChanged,
  commitAvailabilityKey,
  resetAvailabilityKey,
} from "./interactionState";
import { CRASH_SCREEN_ID } from "../ui/crashScreen";

/** Minimal chrome-state stub. Only the fields the module reads exist. */
function makeApp(over: Partial<{ shownChoice: boolean; shownUpdate: boolean; editorBusy: boolean }> = {}): GameApp {
  return {
    shownChoice: over.shownChoice ?? false,
    shownUpdate: over.shownUpdate ?? false,
    ui: { isEditorBusy: () => over.editorBusy ?? false },
  } as unknown as GameApp;
}

function mount(id: string, tag = "div", open = false): void {
  const el = document.createElement(tag);
  el.id = id;
  if (open) (el as HTMLDialogElement).open = true;
  document.body.appendChild(el);
}

beforeEach(() => {
  document.body.innerHTML = "";
  resetAvailabilityKey();
});

describe("interactionState reads", () => {
  it("isCrashed reflects the crash card", () => {
    expect(isCrashed()).toBe(false);
    mount(CRASH_SCREEN_ID);
    expect(isCrashed()).toBe(true);
  });

  it("isSplashUp reflects the #splash element", () => {
    expect(isSplashUp()).toBe(false);
    mount("splash");
    expect(isSplashUp()).toBe(true);
  });

  it("isDialogOpen reflects #modal.open, not mere presence", () => {
    mount("modal", "dialog"); // present but closed
    expect(isDialogOpen()).toBe(false);
    (document.getElementById("modal") as HTMLDialogElement).open = true;
    expect(isDialogOpen()).toBe(true);
  });

  it("hasBlockingModal is the sim-freeze flags (either one)", () => {
    expect(hasBlockingModal(makeApp())).toBe(false);
    expect(hasBlockingModal(makeApp({ shownChoice: true }))).toBe(true);
    expect(hasBlockingModal(makeApp({ shownUpdate: true }))).toBe(true);
  });

  it("isEditorBusy reads the predicate and never throws out", () => {
    expect(isEditorBusy(makeApp({ editorBusy: true }))).toBe(true);
    // A throwing predicate degrades to idle rather than escaping.
    const throwing = { ui: { isEditorBusy: () => { throw new Error("boom"); } } } as unknown as GameApp;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(isEditorBusy(throwing)).toBe(false);
    // A missing ui (a fault during construction) is idle, not a crash.
    expect(isEditorBusy({} as unknown as GameApp)).toBe(false);
    warn.mockRestore();
  });

  it("readInteractionState snapshots all five sources at once", () => {
    mount("splash");
    expect(readInteractionState(makeApp({ shownChoice: true, editorBusy: true }))).toEqual({
      crashed: false,
      splashUp: true,
      blockingChoice: true,
      dialogOpen: false,
      editorBusy: true,
    });
  });
});

describe("interactionState mode() precedence (crash > splash > dialog > live)", () => {
  it("is live with nothing up", () => {
    expect(mode(makeApp())).toBe("live");
  });

  it("crash outranks everything", () => {
    mount(CRASH_SCREEN_ID);
    mount("splash");
    mount("modal", "dialog", true);
    expect(mode(makeApp({ shownChoice: true }))).toBe("crash");
  });

  it("splash outranks a dialog", () => {
    mount("splash");
    mount("modal", "dialog", true);
    expect(mode(makeApp())).toBe("splash");
  });

  it("a flagless open dialog is dialog", () => {
    mount("modal", "dialog", true);
    expect(mode(makeApp())).toBe("dialog");
  });

  it("a flagged modal reads as dialog even before the element opens", () => {
    // shownChoice/shownUpdate imply #modal.open, but a flag set a beat early must
    // never read as `live`. No #modal element here, only the flag.
    expect(mode(makeApp({ shownUpdate: true }))).toBe("dialog");
  });

  it("the editor grip is never a mode value (stays live)", () => {
    expect(mode(makeApp({ editorBusy: true }))).toBe("live");
  });
});

describe("availability dirty-gate (AD-3)", () => {
  it("changeKey is a stable pure join", () => {
    expect(changeKey(["a", "b"])).toBe(changeKey(["a", "b"]));
    expect(changeKey(["a", "b"])).not.toBe(changeKey(["b", "a"]));
  });

  it("a fresh gate reports changed, and commit settles it", () => {
    const key = changeKey(["help", "settings"]);
    expect(availabilityKeyChanged(key)).toBe(true);
    commitAvailabilityKey(key);
    expect(availabilityKeyChanged(key)).toBe(false);
    expect(availabilityKeyChanged(changeKey(["help"]))).toBe(true);
  });

  it("reset re-arms the next push", () => {
    const key = changeKey(["save"]);
    commitAvailabilityKey(key);
    expect(availabilityKeyChanged(key)).toBe(false);
    resetAvailabilityKey();
    expect(availabilityKeyChanged(key)).toBe(true);
  });
});
