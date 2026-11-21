import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const standalone = vi.hoisted(() => ({ isInstalledStandalone: vi.fn(() => false) }));
vi.mock("../ui/standalone", () => standalone);

import { DISPLAY_SEPARATOR, FULL_SCREEN_ITEM, fullScreenOffered, fullScreenStates } from "./fullScreenItem";

describe("fullScreenOffered", () => {
  it("leaves Full Screen out of the installed app on a phone", () => {
    expect(fullScreenOffered({ phone: true, installed: true, filling: false })).toBe(false);
  });

  it("keeps it in a phone's browser tab, and on a tablet or computer, installed or not", () => {
    expect(fullScreenOffered({ phone: true, installed: false, filling: false })).toBe(true);
    expect(fullScreenOffered({ phone: false, installed: true, filling: false })).toBe(true);
    expect(fullScreenOffered({ phone: false, installed: false, filling: false })).toBe(true);
  });

  it("keeps it while the page fills the screen, so the player can always leave", () => {
    expect(fullScreenOffered({ phone: true, installed: true, filling: true })).toBe(true);
  });
});

describe("fullScreenStates", () => {
  let filling: Element | null = null;
  let states: ReturnType<typeof fullScreenStates> = {};

  beforeEach(() => {
    filling = null;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => filling });
    standalone.isInstalledStandalone.mockReset();
  });

  afterEach(() => {
    delete (document as { fullscreenElement?: unknown }).fullscreenElement;
  });

  it("hides the item and the line above it in the installed app on a phone", () => {
    standalone.isInstalledStandalone.mockReturnValue(true);
    states = fullScreenStates(true);
    expect(standalone.isInstalledStandalone).toHaveBeenCalled();
    expect(states[FULL_SCREEN_ITEM].hidden).toBe(true);
    expect(states[DISPLAY_SEPARATOR].hidden).toBe(true);
  });

  it("shows both again in a phone's browser tab (the same page, opened outside the app)", () => {
    standalone.isInstalledStandalone.mockReturnValue(true);
    states = fullScreenStates(true);
    standalone.isInstalledStandalone.mockReturnValue(false);
    states = fullScreenStates(true);
    expect(states[FULL_SCREEN_ITEM].hidden).toBe(false);
    expect(states[DISPLAY_SEPARATOR].hidden).toBe(false);
  });

  it("keeps both in the installed app on a computer, where Tools and Status Bar sit under the line", () => {
    standalone.isInstalledStandalone.mockReturnValue(true);
    states = fullScreenStates(false);
    expect(states[FULL_SCREEN_ITEM].hidden).toBe(false);
    expect(states[DISPLAY_SEPARATOR].hidden).toBe(false);
  });

  it("keeps the item while the page fills the screen, even in the installed app on a phone", () => {
    standalone.isInstalledStandalone.mockReturnValue(true);
    filling = document.documentElement;
    states = fullScreenStates(true);
    expect(states[FULL_SCREEN_ITEM].hidden).toBe(false);
    expect(states[DISPLAY_SEPARATOR].hidden).toBe(false);
  });
});
