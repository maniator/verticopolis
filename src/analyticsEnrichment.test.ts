import { afterEach, describe, expect, it } from "vitest";
import {
  bootCommonProps,
  distributionChannelLabel,
  platformLabel,
  recencyBucket,
  displayModeBucket,
  resolvePlatformLabel,
  tenureBucket,
  DISTRIBUTION_CHANNEL_LABELS,
  PLATFORM_LABELS,
  type DistributionChannelLabel,
  type PlatformLabel,
} from "./analyticsEnrichment";

/**
 * The cookieless, on-device event enrichment (S4). Every value is a coarse
 * anonymous bucket: the tests pin the boundaries and the "unknown" fallbacks so
 * a future edit can't silently move a cutoff or turn a missing signal into a
 * confident bucket.
 */
describe("the two dimensions are closed sets", () => {
  // Both directions at COMPILE time, which is the half a runtime list cannot
  // cover: a union member nobody listed, or a listed value the union does not
  // have, is a type error right here. The runtime assertions below then pin the
  // exact contents, so widening either union is a deliberate two-file edit
  // rather than something that rides along in a resolver change.
  const everyPlatformIsListed: (typeof PLATFORM_LABELS)[number] = "web" as PlatformLabel;
  const everyListedIsAPlatform: PlatformLabel[] = [...PLATFORM_LABELS];
  const everyChannelIsListed: (typeof DISTRIBUTION_CHANNEL_LABELS)[number] = "web" as DistributionChannelLabel;
  const everyListedIsAChannel: DistributionChannelLabel[] = [...DISTRIBUTION_CHANNEL_LABELS];
  void everyPlatformIsListed;
  void everyListedIsAPlatform;
  void everyChannelIsListed;
  void everyListedIsAChannel;

  it("PlatformLabel is exactly the browser game and the Android TWA", () => {
    expect([...PLATFORM_LABELS]).toEqual(["web", "twa"]);
  });

  it("DistributionChannelLabel mirrors the platform labels", () => {
    expect([...DISTRIBUTION_CHANNEL_LABELS]).toEqual(["web", "twa"]);
  });
});

describe("resolvePlatformLabel", () => {
  it("reports twa on the start-URL marker", () => {
    expect(resolvePlatformLabel("?src=twa")).toBe("twa");
    expect(resolvePlatformLabel("?a=1&src=twa")).toBe("twa");
  });

  it("reports web for no marker, a different marker, or an empty query", () => {
    expect(resolvePlatformLabel("")).toBe("web");
    expect(resolvePlatformLabel("?src=other")).toBe("web");
    expect(resolvePlatformLabel("?engine=wasm")).toBe("web");
  });
});

describe("platformLabel / distributionChannelLabel (live globals)", () => {
  afterEach(() => {
    window.location.href = "https://verticopolis.com/";
  });

  it("reads the twa marker off the launch URL, and the channel follows it", () => {
    window.location.href = "https://verticopolis.com/?src=twa";
    expect(platformLabel()).toBe("twa");
    expect(distributionChannelLabel(platformLabel())).toBe("twa");
  });

  it("reads web with no marker", () => {
    window.location.href = "https://verticopolis.com/";
    expect(platformLabel()).toBe("web");
    expect(distributionChannelLabel(platformLabel())).toBe("web");
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

  it("carries the build version, so an error can be tied to the build that threw it", () => {
    // REGRESSION GUARD. This shipped missing: every `$exception` in production
    // recorded a null version, which made it impossible to tell which release an
    // error came from, and cost real time during an investigation into a gap in
    // error reporting. It survived because the error reporter's own suite MOCKS
    // `getCommonProps` to return a version, so those tests asserted a contract
    // the production path never met. Asserting it on the real builder is what
    // closes that gap.
    expect(
      bootCommonProps({
        platform: "web",
        distributionChannel: "web",
        version: "2.22.0",
        onboarded: false,
        tenureDay: undefined,
        savedAt: undefined,
        standalone: false,
        now: 0,
      }).version,
    ).toBe("2.22.0");
  });

  it("maps each live signal to its bucket and passes both dimensions + returning through", () => {
    // The emitted KEY is `distribution_channel` while the input field is
    // `distributionChannel`: PostHog's built-in `$channel_type` already owns the
    // word `channel` in the property picker, so the wire name carries the
    // prefix. `toEqual` pins the whole emitted shape, so a key edit fails here.
    const now = 1_000 * DAY;
    expect(
      bootCommonProps({
        platform: "twa",
        distributionChannel: "twa",
        version: "9.9.9",
        onboarded: true,
        tenureDay: 12,
        savedAt: now - 3 * DAY,
        standalone: false,
        now,
      }),
    ).toEqual({
      platform: "twa",
      distribution_channel: "twa",
      version: "9.9.9",
      returning: true,
      tenure: "d7-29",
      recency: "7d",
      display: "browser",
    });
  });

  it("reports unknown buckets for a fresh visit with no tower and no save, and the standalone display bucket", () => {
    // A brand-new player: no in-game age passed, no autosave time; running installed.
    expect(
      bootCommonProps({
        platform: "web",
        distributionChannel: "web",
        version: "9.9.9",
        onboarded: false,
        tenureDay: undefined,
        savedAt: undefined,
        standalone: true,
        now: DAY,
      }),
    ).toEqual({
      platform: "web",
      distribution_channel: "web",
      version: "9.9.9",
      returning: false,
      tenure: "unknown",
      recency: "unknown",
      display: "standalone",
    });
  });

  it("reads a forged non-positive savedAt as unknown recency, never a confident bucket", () => {
    // A real save time is a positive epoch stamp; a negative (pre-epoch) or zero
    // savedAt is a forgery. It must read as "unknown", not turn `now - savedAt`
    // into an inflated positive delta that lands in "30d+".
    const now = 1_000 * DAY;
    const base = {
      platform: "web",
      distributionChannel: "web",
      version: "9.9.9",
      onboarded: false,
      tenureDay: 3,
      standalone: false,
      now,
    } as const;
    expect(bootCommonProps({ ...base, savedAt: -5 }).recency).toBe("unknown");
    expect(bootCommonProps({ ...base, savedAt: 0 }).recency).toBe("unknown");
  });

  it("keeps tenure and recency independent (the day axis is not the save-time axis)", () => {
    // Guards the wiring against swapping tenureDay and savedAt: a day-0 tower
    // last saved 10 days ago must read d0 tenure but 30d recency.
    const now = 100 * DAY;
    expect(
      bootCommonProps({
        platform: "twa",
        distributionChannel: "twa",
        version: "9.9.9",
        onboarded: true,
        tenureDay: 0,
        savedAt: now - 10 * DAY,
        standalone: false,
        now,
      }),
    ).toEqual({
      platform: "twa",
      distribution_channel: "twa",
      version: "9.9.9",
      returning: true,
      tenure: "d0",
      recency: "30d",
      display: "browser",
    });
  });
});

describe("displayModeBucket", () => {
  it("maps the standalone boolean to its coarse bucket", () => {
    expect(displayModeBucket(true)).toBe("standalone");
    expect(displayModeBucket(false)).toBe("browser");
  });
});
