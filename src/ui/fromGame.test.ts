import { describe, it, expect, vi } from "vitest";
import { render, html } from "lit-html";
import {
  CLOSE_TAB_NOTE,
  FROM_GAME_STORAGE_KEY,
  LEGACY_FROM_GAME_STORAGE_KEY,
  PRESENCE_ASK,
  PRESENCE_HERE,
  PRESENCE_WAIT_MS,
  answerGamePresence,
  backToOpenGame,
  GAME_HELP_SOURCES,
  HELP_SOURCE_STORAGE_KEY,
  repeatsEarlierLoad,
  fromGameHref,
  gameStillOpen,
  helpVisitSource,
  openedFromGame,
  takeFromGameFlag,
  type BackToGameDeps,
  type PresenceChannel,
} from "./fromGame";
import { pageShell } from "./templates/pageShell";

/** A page the game opened, in the shared shell, mounted in the test DOM. */
function mountFromGame(): void {
  const root = document.createElement("div");
  render(pageShell({ title: "T", backHref: "/", main: html`<p>Body</p>`, fromGame: true }), root);
  document.body.replaceChildren(root);
}

describe("fromGameHref and openedFromGame", () => {
  it("marks a path with the game and the place it opened from, keeping its fragment and any query", () => {
    expect(fromGameHref("/help", "game_menu")).toBe("/help?from=game&via=game_menu");
    expect(fromGameHref("/help#classic-vs-modern", "compare")).toBe("/help?from=game&via=compare#classic-vs-modern");
    expect(fromGameHref("https://help.verticopolis.com/changelog?x=1", "update_prompt")).toBe("https://help.verticopolis.com/changelog?x=1&from=game&via=update_prompt");
  });

  it("reads back what it writes", () => {
    expect(openedFromGame(new URL(fromGameHref("/help#a", "about"), "https://example.test").search)).toBe(true);
  });

  it("reads only the game's marker", () => {
    expect(openedFromGame("?from=game")).toBe(true);
    expect(openedFromGame("")).toBe(false);
    expect(openedFromGame("?from=search")).toBe(false);
  });
});

/** A browser tab: Back to game closes the tab without asking anything. */
const browserTab: BackToGameDeps = { installed: () => false, stillOpen: () => Promise.resolve(true) };

