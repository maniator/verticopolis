import { describe, it, expect, vi } from "vitest";
import { render, html } from "lit-html";
import { CLOSE_TAB_NOTE, FROM_GAME_STORAGE_KEY, backToOpenGame, fromGameHref, openedFromGame, takeFromGameFlag } from "./fromGame";
import { pageShell } from "./templates/pageShell";

/** A page the game opened, in the shared shell, mounted in the test DOM. */
function mountFromGame(): void {
  const root = document.createElement("div");
  render(pageShell({ title: "T", backHref: "/", main: html`<p>Body</p>`, fromGame: true }), root);
  document.body.replaceChildren(root);
}

describe("fromGameHref and openedFromGame", () => {
  it("marks a path, keeping its fragment and any query", () => {
    expect(fromGameHref("/help")).toBe("/help?from=game");
    expect(fromGameHref("/help#classic-vs-modern")).toBe("/help?from=game#classic-vs-modern");
    expect(fromGameHref("/gallery?x=1")).toBe("/gallery?x=1&from=game");
  });

  it("reads back what it writes", () => {
    expect(openedFromGame(new URL(fromGameHref("/help#a"), "https://example.test").search)).toBe(true);
  });

  it("reads only the game's marker", () => {
    expect(openedFromGame("?from=game")).toBe(true);
    expect(openedFromGame("")).toBe(false);
    expect(openedFromGame("?from=search")).toBe(false);
  });
});

describe("backToOpenGame", () => {
  it("says to close the tab, and focuses that note, when the browser keeps it open", () => {
    vi.useFakeTimers();
    try {
      mountFromGame();
      const win = { close: vi.fn(), closed: false, setTimeout: window.setTimeout.bind(window), document } as unknown as Window;
      const e = new MouseEvent("click", { cancelable: true });
      backToOpenGame(e, win);
      const note = document.getElementById("back-note")!;
      expect(note.hidden).toBe(true);
      vi.advanceTimersByTime(300);
      expect(note.hidden).toBe(false);
      expect(note.textContent).toBe(CLOSE_TAB_NOTE);
      expect(document.activeElement).toBe(note);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays quiet when the tab did close", () => {
    vi.useFakeTimers();
    try {
      mountFromGame();
      const win = { close: vi.fn(), closed: true, setTimeout: window.setTimeout.bind(window), document } as unknown as Window;
      backToOpenGame(new MouseEvent("click", { cancelable: true }), win);
      vi.advanceTimersByTime(300);
      expect(document.getElementById("back-note")!.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("takeFromGameFlag", () => {
  const memoryStorage = (): Storage => {
    const items = new Map<string, string>();
    return {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
    } as unknown as Storage;
  };

  it("takes from=game out of the address bar, keeping the version fragment and other params", () => {
    const hist = { replaceState: vi.fn() };
    const store = memoryStorage();
    const loc = { pathname: "/help/changelog", search: "?from=game&ref=x", hash: "#3.2.0" };
    expect(takeFromGameFlag(loc, hist, () => store)).toBe(true);
    expect(hist.replaceState).toHaveBeenCalledWith(null, "", "/help/changelog?ref=x#3.2.0");
    expect(store.getItem(FROM_GAME_STORAGE_KEY)).toBe("game");
  });

  it("leaves no bare question mark when from=game was the only param", () => {
    const hist = { replaceState: vi.fn() };
    takeFromGameFlag({ pathname: "/help/changelog", search: "?from=game", hash: "" }, hist, memoryStorage);
    expect(hist.replaceState).toHaveBeenCalledWith(null, "", "/help/changelog");
  });

  it("still knows after a reload of the same tab, from its session storage", () => {
    const store = memoryStorage();
    const hist = { replaceState: vi.fn() };
    takeFromGameFlag({ pathname: "/help/changelog", search: "?from=game", hash: "" }, hist, () => store);
    expect(takeFromGameFlag({ pathname: "/help/changelog", search: "", hash: "" }, hist, () => store)).toBe(true);
    expect(hist.replaceState).toHaveBeenCalledTimes(1);
  });

  it("is a plain visit with no marker and nothing stored", () => {
    const hist = { replaceState: vi.fn() };
    expect(takeFromGameFlag({ pathname: "/help/changelog", search: "", hash: "" }, hist, memoryStorage)).toBe(false);
    expect(hist.replaceState).not.toHaveBeenCalled();
  });

  it("keeps working when the browser blocks storage", () => {
    const blocked = (): Storage => {
      throw new DOMException("blocked", "SecurityError");
    };
    const hist = { replaceState: vi.fn() };
    expect(takeFromGameFlag({ pathname: "/help/changelog", search: "?from=game", hash: "" }, hist, blocked)).toBe(true);
    expect(hist.replaceState).toHaveBeenCalledTimes(1);
    expect(takeFromGameFlag({ pathname: "/help/changelog", search: "", hash: "" }, hist, blocked)).toBe(false);
  });
});
