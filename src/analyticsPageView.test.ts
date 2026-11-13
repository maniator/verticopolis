import { beforeEach, describe, expect, it, vi } from "vitest";

const trackEvent = vi.fn();
vi.mock("./analyticsCore", () => ({ trackEvent: (...args: unknown[]) => trackEvent(...args) }));

const { DIRECT, pageViewProps, trackPageView } = await import("./analyticsPageView");

const GAME = "https://verticopolis.com/";

beforeEach(() => trackEvent.mockReset());

describe("the landing page view", () => {
  it("keeps only the referrer's host, lowercased, never its path or query", () => {
    const props = pageViewProps("https://WWW.Reddit.com/r/SimTower/comments/abc/my_post/?share_id=secret", GAME);
    expect(props.$referring_domain).toBe("www.reddit.com");
    expect(JSON.stringify(props)).not.toMatch(/SimTower|share_id|secret|my_post/);
  });

  it("calls a visit with no referrer, or one that does not parse, direct", () => {
    expect(pageViewProps("", GAME).$referring_domain).toBe(DIRECT);
    expect(pageViewProps("not a url", GAME).$referring_domain).toBe(DIRECT);
  });

  it("keeps the landing path and the link's UTM tags", () => {
    const props = pageViewProps("", "https://verticopolis.com/play?utm_source=reddit&utm_medium=social&utm_campaign=launch-3.2");
    expect(props).toEqual({ $referring_domain: DIRECT, $pathname: "/play", utm_source: "reddit", utm_medium: "social", utm_campaign: "launch-3.2" });
  });

  it("drops a missing UTM tag, and one that is not a short plain token", () => {
    const props = pageViewProps("", `https://verticopolis.com/?utm_source=${encodeURIComponent("me@example.com")}&utm_medium=${"x".repeat(65)}`);
    expect(props).toMatchObject({ utm_source: null, utm_medium: null, utm_campaign: null });
  });

  it("clamps an overlong path", () => {
    expect(pageViewProps("", `https://verticopolis.com/${"a".repeat(300)}`).$pathname).toHaveLength(100);
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
