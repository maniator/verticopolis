import { afterEach, describe, expect, it } from "vitest";
import {
  bootCommonProps,
  platformLabel,
  recencyBucket,
  displayModeBucket,
  resolvePlatformLabel,
  tenureBucket,
} from "./analyticsEnrichment";

/**
 * The cookieless, on-device event enrichment (S4). Every value is a coarse
 * anonymous bucket: the tests pin the boundaries and the "unknown" fallbacks so
 * a future edit can't silently move a cutoff or turn a missing signal into a
 * confident bucket.
 */
describe("resolvePlatformLabel", () => {
  it("reports ios when a native wrapper port is present", () => {
    expect(resolvePlatformLabel(true, "")).toBe("ios");
  });

  it("lets the native wrapper win even with the twa marker on the URL", () => {
    // The iOS shell never sets ?src=twa, but the priority order is explicit:
    // a wrapper port outranks the start-URL marker.
    expect(resolvePlatformLabel(true, "?src=twa")).toBe("ios");
  });

  it("reports twa on the start-URL marker", () => {
    expect(resolvePlatformLabel(false, "?src=twa")).toBe("twa");
    expect(resolvePlatformLabel(false, "?utm=x&src=twa&y=1")).toBe("twa");
  });

  it("reports web for no marker, a different marker, or an empty query", () => {
    expect(resolvePlatformLabel(false, "")).toBe("web");
    expect(resolvePlatformLabel(false, "?src=web")).toBe("web");
    expect(resolvePlatformLabel(false, "?other=twa")).toBe("web");
  });
});

describe("platformLabel (live globals)", () => {
  afterEach(() => {
    window.location.href = "https://verticopolis.com/";
  });

  it("reads the twa marker off the launch URL", () => {
    window.location.href = "https://verticopolis.com/?src=twa";
    expect(platformLabel()).toBe("twa");
  });

  it("reads web with no marker (the plain web build in the test env is not a native wrapper)", () => {
    window.location.href = "https://verticopolis.com/";
    expect(platformLabel()).toBe("web");
  });
});

describe("tenureBucket", () => {
  it("buckets the in-game age in whole days", () => {
    expect(tenureBucket(0)).toBe("d0");
    expect(tenureBucket(0.9)).toBe("d0");
    expect(tenureBucket(1)).toBe("d1-6");
    expect(tenureBucket(6)).toBe("d1-6");
    expect(tenureBucket(7)).toBe("d7-29");
    expect(tenureBucket(29)).toBe("d7-29");
    expect(tenureBucket(30)).toBe("d30+");
    expect(tenureBucket(4000)).toBe("d30+");
  });

  it("reads a missing, non-finite, or negative age as unknown", () => {
    expect(tenureBucket(undefined)).toBe("unknown");
    expect(tenureBucket(Number.NaN)).toBe("unknown");
    expect(tenureBucket(Number.POSITIVE_INFINITY)).toBe("unknown");
    expect(tenureBucket(-1)).toBe("unknown");
  });
});

describe("recencyBucket", () => {
  const DAY = 86_400_000;

  it("buckets the wall-clock gap since the last save", () => {
    expect(recencyBucket(0)).toBe("1d");
    expect(recencyBucket(DAY - 1)).toBe("1d");
    expect(recencyBucket(DAY)).toBe("7d");
    expect(recencyBucket(7 * DAY - 1)).toBe("7d");
    expect(recencyBucket(7 * DAY)).toBe("30d");
    expect(recencyBucket(30 * DAY - 1)).toBe("30d");
    expect(recencyBucket(30 * DAY)).toBe("30d+");
    expect(recencyBucket(400 * DAY)).toBe("30d+");
  });

  it("reads a missing, non-finite, or negative gap as unknown", () => {
    // Negative covers a clock skew where the save appears to be in the future.
    expect(recencyBucket(undefined)).toBe("unknown");
    expect(recencyBucket(Number.NaN)).toBe("unknown");
    expect(recencyBucket(Number.POSITIVE_INFINITY)).toBe("unknown");
    expect(recencyBucket(-1)).toBe("unknown");
  });
});

describe("bootCommonProps", () => {
  const DAY = 86_400_000;

  it("maps each live signal to its bucket and passes platform + returning through", () => {
    const now = 1_000 * DAY;
    expect(
      bootCommonProps({ platform: "twa", onboarded: true, tenureDay: 12, savedAt: now - 3 * DAY, standalone: false, now }),
    ).toEqual({ platform: "twa", returning: true, tenure: "d7-29", recency: "7d", display: "browser" });
  });

  it("reports unknown buckets for a fresh visit with no tower and no save, and the standalone display bucket", () => {
    // A brand-new player: no in-game age passed, no autosave time; running installed.
    expect(
      bootCommonProps({ platform: "web", onboarded: false, tenureDay: undefined, savedAt: undefined, standalone: true, now: DAY }),
    ).toEqual({ platform: "web", returning: false, tenure: "unknown", recency: "unknown", display: "standalone" });
  });

  it("reads a forged non-positive savedAt as unknown recency, never a confident bucket", () => {
    // A real save time is a positive epoch stamp; a negative (pre-epoch) or zero
    // savedAt is a forgery. It must read as "unknown", not turn `now - savedAt`
    // into an inflated positive delta that lands in "30d+".
    const now = 1_000 * DAY;
    expect(bootCommonProps({ platform: "web", onboarded: false, tenureDay: 3, savedAt: -5, standalone: false, now }).recency).toBe(
      "unknown",
    );
    expect(bootCommonProps({ platform: "web", onboarded: false, tenureDay: 3, savedAt: 0, standalone: false, now }).recency).toBe(
      "unknown",
    );
  });

  it("keeps tenure and recency independent (the day axis is not the save-time axis)", () => {
    // Guards the wiring against swapping tenureDay and savedAt: a day-0 tower
    // last saved 10 days ago must read d0 tenure but 30d recency.
    const now = 100 * DAY;
    expect(
      bootCommonProps({ platform: "ios", onboarded: true, tenureDay: 0, savedAt: now - 10 * DAY, standalone: false, now }),
    ).toEqual({ platform: "ios", returning: true, tenure: "d0", recency: "30d", display: "browser" });
  });
});

describe("displayModeBucket", () => {
  it("maps the standalone boolean to its coarse bucket", () => {
    expect(displayModeBucket(true)).toBe("standalone");
    expect(displayModeBucket(false)).toBe("browser");
  });
});
