import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "lit-html";
import { SPONSOR_URL, TWA_SESSION_KEY, splashTemplate, sponsorOffered, type SplashHandlers } from "./splashTemplate";

/**
 * The splash's Sponsor link and the wordmark's trademark mark (owner,
 * 2026-11-13). The template is rendered on its own with spy handlers, since
 * neither piece talks to the engine or the controller.
 */

function handlers(): SplashHandlers {
  return { onContinue: vi.fn(), onLoadTower: vi.fn(), onNewTower: vi.fn(), onHelp: vi.fn() };
}

function mount(): HTMLElement {
  const host = document.createElement("div");
  render(splashTemplate(true, "premise", false, false, false, handlers()), host);
  document.body.appendChild(host);
  return host;
}

const startUrl = window.location.href;
afterEach(() => {
  document.body.replaceChildren();
  window.history.replaceState(null, "", startUrl);
  sessionStorage.removeItem(TWA_SESSION_KEY);
});

describe("the splash's Sponsor link", () => {
  it("opens GitHub Sponsors in a new tab and ends the Tab order", () => {
    const host = mount();
    const link = host.querySelector<HTMLAnchorElement>('[data-splash="sponsor"]')!;
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("https://github.com/sponsors/maniator");
    expect(link.getAttribute("href")).toBe(SPONSOR_URL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.textContent!.trim()).toBe("Sponsor");
    const focusables = host.querySelectorAll("button, a[href]");
    expect(focusables[focusables.length - 1]).toBe(link);
  });

  it("is left out of the Android app (a ?src=twa launch), with the rest of the screen unchanged", () => {
    window.history.replaceState(null, "", "/?src=twa");
    const host = mount();
    expect(host.querySelector('[data-splash="sponsor"]')).toBeNull();
    expect(host.querySelector('[data-splash="load"]')).not.toBeNull();
  });

  it("stays out for the rest of the tab once it launched as the Android app", () => {
    window.history.replaceState(null, "", "/?src=twa");
    mount();
    // Back to game from the help site lands on "/" with no marker.
    window.history.replaceState(null, "", "/");
    document.body.replaceChildren();
    expect(mount().querySelector('[data-splash="sponsor"]')).toBeNull();
  });

  it("falls back to the launch URL when storage is blocked", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    expect(sponsorOffered(blocked)).toBe(true);
    window.history.replaceState(null, "", "/?src=twa");
    expect(sponsorOffered(blocked)).toBe(false);
  });
});

describe("the wordmark's trademark mark", () => {
  it("sits beside the lettering without changing the wordmark's accessible name", () => {
    const word = mount().querySelector(".splash-word")!;
    expect(word.querySelector("text.tm")!.textContent).toBe("™");
    expect(word.getAttribute("aria-label")).toBe("Verticopolis");
    // The lettering still fits by textLength, shortened to make room for the mark.
    expect(word.querySelector("text:not(.tm)")!.getAttribute("textLength")).toBe("380");
  });
});
