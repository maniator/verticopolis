import { afterEach, describe, expect, it, vi } from "vitest";
import { isInstalledStandalone } from "./standalone";

/**
 * Installed-standalone detection. It gates the one place a `target="_blank"`
 * link is unreliable (the in-app "Open full page" affordance), so both signals
 * matter: the `display-mode: standalone` media query (installed PWAs on every
 * current engine) and the older iOS `navigator.standalone` home-screen flag.
 */
describe("isInstalledStandalone", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window.navigator as { standalone?: boolean }).standalone;
  });

  function stubDisplayMode(matches: boolean): void {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (q: string) =>
        ({
          matches: q.includes("display-mode: standalone") ? matches : false,
          media: q,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );
  }

  it("is true when display-mode is standalone", () => {
    stubDisplayMode(true);
    expect(isInstalledStandalone()).toBe(true);
  });

  it("is true on the iOS home-screen flag even when the media query is false", () => {
    stubDisplayMode(false);
    (window.navigator as { standalone?: boolean }).standalone = true;
    expect(isInstalledStandalone()).toBe(true);
  });

  it("is false in a plain browser tab (neither signal set)", () => {
    stubDisplayMode(false);
    expect(isInstalledStandalone()).toBe(false);
  });
});
