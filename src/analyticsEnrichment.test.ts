import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  bootCommonProps,
  buildMode,
  distributionChannelLabel,
  platformLabel,
  recencyBucket,
  displayModeBucket,
  resolveDistributionChannel,
  resolvePlatformLabel,
  tenureBucket,
  DISTRIBUTION_CHANNEL_LABELS,
  PLATFORM_LABELS,
  type DistributionChannelLabel,
  type PlatformLabel,
} from "./analyticsEnrichment";

/** The enrichment source, read for the wiring guards below. Resolved from this
 *  file rather than the process CWD, so the guards keep proving something when
 *  the suite is run from anywhere but the repo root. */
const ENRICHMENT_SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), "./analyticsEnrichment.ts");

/** The body of a top-level exported function, by name. Anchored to the closing
 *  brace in column 0, so a guard written against one function can never drift
 *  into a later helper's text. */
function bodyOf(source: string, name: string): string {
  const found = new RegExp(String.raw`export function ${name}\([^)]*\)[^{]*\{([\s\S]*?)\n\}`).exec(source);
  expect(found, `could not find ${name} in the enrichment source`).not.toBeNull();
  return found![1];
}

/** The argument list of `call(...)` inside `body`, split into its arguments so
 *  a guard can assert ORDER. A containment check over the whole list would pass
 *  on a swapped call, which is exactly the mistake worth catching here. Split
 *  on plain commas: an argument that ever contains one fails the arity
 *  assertion loudly rather than mismatching in silence.
 *
 *  The call must also be the function's ONE call site and its ONE return, and
 *  sit at the outer indentation. `bodyOf` hands back the whole body, nested
 *  declarations included, so without those three the guard reads a call that
 *  never runs. The realistic mutation (a plain hardcoded `return "web"`) was
 *  already caught, since the call goes missing with it; what this closes is the
 *  deliberate-dead-code variant, a hardcoded return that parks a correct-looking
 *  call in a nested function nobody invokes. */
function argsOf(body: string, call: string): string[] {
  const callSites = body.split(`${call}(`).length - 1;
  expect(callSites, `expected exactly one ${call} call in the body`).toBe(1);
  const returns = body.split(/\breturn\b/).length - 1;
  expect(returns, `expected the body to return exactly once, through ${call}`).toBe(1);
  const found = new RegExp(String.raw`^  return ${call}\((.+)\);$`, "m").exec(body);
  expect(found, `could not find the ${call} call as the function's own return`).not.toBeNull();
  return found![1].split(",").map((arg) => arg.trim());
}

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

  it("PlatformLabel is exactly the four shipping surfaces", () => {
    expect([...PLATFORM_LABELS]).toEqual(["web", "twa", "ios", "desktop"]);
    expect(PLATFORM_LABELS).toHaveLength(4);
  });

  it("DistributionChannelLabel is exactly the six channels, unknown included", () => {
    // `unknown` is a member rather than an absence: a desktop build whose shell
    // named nothing must still land in the dataset, or the denominator lies.
    expect([...DISTRIBUTION_CHANNEL_LABELS]).toEqual(["web", "twa", "ios", "steam", "itch", "unknown"]);
    expect(DISTRIBUTION_CHANNEL_LABELS).toHaveLength(6);
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

  it("still reports web for a mode nothing here names", () => {
    // The BuildMode brand narrows the TYPE, and it must not narrow the runtime
    // contract with it: a mode added to the build later, before anyone teaches
    // this resolver about it, keeps falling through to `web` rather than
    // becoming a new label. `buildMode` is the tag, so an unnamed mode stays
    // expressible.
    expect(resolvePlatformLabel(buildMode("staging"), false, "")).toBe("web");
    expect(resolvePlatformLabel(buildMode(""), false, "?src=twa")).toBe("twa");
  });

  it("refuses a query string in the mode slot at COMPILE time", () => {
    // The reason `mode` is a branded BuildMode and not a bare `string`. With
    // both slots typed `string`, swapping arguments 1 and 3 typechecks, builds,
    // and reports `web` for every desktop and iOS session forever, while every
    // test in this file stays green (the runner's own mode is always "test").
    // The two @ts-expect-error lines below are the assertion: each FAILS if the
    // call ever starts compiling again.
    const search = "?src=twa";
    // @ts-expect-error a query string is not a build mode
    expect(resolvePlatformLabel(search, false, "desktop")).toBe("web");
    const mode: string = "desktop";
    // @ts-expect-error an untagged string is not a build mode either
    expect(resolvePlatformLabel(mode, false, "")).toBe("desktop");
  });
});

