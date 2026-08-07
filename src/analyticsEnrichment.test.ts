import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  bootCommonProps,
  channelLabel,
  platformLabel,
  recencyBucket,
  displayModeBucket,
  resolveChannel,
  resolvePlatformLabel,
  tenureBucket,
  CHANNEL_LABELS,
  PLATFORM_LABELS,
  type ChannelLabel,
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
  const everyChannelIsListed: (typeof CHANNEL_LABELS)[number] = "web" as ChannelLabel;
  const everyListedIsAChannel: ChannelLabel[] = [...CHANNEL_LABELS];
  void everyPlatformIsListed;
  void everyListedIsAPlatform;
  void everyChannelIsListed;
  void everyListedIsAChannel;

  it("PlatformLabel is exactly the four shipping surfaces", () => {
    expect([...PLATFORM_LABELS]).toEqual(["web", "twa", "ios", "desktop"]);
    expect(PLATFORM_LABELS).toHaveLength(4);
  });

  it("ChannelLabel is exactly the six channels, unknown included", () => {
    // `unknown` is a member rather than an absence: a desktop build whose shell
    // named nothing must still land in the dataset, or the denominator lies.
    expect([...CHANNEL_LABELS]).toEqual(["web", "twa", "ios", "steam", "itch", "unknown"]);
    expect(CHANNEL_LABELS).toHaveLength(6);
  });
});

describe("resolvePlatformLabel", () => {
  it("reports desktop for the desktop build mode", () => {
    expect(resolvePlatformLabel("desktop", false, "")).toBe("desktop");
  });

  it("reports ios for the native build mode", () => {
    expect(resolvePlatformLabel("native", false, "")).toBe("ios");
  });

  it("reports ios when an unwrapped-mode port claims to be a native wrapper", () => {
    // The flag is the fallback, not the key: iOS is the only wrapper specified
    // to inject a port, so a claim outside a wrapped mode still reads as iOS.
    expect(resolvePlatformLabel("production", true, "")).toBe("ios");
  });

  it("lets the build mode win over the injected flag and the twa marker", () => {
    // The point of #710. A desktop shell may inject no port at all (Electron
    // does its file save and external-open natively), so a flag-keyed label
    // would report `web` for a real desktop session; and a shell that DOES
    // inject one used to report `ios`. The mode is decided at build time, so it
    // is right in both cases, and it outranks a query string the shell could
    // never have set on purpose.
    expect(resolvePlatformLabel("desktop", false, "?src=twa")).toBe("desktop");
    expect(resolvePlatformLabel("desktop", true, "?src=twa")).toBe("desktop");
    expect(resolvePlatformLabel("native", false, "?src=twa")).toBe("ios");
  });

  it("reports twa on the start-URL marker", () => {
    expect(resolvePlatformLabel("production", false, "?src=twa")).toBe("twa");
    expect(resolvePlatformLabel("production", false, "?utm=x&src=twa&y=1")).toBe("twa");
  });

  it("reports web for no marker, a different marker, or an empty query", () => {
    expect(resolvePlatformLabel("production", false, "")).toBe("web");
    expect(resolvePlatformLabel("production", false, "?src=web")).toBe("web");
    expect(resolvePlatformLabel("production", false, "?other=twa")).toBe("web");
  });
});

describe("resolveChannel", () => {
  it("maps each non-desktop surface to its own channel", () => {
    expect(resolveChannel("web", {})).toBe("web");
    expect(resolveChannel("twa", {})).toBe("twa");
    expect(resolveChannel("ios", {})).toBe("ios");
  });

  it("ignores a channel a non-desktop port has no business stamping", () => {
    // Only a desktop artifact is packaged per store, so the member is not even
    // read elsewhere: an iOS shell that stamped `steam` reports `ios`.
    expect(resolveChannel("ios", { channel: "steam" })).toBe("ios");
  });

  it("reports the two named desktop storefronts", () => {
    expect(resolveChannel("desktop", { channel: "steam" })).toBe("steam");
    expect(resolveChannel("desktop", { channel: "itch" })).toBe("itch");
  });

  it("reports unknown for anything else the shell injects, exact match only", () => {
    // The member crosses a repository boundary, so it is sanitized rather than
    // trusted: a near miss must land in `unknown` rather than mint a new
    // channel value nothing downstream knows about. No trimming and no case
    // folding, because a shell stamping `"STEAM"` has a packaging bug worth
    // seeing rather than papering over.
    expect(resolveChannel("desktop", {})).toBe("unknown");
    expect(resolveChannel("desktop", { channel: undefined })).toBe("unknown");
    expect(resolveChannel("desktop", { channel: "steam " })).toBe("unknown");
    expect(resolveChannel("desktop", { channel: " steam" })).toBe("unknown");
    expect(resolveChannel("desktop", { channel: "STEAM" })).toBe("unknown");
    expect(resolveChannel("desktop", { channel: "Itch" })).toBe("unknown");
    expect(resolveChannel("desktop", { channel: "evil" })).toBe("unknown");
    expect(resolveChannel("desktop", { channel: 42 })).toBe("unknown");
    expect(resolveChannel("desktop", { channel: null })).toBe("unknown");
    expect(resolveChannel("desktop", { channel: { toString: () => "steam" } })).toBe("unknown");
  });

  it("survives a hostile port whose channel getter throws", () => {
    // A dimension read must never throw out of boot enrichment. The port comes
    // from another repository, so a revoked Proxy or a booby-trapped getter is
    // in scope exactly as it is for `isPlatformPort`.
    const trapped = Object.defineProperty({}, "channel", {
      get() {
        throw new Error("revoked");
      },
    }) as { readonly channel?: unknown };
    expect(() => resolveChannel("desktop", trapped)).not.toThrow();
    expect(resolveChannel("desktop", trapped)).toBe("unknown");
  });
});

