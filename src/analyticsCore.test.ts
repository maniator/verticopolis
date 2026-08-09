import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setCommonProps, trackEvent } from "./analyticsCore";
import { setAnalyticsAdapter, type AnalyticsAdapter, type EventProps } from "./analyticsAdapter";
import { telemetryHostAllowed } from "./telemetry";
import { holdWhilePending } from "./desktopConsent";

// The gate and the desktop hold are the two collaborators under test here, so
// both are stubbed and the choke point's own routing is what is asserted.
vi.mock("./telemetry", () => ({ telemetryHostAllowed: vi.fn(() => true) }));
vi.mock("./desktopConsent", () => ({ holdWhilePending: vi.fn() }));

/**
 * `trackEvent`, the one place every gameplay event passes through: the host
 * gate, the common-props merge, and (issue #781) the desktop first-run hold.
 *
 * The hold is asserted here rather than end to end because `holdWhilePending`
 * reads the live build mode, which is always `"test"` under vitest. What this
 * file proves is the WIRING: that a closed gate hands the event to the hold
 * instead of dropping it, that the held thunk sends exactly what the event
 * carried at emit time, and that an open gate never involves the hold at all.
 * The hold's own behavior (cap, order, discard) is covered in
 * `desktopConsent.test.ts`.
 */
describe("trackEvent routing", () => {
  let sent: { event: string; props: EventProps }[];
  let previous: AnalyticsAdapter;

  beforeEach(() => {
    sent = [];
    previous = setAnalyticsAdapter({
      send: (event, props) => sent.push({ event, props }),
      injectPageTelemetry: () => {},
    });
    vi.mocked(telemetryHostAllowed).mockReturnValue(true);
    vi.mocked(holdWhilePending).mockClear();
    setCommonProps({});
  });

  afterEach(() => {
    setAnalyticsAdapter(previous);
    setCommonProps({});
  });

  it("sends immediately when the gate is open, and holds nothing", () => {
    setCommonProps({ platform: "web", distribution_channel: "web" });
    trackEvent("star_reached", { star: 3 });
    expect(sent).toEqual([{ event: "star_reached", props: { platform: "web", distribution_channel: "web", star: 3 } }]);
    expect(holdWhilePending).not.toHaveBeenCalled();
  });

  it("sends nothing when the gate is closed, and offers the event to the hold instead", () => {
    vi.mocked(telemetryHostAllowed).mockReturnValue(false);
    trackEvent("boot", { reason: "fresh", version: "1.0.0", mode: "modern", star: 1, floors: 0, population: 0 });
    expect(sent, "a closed gate still sends nothing").toEqual([]);
    expect(holdWhilePending).toHaveBeenCalledTimes(1);
  });

  it("holds the event with the props it carried at EMIT time", () => {
    // The queue can outlive a common-props change (the boot enrichment lands
    // during boot, and the player may answer the notice after it). A held event
    // must describe the moment it happened.
    vi.mocked(telemetryHostAllowed).mockReturnValue(false);
    setCommonProps({ platform: "desktop", distribution_channel: "steam" });
    trackEvent("star_reached", { star: 4 });
    setCommonProps({ platform: "web", distribution_channel: "web" });
    const flush = vi.mocked(holdWhilePending).mock.calls[0][0];
    expect(sent).toEqual([]);
    flush();
    expect(sent).toEqual([
      { event: "star_reached", props: { platform: "desktop", distribution_channel: "steam", star: 4 } },
    ]);
  });

  it("keeps the per-event prop winning over a colliding common prop", () => {
    setCommonProps({ star: 99 } as EventProps);
    trackEvent("star_reached", { star: 2 });
    expect(sent[0].props.star).toBe(2);
  });

  it("never throws when the adapter does, on either path", () => {
    setAnalyticsAdapter({
      send: () => {
        throw new Error("transport down");
      },
      injectPageTelemetry: () => {},
    });
    expect(() => trackEvent("boot", { reason: "fresh", version: "1", mode: "modern", star: 1, floors: 0, population: 0 })).not.toThrow();
    vi.mocked(telemetryHostAllowed).mockReturnValue(false);
    trackEvent("star_reached", { star: 5 });
    const flush = vi.mocked(holdWhilePending).mock.calls[0][0];
    expect(() => flush(), "a held event that fails at flush must not escape either").not.toThrow();
  });
});
