import { afterEach, describe, expect, it, vi } from "vitest";
import { PALETTE_FIT_MQ } from "./paletteFit";
import {
  PALETTE_COLLAPSED_CLASS,
  PALETTE_COLLAPSED_STORAGE_KEY,
  PALETTE_COLLAPSED_VALUE,
  openFoldedPaletteAround,
  storedPaletteCollapsed,
  wirePaletteCollapse,
} from "./paletteCollapse";

/** The Tools window as index.html writes it. */
function toolsWindow(): HTMLElement {
  const win = document.createElement("aside");
  win.id = "palette";
  win.innerHTML = `<div class="win-title">Tools</div><div class="palette-tabs" id="palette-tabs"></div><div class="palette-scroll" id="palette-scroll"></div>`;
  return win;
}

function memoryStore(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: vi.fn((key: string) => (key in data ? data[key] : null)),
    setItem: vi.fn((key: string, value: string) => {
      data[key] = value;
    }),
  };
}

const folded = (win: HTMLElement) => win.classList.contains(PALETTE_COLLAPSED_CLASS);

describe("the Tools window's fold button", () => {
  it("sits on the title bar and starts open when nothing is stored", () => {
    const win = toolsWindow();
    const store = memoryStore();
    const button = wirePaletteCollapse(win, store, () => {})!;
    expect(button.parentElement).toBe(win.querySelector(".win-title"));
    expect(button.getAttribute("aria-controls")).toBe("palette-scroll");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-label")).toBe("Hide the Tools");
    expect(folded(win)).toBe(false);
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it("folds and opens on each click, stores each choice, and tells the fit", () => {
    const win = toolsWindow();
    const store = memoryStore();
    const toggled = vi.fn();
    const button = wirePaletteCollapse(win, store, toggled)!;
    button.click();
    expect(folded(win)).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-label")).toBe("Show the Tools");
    expect(button.title).toBe("Show the Tools");
    expect(store.data[PALETTE_COLLAPSED_STORAGE_KEY]).toBe(PALETTE_COLLAPSED_VALUE.collapsed);
    expect(toggled).toHaveBeenCalledTimes(1);
    button.click();
    expect(folded(win)).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(store.data[PALETTE_COLLAPSED_STORAGE_KEY]).toBe(PALETTE_COLLAPSED_VALUE.open);
    expect(toggled).toHaveBeenCalledTimes(2);
  });

  it("starts folded when the player last folded it", () => {
    const win = toolsWindow();
    const button = wirePaletteCollapse(win, memoryStore({ [PALETTE_COLLAPSED_STORAGE_KEY]: PALETTE_COLLAPSED_VALUE.collapsed }), () => {})!;
    expect(folded(win)).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("reads storage that throws, holds something else, or is missing as open", () => {
    expect(storedPaletteCollapsed(null)).toBe(false);
    expect(storedPaletteCollapsed(memoryStore({ [PALETTE_COLLAPSED_STORAGE_KEY]: "yes" }))).toBe(false);
    const throwing = { getItem: () => { throw new Error("blocked"); } };
    expect(storedPaletteCollapsed(throwing)).toBe(false);
  });

  it("still folds when a write throws", () => {
    const win = toolsWindow();
    const store = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    const button = wirePaletteCollapse(win, store, () => {})!;
    button.click();
    expect(folded(win)).toBe(true);
  });

  it("adds nothing to a window with no title bar", () => {
    const win = document.createElement("aside");
    expect(wirePaletteCollapse(win, memoryStore(), () => {})).toBeNull();
    expect(win.querySelector("button")).toBeNull();
  });
});

describe("openFoldedPaletteAround", () => {
  /** A page whose viewport is (`desktop`) or is not on the desktop layout. */
  const viewport = (desktop: boolean) =>
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query === PALETTE_FIT_MQ && desktop })));

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function foldedWindowWithTool() {
    const win = toolsWindow();
    const tool = document.createElement("div");
    win.querySelector(".palette-scroll")!.append(tool);
    document.body.append(win);
    const store = memoryStore({ [PALETTE_COLLAPSED_STORAGE_KEY]: PALETTE_COLLAPSED_VALUE.collapsed });
    const toggled = vi.fn();
    wirePaletteCollapse(win, store, toggled);
    return { win, tool, store, toggled };
  }

  it("opens a folded window around a tool, and leaves an open window or an outside node alone", () => {
    viewport(true);
    const { win, tool, store, toggled } = foldedWindowWithTool();
    openFoldedPaletteAround(document.body);
    expect(folded(win)).toBe(true);
    openFoldedPaletteAround(tool);
    expect(folded(win)).toBe(false);
    expect(store.data[PALETTE_COLLAPSED_STORAGE_KEY]).toBe(PALETTE_COLLAPSED_VALUE.open);
    expect(toggled).toHaveBeenCalledTimes(1);
    openFoldedPaletteAround(tool);
    expect(folded(win)).toBe(false);
    expect(toggled).toHaveBeenCalledTimes(1);
    win.remove();
  });

  it("keeps the desktop's stored fold off the desktop layout, where the fold does not show", () => {
    viewport(false);
    const { win, tool, store, toggled } = foldedWindowWithTool();
    openFoldedPaletteAround(tool);
    expect(folded(win)).toBe(true);
    expect(store.data[PALETTE_COLLAPSED_STORAGE_KEY]).toBe(PALETTE_COLLAPSED_VALUE.collapsed);
    expect(store.setItem).not.toHaveBeenCalled();
    expect(toggled).not.toHaveBeenCalled();
    win.remove();
  });
});
