import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { trackAppAction } = vi.hoisted(() => ({ trackAppAction: vi.fn() }));
vi.mock("./analyticsActions", () => ({ trackAppAction }));

import {
  MANUAL_LINKS,
  MIDDLE_BUTTON,
  msToNextMinute,
  notFoundLinks,
  notFoundPageTemplate,
  notFoundSite,
  trayClock,
} from "./notFoundPage";
import { renderToFragment } from "./ui/testing/litTestUtils";

/**
 * The site's "page not found" page (`404.html`). Importing the module runs its
 * `main()` once, which no-ops in the test DOM (no `#app`), so the pure
 * template is what these assert on. Analytics is a spy.
 */

const buttons = (frag: DocumentFragment) => [...frag.querySelectorAll<HTMLAnchorElement>(".nf-buttons a.btn")];

beforeEach(() => trackAppAction.mockClear());

describe("notFoundSite", () => {
  it("is the manual on the manual's own host, whatever the path", () => {
    expect(
      notFoundSite(
        { origin: "https://help.verticopolis.com", pathname: "/rooms/nope" },
        "https://help.verticopolis.com",
      ),
    ).toBe("help");
  });

  it("is the manual under /help on a host that serves it there", () => {
    expect(notFoundSite({ origin: "https://staging.verticopolis.com", pathname: "/help/nope" }, "")).toBe("help");
    expect(notFoundSite({ origin: "https://staging.verticopolis.com", pathname: "/help" }, "")).toBe("help");
  });

  it("is the game anywhere else, including a path that only starts with help", () => {
    expect(
      notFoundSite({ origin: "https://verticopolis.com", pathname: "/nope" }, "https://help.verticopolis.com"),
    ).toBe("game");
    expect(notFoundSite({ origin: "https://verticopolis.com", pathname: "/helpful" }, "")).toBe("game");
  });
});

describe("notFoundLinks", () => {
  it("puts the game first on the game's site and the manual first on the manual's", () => {
    expect(notFoundLinks("game").map((l) => l.code)).toEqual(["game", "manual", "changelog", "rooms"]);
    expect(notFoundLinks("help").map((l) => l.code)).toEqual(["manual", "game", "changelog", "rooms"]);
  });

  it("links the manual's pages at this build's address for them", () => {
    expect(MANUAL_LINKS.map((l) => l.href)).toEqual(["/help", "/help/changelog", "/help/rooms"]);
  });
});

describe("trayClock", () => {
  it("reads like the 1995 tray clock", () => {
    expect(trayClock(new Date(2026, 10, 15, 0, 5))).toBe("12:05 AM");
    expect(trayClock(new Date(2026, 10, 15, 9, 41))).toBe("9:41 AM");
    expect(trayClock(new Date(2026, 10, 15, 12, 0))).toBe("12:00 PM");
    expect(trayClock(new Date(2026, 10, 15, 16, 34))).toBe("4:34 PM");
  });

  it("waits until just after the minute turns over", () => {
    expect(msToNextMinute(new Date(2026, 10, 15, 9, 41, 0, 0))).toBe(60_050);
    expect(msToNextMinute(new Date(2026, 10, 15, 9, 41, 59, 900))).toBe(150);
    expect(msToNextMinute(new Date(2026, 10, 15, 9, 41, 30, 250))).toBe(29_800);
  });
});

