import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setCommonProps, trackEvent } from "./analyticsCore";
import { setAnalyticsAdapter, type AnalyticsAdapter, type EventProps } from "./analyticsAdapter";
import { telemetryHostAllowed } from "./telemetry";

// The gate is the collaborator under test here, so it is stubbed and the
// choke point's own routing is what is asserted.
vi.mock("./telemetry", () => ({ telemetryHostAllowed: vi.fn(() => true) }));

/**
 * `trackEvent`, the one place every gameplay event passes through: the host
 * gate and the common-props merge.
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
    setCommonProps({});
  });

  afterEach(() => {
    setAnalyticsAdapter(previous);
    setCommonProps({});
  });

  it("sends immediately when the gate is open, with the common props merged in", () => {
    setCommonProps({ platform: "web", distribution_channel: "web" });
    trackEvent("star_reached", { star: 3 });
    expect(sent).toEqual([{ event: "star_reached", props: { platform: "web", distribution_channel: "web", star: 3 } }]);
  });

  it("sends nothing when the gate is closed, and keeps nothing for later", () => {
    vi.mocked(telemetryHostAllowed).mockReturnValue(false);
    trackEvent("boot", { reason: "fresh", version: "1.0.0", mode: "modern", star: 1, floors: 0, population: 0 });
    vi.mocked(telemetryHostAllowed).mockReturnValue(true);
    trackEvent("star_reached", { star: 2 });
    expect(sent.map((e) => e.event), "the closed-gate event is gone, not queued").toEqual(["star_reached"]);
  });

  it("keeps the per-event prop winning over a colliding common prop", () => {
    setCommonProps({ star: 99 } as EventProps);
    trackEvent("star_reached", { star: 2 });
    expect(sent[0].props.star).toBe(2);
  });

  it("never throws when the adapter does", () => {
    setAnalyticsAdapter({
      send: () => {
        throw new Error("transport down");
      },
      injectPageTelemetry: () => {},
    });
    expect(() => trackEvent("boot", { reason: "fresh", version: "1", mode: "modern", star: 1, floors: 0, population: 0 })).not.toThrow();
  });
});