describe("backToOpenGame", () => {
  it("says to close the tab, and focuses that note, when the browser keeps it open", () => {
    vi.useFakeTimers();
    try {
      mountFromGame();
      const win = { close: vi.fn(), closed: false, setTimeout: window.setTimeout.bind(window), document } as unknown as Window;
      const e = new MouseEvent("click", { cancelable: true });
      backToOpenGame(e, win, browserTab);
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
      backToOpenGame(new MouseEvent("click", { cancelable: true }), win, browserTab);
      vi.advanceTimersByTime(300);
      expect(document.getElementById("back-note")!.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never asks after the game from a browser tab", () => {
    const stillOpen = vi.fn(() => Promise.resolve(false));
    const win = { close: vi.fn(), closed: true, setTimeout: vi.fn(), document, location: { replace: vi.fn() } } as unknown as Window;
    backToOpenGame(new MouseEvent("click", { cancelable: true }), win, { installed: () => false, stillOpen });
    expect(stillOpen).not.toHaveBeenCalled();
    expect(win.close).toHaveBeenCalledTimes(1);
  });

  /** Click the shell's Back to game link in an installed app whose game does or doesn't answer. */
  async function clickInstalled(gameAnswers: boolean, pageAt: string = location.href): Promise<{ win: Window; e: MouseEvent; stillOpen: ReturnType<typeof vi.fn> }> {
    mountFromGame();
    const replace = vi.fn();
    const page = new URL(pageAt);
    const win = { close: vi.fn(), closed: true, setTimeout: vi.fn(), document, location: { replace, href: page.href, origin: page.origin } } as unknown as Window;
    const stillOpen = vi.fn(() => Promise.resolve(gameAnswers));
    const link = document.querySelector<HTMLAnchorElement>("a[data-act=back-to-game]")!;
    const e = new MouseEvent("click", { cancelable: true });
    link.addEventListener("click", (ev) => backToOpenGame(ev, win, { installed: () => true, stillOpen }), { once: true });
    link.dispatchEvent(e);
    await Promise.resolve();
    await Promise.resolve();
    return { win, e, stillOpen };
  }

  it("loads the game in place in an installed app whose game is no longer running", async () => {
    const { win, e, stillOpen } = await clickInstalled(false);
    expect(e.defaultPrevented).toBe(true);
    expect(stillOpen).toHaveBeenCalledTimes(1);
    expect(win.close).not.toHaveBeenCalled();
    expect(win.location.replace).toHaveBeenCalledWith(new URL("/", location.href).href);
  });

  it("closes its window in an installed app whose game still answers elsewhere", async () => {
    const { win } = await clickInstalled(true);
    expect(win.close).toHaveBeenCalledTimes(1);
    expect(win.location.replace).not.toHaveBeenCalled();
  });

  it("closes the browser view the app opened for a manual on another host, without asking or loading the game there", async () => {
    // The shell's link points at this test origin's "/", so a page on any other host sees the game elsewhere.
    const { win, e, stillOpen } = await clickInstalled(false, "https://help.example.test/rooms/");
    expect(e.defaultPrevented).toBe(true);
    expect(stillOpen).not.toHaveBeenCalled();
    expect(win.close).toHaveBeenCalledTimes(1);
    expect(win.location.replace).not.toHaveBeenCalled();
  });
});

/** A stand-in channel that records what it sends and lets a test deliver a message. */
function fakeChannel(): PresenceChannel & { postMessage: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; deliver: (data: unknown) => void } {
  const channel = {
    onmessage: null as ((ev: MessageEvent) => void) | null,
    postMessage: vi.fn(),
    close: vi.fn(),
    deliver: (data: unknown) => channel.onmessage?.(new MessageEvent("message", { data })),
  };
  return channel;
}

describe("game presence", () => {
  it("the game answers an ask, and only an ask", () => {
    const channel = fakeChannel();
    answerGamePresence(() => channel);
    channel.deliver("something else");
    expect(channel.postMessage).not.toHaveBeenCalled();
    channel.deliver(PRESENCE_ASK);
    expect(channel.postMessage).toHaveBeenCalledWith(PRESENCE_HERE);
  });

  it("a page hears the game answer before the wait runs out", async () => {
    const channel = fakeChannel();
    const timers: Array<() => void> = [];
    const answer = gameStillOpen(() => channel, (fn) => timers.push(fn));
    expect(channel.postMessage).toHaveBeenCalledWith(PRESENCE_ASK);
    channel.deliver(PRESENCE_HERE);
    timers.forEach((fn) => fn());
    await expect(answer).resolves.toBe(true);
    expect(channel.close).toHaveBeenCalledTimes(1);
  });

  it("a page decides the game is gone when the wait runs out unanswered", async () => {
    const channel = fakeChannel();
    let waited = 0;
    const answer = gameStillOpen(
      () => channel,
      (fn, ms) => {
        waited = ms;
        fn();
      },
    );
    await expect(answer).resolves.toBe(false);
    expect(waited).toBe(PRESENCE_WAIT_MS);
    expect(channel.close).toHaveBeenCalledTimes(1);
  });

  it("assumes the game is still open where the browser cannot ask", async () => {
    await expect(gameStillOpen(() => null)).resolves.toBe(true);
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

  it("takes the place the game named (via) out with it", () => {
    const hist = { replaceState: vi.fn() };
    takeFromGameFlag({ pathname: "/help/", search: "?from=game&via=stats&ref=x", hash: "" }, hist, memoryStorage);
    expect(hist.replaceState).toHaveBeenCalledWith(null, "", "/help/?ref=x");
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

  it("still knows a tab the earlier release notes build marked under its old key", () => {
    const store = memoryStorage();
    store.setItem(LEGACY_FROM_GAME_STORAGE_KEY, "game");
    expect(takeFromGameFlag({ pathname: "/help/changelog", search: "", hash: "" }, { replaceState: vi.fn() }, () => store)).toBe(true);
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

describe("helpVisitSource", () => {
  const memoryStorage = (): Storage => {
    const items = new Map<string, string>();
    return {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
    } as unknown as Storage;
  };

  it("reports every place the game names, read back from the link the game writes", () => {
    for (const source of GAME_HELP_SOURCES) {
      const search = new URL(fromGameHref("/help/rooms/", source), "https://example.test").search;
      expect(helpVisitSource(search, false, memoryStorage)).toBe(source);
    }
  });

  it("is direct for a visit the game did not open, even one carrying a via", () => {
    expect(helpVisitSource("", false, memoryStorage)).toBe("direct");
    expect(helpVisitSource("?via=game_menu", false, memoryStorage)).toBe("direct");
    expect(helpVisitSource("?from=search&via=title", false, memoryStorage)).toBe("direct");
  });

  it("is game for a page the game opened without a known place (an older build, or a crafted value)", () => {
    expect(helpVisitSource("?from=game", false, memoryStorage)).toBe("game");
    expect(helpVisitSource("?from=game&via=https%3A%2F%2Felsewhere.test", false, memoryStorage)).toBe("game");
  });

  it("reports the stored source again on a reload of the same tab, once the marks are gone", () => {
    const store = memoryStorage();
    expect(helpVisitSource("?from=game&via=welcome", false, () => store)).toBe("welcome");
    expect(store.getItem(HELP_SOURCE_STORAGE_KEY)).toBe("welcome");
    expect(helpVisitSource("", true, () => store)).toBe("welcome");
  });

  it("is direct for a fresh unmarked visit in a tab the game once opened", () => {
    const store = memoryStorage();
    helpVisitSource("?from=game&via=welcome", false, () => store);
    expect(helpVisitSource("", false, () => store)).toBe("direct");
  });

  it("ignores a stored value that is not one of its codes", () => {
    const store = memoryStorage();
    store.setItem(HELP_SOURCE_STORAGE_KEY, "https://elsewhere.test/");
    expect(helpVisitSource("", true, () => store)).toBe("direct");
  });

  it("still reports this load when the browser blocks storage", () => {
    const blocked = (): Storage => {
      throw new DOMException("blocked", "SecurityError");
    };
    expect(helpVisitSource("?from=game&via=inspector", false, blocked)).toBe("inspector");
    expect(helpVisitSource("", true, blocked)).toBe("direct");
  });
});

describe("repeatsEarlierLoad", () => {
  const withType = (type: string | undefined) => ({
    getEntriesByType: vi.fn(() => (type === undefined ? [] : [{ type }])),
  }) as unknown as Pick<Performance, "getEntriesByType">;

  it("is true for a reload or a step back or forward, and reads the navigation entry", () => {
    const reload = withType("reload");
    expect(repeatsEarlierLoad(reload)).toBe(true);
    expect(reload.getEntriesByType).toHaveBeenCalledWith("navigation");
    expect(repeatsEarlierLoad(withType("back_forward"))).toBe(true);
  });

  it("is false for a fresh navigation, a prerender, or no entry at all", () => {
    expect(repeatsEarlierLoad(withType("navigate"))).toBe(false);
    expect(repeatsEarlierLoad(withType("prerender"))).toBe(false);
    expect(repeatsEarlierLoad(withType(undefined))).toBe(false);
  });
});
