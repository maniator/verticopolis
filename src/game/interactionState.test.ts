import { describe, it, expect, beforeEach, vi } from "vitest";
import type { GameApp } from "../main";
import {
  isCrashed,
  isEngineStopped,
  isSplashUp,
  isDialogOpen,
  hasBlockingModal,
  isEditorBusy,
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
});

describe("interactionState reads", () => {
  it("isCrashed reflects the crash card", () => {
    expect(isCrashed()).toBe(false);
    mount(CRASH_SCREEN_ID);
    expect(isCrashed()).toBe(true);
  });

  it("isEngineStopped reflects the wasm-only engine-failure message", () => {
    expect(isEngineStopped()).toBe(false);
    mount("engine-failure");
    expect(isEngineStopped()).toBe(true);
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
});