describe("notFoundPageTemplate", () => {
  it("names the missing address as text in a message box on the desk", () => {
    const frag = renderToFragment(notFoundPageTemplate({ path: "/help/<b>nope</b>" }));
    expect(frag.querySelector(".nf-desk .nf-win h1")?.textContent).toBe("Floor 404 hasn't been built yet.");
    const code = frag.querySelector(".nf-msg code");
    expect(code?.textContent).toBe("/help/<b>nope</b>");
    expect(code?.querySelector("b")).toBeNull();
    expect(frag.querySelector(".nf-win .win-title")?.textContent).toContain("Verticopolis");
  });

  it("offers the game as the default button on the game's site", () => {
    const links = buttons(renderToFragment(notFoundPageTemplate({ path: "/x" })));
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Play the game", "/"],
      ["Player's Manual", "/help"],
      ["Release notes", "/help/changelog"],
      ["Every room", "/help/rooms"],
    ]);
    expect(links.map((a) => a.classList.contains("primary"))).toEqual([true, false, false, false]);
  });

  it("offers the manual as the default button on the manual's site, and says so", () => {
    const frag = renderToFragment(notFoundPageTemplate({ path: "/x", site: "help" }));
    expect(frag.querySelector("h1")?.textContent).toBe("Page 404 isn't in the manual.");
    expect(frag.querySelector(".nf-title-text")?.textContent).toBe("Verticopolis Player's Manual");
    const links = buttons(frag);
    expect(links[0].getAttribute("href")).toBe("/help");
    expect(links[0].classList.contains("primary")).toBe(true);
    expect(links[1].getAttribute("href")).toBe("/");
  });

  it("puts the clock in the taskbar tray and the game behind its Verticopolis button", () => {
    const frag = renderToFragment(notFoundPageTemplate({ path: "/x", clock: "4:34 PM" }));
    expect(frag.querySelector(".nf-taskbar .nf-tray time")?.textContent).toBe("4:34 PM");
    expect(frag.querySelector(".nf-taskbar a.nf-start")?.getAttribute("href")).toBe("/");
    expect(frag.querySelector(".nf-win .nf-close")?.getAttribute("href")).toBe("/");
  });

  it("reports each pick by its code and lets the link go on", () => {
    const frag = renderToFragment(notFoundPageTemplate({ path: "/x" }));
    const picks: [Element, string][] = [
      ...buttons(frag).map((a, i) => [a, ["game", "manual", "changelog", "rooms"][i]] as [Element, string]),
      [frag.querySelector(".nf-close")!, "close"],
      [frag.querySelector(".nf-start")!, "taskbar"],
    ];
    for (const [link, code] of picks) {
      trackAppAction.mockClear();
      const click = new MouseEvent("click", {
        cancelable: true,
        bubbles: true,
      });
      link.dispatchEvent(click);
      expect(trackAppAction.mock.calls).toEqual([["not_found_pick", code]]);
      expect(click.defaultPrevented).toBe(false);
    }
  });

  it("counts a middle-click that opens a new tab, and no right-click", () => {
    const frag = renderToFragment(notFoundPageTemplate({ path: "/x" }));
    const links = [...buttons(frag), frag.querySelector(".nf-close")!, frag.querySelector(".nf-start")!];
    for (const link of links) {
      trackAppAction.mockClear();
      link.dispatchEvent(new MouseEvent("auxclick", { button: 2, bubbles: true }));
      expect(trackAppAction).not.toHaveBeenCalled();
      link.dispatchEvent(new MouseEvent("auxclick", { button: MIDDLE_BUTTON, bubbles: true }));
      expect(trackAppAction).toHaveBeenCalledTimes(1);
    }
  });

  it("closes a game-opened tab on every way back to the game, and only those", () => {
    const frag = renderToFragment(notFoundPageTemplate({ path: "/x", fromGame: true }));
    expect(frag.querySelector("#back-note")).not.toBeNull();
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    try {
      const toGame = [...frag.querySelectorAll('a[data-act="back-to-game"]')];
      expect(toGame.map((a) => a.className)).toEqual(["btn xs nf-close", "btn primary", "nf-start"]);
      for (const a of toGame) {
        const click = new MouseEvent("click", {
          cancelable: true,
          bubbles: true,
        });
        a.dispatchEvent(click);
        expect(click.defaultPrevented).toBe(true);
      }
      expect(close).toHaveBeenCalledTimes(3);
      const manual = new MouseEvent("click", {
        cancelable: true,
        bubbles: true,
      });
      buttons(frag)[1].dispatchEvent(manual);
      expect(manual.defaultPrevented).toBe(false);
      expect(close).toHaveBeenCalledTimes(3);
    } finally {
      close.mockRestore();
    }
  });

  it("leaves the game's links alone when the game did not open this tab", () => {
    const frag = renderToFragment(notFoundPageTemplate({ path: "/x" }));
    expect(frag.querySelector("#back-note")).toBeNull();
    const click = new MouseEvent("click", { cancelable: true, bubbles: true });
    frag.querySelector('a[data-act="back-to-game"]')!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
  });
});

describe("404.html", () => {
  const page = readFileSync(resolve(__dirname, "404.html"), "utf8");

  it("resolves its relative asset URLs from the site root, so it works at any depth", () => {
    // The build writes "./assets/..." (base "./"); served at /help/a/b they
    // would point into /help/a/ without the base element, first in the head.
    const head = page.slice(page.indexOf("<head>"), page.indexOf("</head>"));
    expect(head).toMatch(/^<head>\s*(<!--[\s\S]*?-->\s*)?<base href="\/" \/>/);
  });

  it("is not indexed", () => {
    expect(page).toContain('<meta name="robots" content="noindex" />');
  });
});
