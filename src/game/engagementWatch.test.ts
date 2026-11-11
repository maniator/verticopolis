import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEngagementDetector,
  watchGameplayCommands,
} from "../analyticsEngagement";
import { noteEngineEngaged } from "../analyticsEngineStatus";
import { startEngagementWatch } from "./engagementWatch";

vi.mock("../analyticsEngagement", () => ({
  createEngagementDetector: vi.fn(),
  watchGameplayCommands: vi.fn(),
}));
vi.mock("../analyticsEngineStatus", () => ({ noteEngineEngaged: vi.fn() }));
vi.mock("./interactionState", () => ({
  isSplashUp: () => false,
  isDialogOpen: () => true,
}));

/** The engagement watch wires the port's commands and a once-a-second sample
 *  to the detector (`analyticsEngagement.test.ts` judges the samples), and
 *  stops sampling at the first engagement or a failed sample. */
describe("startEngagementWatch", () => {
  afterEach(() => vi.useRealTimers());

  it("samples each second with the tab, the blocking state and the clock, until the detector engages", () => {
    vi.useFakeTimers();
    const sample = vi.fn();
    let engaged: (by: string) => void = () => {};
    vi.mocked(createEngagementDetector).mockImplementation(
      ((onEngaged: (by: string) => void) => (
        (engaged = onEngaged),
        { sample }
      )) as never,
    );
    const port = {} as never;
    startEngagementWatch(port, () => 600);
    expect(watchGameplayCommands).toHaveBeenCalledExactlyOnceWith(
      port,
      expect.objectContaining({ sample }),
    );
    vi.advanceTimersByTime(2000);
    expect(sample).toHaveBeenCalledTimes(2);
    expect(sample).toHaveBeenLastCalledWith({
      visible: expect.any(Boolean),
      blocked: true,
      clock: 600,
    });
    engaged("build");
    expect(noteEngineEngaged).toHaveBeenCalledExactlyOnceWith("build");
    vi.advanceTimersByTime(2000);
    expect(sample, "engaged, it samples no more").toHaveBeenCalledTimes(2);
  });

  it("a sample that throws stops the watch", () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sample = vi.fn(() => {
      throw new Error("no clock");
    });
    vi.mocked(createEngagementDetector).mockImplementation((() => ({
      sample,
    })) as never);
    startEngagementWatch({} as never, () => 0);
    vi.advanceTimersByTime(3000);
    expect(sample).toHaveBeenCalledOnce();
  });
});
