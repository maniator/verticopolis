import { beforeEach, describe, expect, it, vi } from "vitest";

const trackEvent = vi.fn();
vi.mock("./analyticsCore", () => ({ trackEvent: (...args: unknown[]) => trackEvent(...args) }));

const { DIRECT, OTHER, OTHER_PATH, pageViewProps, trackPageView } = await import("./analyticsPageView");

const GAME = "https://verticopolis.com/";

beforeEach(() => trackEvent.mockReset());

describe("the landing page view", () => {
  it("keeps only the referrer's host, lowercased, never its path or query", () => {
    const props = pageViewProps("https://WWW.Reddit.com/r/SimTower/comments/abc/my_post/?share_id=secret", GAME);
    expect(props.$referring_domain).toBe("www.reddit.com");
    expect(JSON.stringify(props)).not.toMatch(/SimTower|share_id|secret|my_post/);
  });

  it("lowercases a host the URL parser leaves as written", () => {
    expect(pageViewProps("android-app://Com.Example.App/", GAME).$referring_domain).toBe("com.example.app");
  });

  it("calls a visit with no referrer, one with no host, or one that does not parse, direct", () => {
    for (const referrer of ["", "not a url", "file:///C:/x.html", "data:text/html,x"]) expect(pageViewProps(referrer, GAME).$referring_domain, referrer).toBe(DIRECT);
  });

  it("never sends an IP address or a local machine name", () => {
    for (const referrer of ["http://192.168.1.10/", "http://[::1]:8080/", "http://localhost:5173/", "http://nas/", "http://printer.local/", "http://box.lan/", "http://localhost./", "http://nas./"]) {
      expect(pageViewProps(referrer, GAME).$referring_domain, referrer).toBe(OTHER);
    }
  });

  it("keeps the landing path and the link's UTM tags", () => {
    const props = pageViewProps("", "https://verticopolis.com/index.html?utm_source=reddit&utm_medium=social&utm_campaign=launch-3.2");
    expect(props).toEqual({ $referring_domain: DIRECT, $pathname: "/index.html", utm_source: "reddit", utm_medium: "social", utm_campaign: "launch-3.2" });
  });

  it("drops a missing UTM tag, and one that is not a short plain token", () => {
    const props = pageViewProps("", `https://verticopolis.com/?utm_source=${encodeURIComponent("me@example.com")}&utm_medium=${"x".repeat(65)}&utm_campaign=%2B15551234567`);
    expect(props).toMatchObject({ utm_source: null, utm_medium: null, utm_campaign: null });
  });

  it("sends any path outside the game's own as one value", () => {
    expect(pageViewProps("", "https://verticopolis.com/jane@example.com/x").$pathname).toBe(OTHER_PATH);
    expect(pageViewProps("", GAME).$pathname).toBe("/");
  });

  it("sends the page's own referrer and address as a $pageview", () => {
    vi.spyOn(document, "referrer", "get").mockReturnValue("https://news.ycombinator.com/item?id=1");
    trackPageView();
    expect(trackEvent).toHaveBeenCalledExactlyOnceWith("$pageview", pageViewProps("https://news.ycombinator.com/item?id=1", location.href));
    expect(trackEvent.mock.calls[0]![1].$referring_domain).toBe("news.ycombinator.com");
  });

  it("sends nothing and does not throw when the page has no readable referrer", () => {
    vi.spyOn(document, "referrer", "get").mockImplementation(() => {
      throw new Error("no document");
    });
    expect(() => trackPageView()).not.toThrow();
    expect(trackEvent).not.toHaveBeenCalled();
  });
});
