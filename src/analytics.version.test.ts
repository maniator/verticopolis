import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendToRelay } from "./analyticsRelay";
import { trackEvent } from "./analyticsCore";
import { APP_VERSION } from "./appVersion";
import type { EventProps } from "./analyticsAdapter";

// Same wire contract the main analytics suite pins: events go relay-only, so
// `sendToRelay` is what gets stubbed and asserted against.
vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
vi.mock("./analyticsRelay", () => ({ sendToRelay: vi.fn() }));

const prod = "https://verticopolis.com/";

describe("the build version rides every event, whatever the entry point", () => {
  beforeEach(() => {
    window.location.href = prod;
    vi.mocked(sendToRelay).mockReset();
  });

  it("is present before any boot code runs, so a standalone page event carries it", async () => {
    // The defect this pins, in two parts.
    //
    // First: `$exception` recorded a null version for weeks, because the props
    // were only populated near the END of the app constructor while the error
    // listeners go up at the START of boot. Everything between could throw, and
    // that window produced the largest real error signal in production,
    // `WebGL context lost (at boot)`.
    //
    // Second, and the reason seeding inside `bootGame` was not enough: `/help`
    // and `/gallery` never call `bootGame` at all. They import the analytics
    // module and fire `page_help` / `page_gallery` immediately, so a fix that
    // ran during boot would still have shipped those two versionless.
    //
    // Importing the module fresh is the whole test: no boot, no enrichment,
    // nothing but module evaluation, and the version must already be there.
    vi.resetModules();
    const fresh = await import("./analyticsCore");
    expect(fresh.getCommonProps().version).toBe(APP_VERSION);
  });

  it("reaches an emitted event, not just the module state", () => {
    // Asserting the props object is only half the contract. A regression in the
    // merge or the send path would leave the version sitting in module state
    // while events still shipped without it, so this drives the real choke
    // point and reads the version back off the wire.
    trackEvent("game_started", { mode: "classic" });
    const props = vi.mocked(sendToRelay).mock.calls[0]?.[1] as EventProps | undefined;
    expect(props?.version).toBe(APP_VERSION);
  });
});