describe("platformLabel / channelLabel (live globals)", () => {
  afterEach(() => {
    window.location.href = "https://verticopolis.com/";
  });

  it("reads the twa marker off the launch URL, and the channel follows it", () => {
    window.location.href = "https://verticopolis.com/?src=twa";
    expect(platformLabel()).toBe("twa");
    expect(channelLabel(platformLabel())).toBe("twa");
  });

  it("reads web with no marker (the test runner's mode is unwrapped and binds no port)", () => {
    window.location.href = "https://verticopolis.com/";
    expect(platformLabel()).toBe("web");
    expect(channelLabel(platformLabel())).toBe("web");
  });

  it("feeds the REAL build mode and the REAL port in, checked in the source", () => {
    // Asserted against the SOURCE TEXT, and that is the point. Under vitest
    // `import.meta.env.MODE` is "test" and the resolved port is the browser
    // default, so every behavioral assertion above compares an unwrapped answer
    // to an unwrapped answer. Both live reads could be replaced by constants
    // (a hardcoded mode, an empty object for the port) and stay green here
    // while every desktop build reported `web` and `unknown` forever. The same
    // technique platform.test.ts uses on IS_WRAPPED_BUILD, for the same reason.
    const source = readFileSync("src/analyticsEnrichment.ts", "utf8");
    expect(source, "the source file could not be read, so this test proves nothing").toContain("platformLabel");

    const platformCall = /export function platformLabel\(\)[\s\S]*?return resolvePlatformLabel\(([^;]*);/.exec(source);
    expect(platformCall, "could not find the resolvePlatformLabel call in platformLabel").not.toBeNull();
    expect(platformCall![1]).toContain("import.meta.env.MODE");
    expect(platformCall![1]).toContain("isNativeWrapper");

    const channelCall = /export function channelLabel\([\s\S]*?return resolveChannel\(([^;]*);/.exec(source);
    expect(channelCall, "could not find the resolveChannel call in channelLabel").not.toBeNull();
    expect(channelCall![1]).toContain("getPlatform()");
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

  it("maps each live signal to its bucket and passes platform + channel + returning through", () => {
    const now = 1_000 * DAY;
    expect(
      bootCommonProps({
        platform: "twa",
        channel: "twa",
        onboarded: true,
        tenureDay: 12,
        savedAt: now - 3 * DAY,
        standalone: false,
        now,
      }),
    ).toEqual({ platform: "twa", channel: "twa", returning: true, tenure: "d7-29", recency: "7d", display: "browser" });
  });

  it("carries the desktop pair as two separate dimensions", () => {
    // The whole point of the split: one runtime surface, several storefronts.
    // Two desktop sessions differ only in `channel`, so a per-store read is a
    // filter on the same platform rather than a second platform value.
    const now = 1_000 * DAY;
    const base = { onboarded: true, tenureDay: 2, savedAt: now - DAY, standalone: false, now } as const;
    expect(bootCommonProps({ platform: "desktop", channel: "steam", ...base }).platform).toBe("desktop");
    expect(bootCommonProps({ platform: "desktop", channel: "steam", ...base }).channel).toBe("steam");
    expect(bootCommonProps({ platform: "desktop", channel: "itch", ...base }).channel).toBe("itch");
  });

  it("reports unknown buckets for a fresh visit with no tower and no save, and the standalone display bucket", () => {
    // A brand-new player: no in-game age passed, no autosave time; running installed.
    expect(
      bootCommonProps({
        platform: "web",
        channel: "web",
        onboarded: false,
        tenureDay: undefined,
        savedAt: undefined,
        standalone: true,
        now: DAY,
      }),
    ).toEqual({
      platform: "web",
      channel: "web",
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
    const base = { platform: "web", channel: "web", onboarded: false, tenureDay: 3, standalone: false, now } as const;
    expect(bootCommonProps({ ...base, savedAt: -5 }).recency).toBe("unknown");
    expect(bootCommonProps({ ...base, savedAt: 0 }).recency).toBe("unknown");
  });

  it("keeps tenure and recency independent (the day axis is not the save-time axis)", () => {
    // Guards the wiring against swapping tenureDay and savedAt: a day-0 tower
    // last saved 10 days ago must read d0 tenure but 30d recency.
    const now = 100 * DAY;
    expect(
      bootCommonProps({
        platform: "ios",
        channel: "ios",
        onboarded: true,
        tenureDay: 0,
        savedAt: now - 10 * DAY,
        standalone: false,
        now,
      }),
    ).toEqual({ platform: "ios", channel: "ios", returning: true, tenure: "d0", recency: "30d", display: "browser" });
  });
});

describe("displayModeBucket", () => {
  it("maps the standalone boolean to its coarse bucket", () => {
    expect(displayModeBucket(true)).toBe("standalone");
    expect(displayModeBucket(false)).toBe("browser");
  });
});
