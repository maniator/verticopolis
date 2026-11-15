import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const standalone = vi.hoisted(() => ({ isInstalledStandalone: vi.fn(() => false) }));
vi.mock("../ui/standalone", () => standalone);

import { DISPLAY_SEPARATOR, FULL_SCREEN_ITEM, fitFullScreenItem, fullScreenOffered } from "./fullScreenItem";

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

describe("fitFullScreenItem", () => {
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  let filling: Element | null = null;

  beforeEach(() => {
    filling = null;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => filling });
    standalone.isInstalledStandalone.mockReset();
    document.body.innerHTML = `<hr id="${DISPLAY_SEPARATOR}" /><button id="${FULL_SCREEN_ITEM}">Full Screen</button>`;
  });

  afterEach(() => {
    delete (document as { fullscreenElement?: unknown }).fullscreenElement;
    document.body.innerHTML = "";
  });

  it("hides the item and the line above it in the installed app on a phone", () => {
    standalone.isInstalledStandalone.mockReturnValue(true);
    fitFullScreenItem(true);
    expect(standalone.isInstalledStandalone).toHaveBeenCalled();
    expect($(FULL_SCREEN_ITEM).hidden).toBe(true);
    expect($(DISPLAY_SEPARATOR).hidden).toBe(true);
  });

  it("shows both again in a phone's browser tab (the same page, opened outside the app)", () => {
    standalone.isInstalledStandalone.mockReturnValue(true);
    fitFullScreenItem(true);
    standalone.isInstalledStandalone.mockReturnValue(false);
    fitFullScreenItem(true);
    expect($(FULL_SCREEN_ITEM).hidden).toBe(false);
    expect($(DISPLAY_SEPARATOR).hidden).toBe(false);
  });

  it("keeps both in the installed app on a computer, where Tools and Status Bar sit under the line", () => {
    standalone.isInstalledStandalone.mockReturnValue(true);
    fitFullScreenItem(false);
    expect($(FULL_SCREEN_ITEM).hidden).toBe(false);
    expect($(DISPLAY_SEPARATOR).hidden).toBe(false);
  });

  it("keeps the item while the page fills the screen, even in the installed app on a phone", () => {
    standalone.isInstalledStandalone.mockReturnValue(true);
    filling = document.documentElement;
    fitFullScreenItem(true);
    expect($(FULL_SCREEN_ITEM).hidden).toBe(false);
    expect($(DISPLAY_SEPARATOR).hidden).toBe(false);
  });

  it("does nothing on a page without the item", () => {
    document.body.innerHTML = "";
    standalone.isInstalledStandalone.mockReturnValue(true);
    expect(() => fitFullScreenItem(true)).not.toThrow();
  });
});