describe("resolveDistributionChannel", () => {
  it("maps each non-desktop surface to its own channel", () => {
    expect(resolveDistributionChannel("web", {})).toBe("web");
    expect(resolveDistributionChannel("twa", {})).toBe("twa");
    expect(resolveDistributionChannel("ios", {})).toBe("ios");
  });

  it("ignores a channel a non-desktop port has no business stamping", () => {
    // Only a desktop artifact is packaged per store, so the member is not even
    // read elsewhere: an iOS shell that stamped `steam` reports `ios`.
    expect(resolveDistributionChannel("ios", { distributionChannel: "steam" })).toBe("ios");
  });

  it("reports the two named desktop storefronts", () => {
    expect(resolveDistributionChannel("desktop", { distributionChannel: "steam" })).toBe("steam");
    expect(resolveDistributionChannel("desktop", { distributionChannel: "itch" })).toBe("itch");
  });

  it("reports unknown for anything else the shell injects, exact match only", () => {
    // The member crosses a repository boundary, so it is sanitized rather than
    // trusted: a near miss must land in `unknown` rather than mint a new
    // channel value nothing downstream knows about. No trimming and no case
    // folding, because a shell stamping `"STEAM"` has a packaging bug worth
    // seeing rather than papering over.
    expect(resolveDistributionChannel("desktop", {})).toBe("unknown");
    expect(resolveDistributionChannel("desktop", { distributionChannel: undefined })).toBe("unknown");
    expect(resolveDistributionChannel("desktop", { distributionChannel: "steam " })).toBe("unknown");
    expect(resolveDistributionChannel("desktop", { distributionChannel: " steam" })).toBe("unknown");
    expect(resolveDistributionChannel("desktop", { distributionChannel: "STEAM" })).toBe("unknown");
    expect(resolveDistributionChannel("desktop", { distributionChannel: "Itch" })).toBe("unknown");
    expect(resolveDistributionChannel("desktop", { distributionChannel: "evil" })).toBe("unknown");
    expect(resolveDistributionChannel("desktop", { distributionChannel: 42 })).toBe("unknown");
    expect(resolveDistributionChannel("desktop", { distributionChannel: null })).toBe("unknown");
    expect(resolveDistributionChannel("desktop", { distributionChannel: { toString: () => "steam" } })).toBe("unknown");
  });

  it("survives a hostile port whose distributionChannel getter throws", () => {
    // A dimension read must never throw out of boot enrichment. The port comes
    // from another repository, so a revoked Proxy or a booby-trapped getter is
    // in scope exactly as it is for `isPlatformPort`.
    const trapped = Object.defineProperty({}, "distributionChannel", {
      get() {
        throw new Error("revoked");
      },
    }) as { readonly distributionChannel?: unknown };
    expect(() => resolveDistributionChannel("desktop", trapped)).not.toThrow();
    expect(resolveDistributionChannel("desktop", trapped)).toBe("unknown");
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

  it("reads web with no marker (the test runner's mode is unwrapped and binds no port)", () => {
    window.location.href = "https://verticopolis.com/";
    expect(platformLabel()).toBe("web");
    expect(distributionChannelLabel(platformLabel())).toBe("web");
  });

  it("feeds the REAL build mode and the REAL port in, checked in the source", () => {
    // Asserted against the SOURCE TEXT, and that is the point. Under vitest
    // `import.meta.env.MODE` is "test" and the resolved port is the browser
    // default, so every behavioral assertion above compares an unwrapped answer
    // to an unwrapped answer. Both live reads could be replaced by constants
    // (a hardcoded mode, an empty object for the port) and stay green here
    // while every desktop build reported `web` and `unknown` forever. The same
    // technique platform.test.ts uses on IS_WRAPPED_BUILD, for the same reason.
    const source = readFileSync(ENRICHMENT_SOURCE, "utf8");
    expect(source, "the source file could not be read, so this test proves nothing").toContain("platformLabel");

    // POSITIONAL, because the resolver's mode and query-string arguments are
    // both text: a guard that only asked whether the argument LIST mentions
    // both would pass on a call that hands the query string to the mode slot,
    // and that call reports `web` for every desktop and iOS session forever.
    // The BuildMode brand makes the swap a compile error too; this is the
    // second lock, since the brand can be reapplied by hand.
    const platformArgs = argsOf(bodyOf(source, "platformLabel"), "resolvePlatformLabel");
    expect(platformArgs, "expected the three-argument resolvePlatformLabel call").toHaveLength(3);
    expect(platformArgs[0], "the build mode must be the FIRST argument").toContain("import.meta.env.MODE");
    expect(platformArgs[1], "the injected wrapper flag must be the SECOND argument").toContain(
      "getPlatform().isNativeWrapper",
    );
    expect(platformArgs[2], "the launch URL's query string must be the THIRD argument").toBe("search");

    // The channel must be resolved FROM the platform the caller already has.
    // A second independent `platformLabel()` read here would satisfy a "mentions
    // getPlatform()" check while letting the two dimensions disagree.
    const channelArgs = argsOf(bodyOf(source, "distributionChannelLabel"), "resolveDistributionChannel");
    expect(channelArgs, "expected the two-argument resolveDistributionChannel call").toHaveLength(2);
    expect(channelArgs[0], "the incoming platform parameter must be the FIRST argument").toBe("platform");
    expect(channelArgs[1], "the live port must be the SECOND argument").toContain("getPlatform()");
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
        onboarded: true,
        tenureDay: 12,
        savedAt: now - 3 * DAY,
        standalone: false,
        now,
      }),
    ).toEqual({
      platform: "twa",
      distribution_channel: "twa",
      returning: true,
      tenure: "d7-29",
      recency: "7d",
      display: "browser",
    });
  });

  it("carries the desktop pair as two separate dimensions", () => {
    // The whole point of the split: one runtime surface, several storefronts.
    // Two desktop sessions differ only in the channel, so a per-store read is a
    // filter on the same platform rather than a second platform value.
    const now = 1_000 * DAY;
    const base = { onboarded: true, tenureDay: 2, savedAt: now - DAY, standalone: false, now } as const;
    expect(bootCommonProps({ platform: "desktop", distributionChannel: "steam", ...base }).platform).toBe("desktop");
    expect(bootCommonProps({ platform: "desktop", distributionChannel: "steam", ...base }).distribution_channel).toBe(
      "steam",
    );
    expect(bootCommonProps({ platform: "desktop", distributionChannel: "itch", ...base }).distribution_channel).toBe(
      "itch",
    );
  });

  it("reports unknown buckets for a fresh visit with no tower and no save, and the standalone display bucket", () => {
    // A brand-new player: no in-game age passed, no autosave time; running installed.
    expect(
      bootCommonProps({
        platform: "web",
        distributionChannel: "web",
        onboarded: false,
        tenureDay: undefined,
        savedAt: undefined,
        standalone: true,
        now: DAY,
      }),
    ).toEqual({
      platform: "web",
      distribution_channel: "web",
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
        platform: "ios",
        distributionChannel: "ios",
        onboarded: true,
        tenureDay: 0,
        savedAt: now - 10 * DAY,
        standalone: false,
        now,
      }),
    ).toEqual({
      platform: "ios",
      distribution_channel: "ios",
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
