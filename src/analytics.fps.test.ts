import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { track } from "@vercel/analytics";
import { gameplaySession } from "./analytics";

// The session_fps sampler split out of analytics.test.ts (that file hit the
// file-size ceiling). Same vendor stubs as the parent suite: the custom-event
// channel is host-gated and best-effort, so stub the whole vendor surface to
// assert the fps contract without touching real endpoints. A partial mock would
// leave a sibling symbol undefined and a later test would throw into the
// best-effort catch and silently drop the event.
vi.mock("@vercel/analytics", () => ({ track: vi.fn(), inject: vi.fn() }));
vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
vi.mock("./analyticsRelay", () => ({ sendToRelay: vi.fn() }));

const prod = "https://verticopolis.com/";
const localhost = "http://localhost:3000/";

/** Force the tab into a given visibility state (jsdom's is read-only). */
function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

describe("session frame-rate (session_fps)", () => {
  // noteFrame measures its OWN wall-clock delta (the engine's frame delta is
  // spike-clamped, which would hide hitches), so these tests drive a fake
  // performance.now() clock and advance it per frame. The first frame after a
  // begin() only sets the anchor and yields no sample, so a run of N smooth
  // frames of a given period needs one extra priming frame to reach N samples.
  let clock: number;
  let nowSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    window.location.href = prod;
    gameplaySession.reset();
    vi.mocked(track).mockReset();
    clock = 1_000;
    nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);
  });

  afterEach(() => {
    nowSpy.mockRestore();
    window.location.href = localhost;
    setVisibility("visible");
  });

  /** Advance the fake clock by `dtMs` and register one frame. */
  function frame(dtMs: number): void {
    clock += dtMs;
    gameplaySession.noteFrame();
  }
  /** Register `n` frames of a steady period, plus one priming frame that only
   *  sets the anchor, so exactly `n` samples land in the reservoir. */
  function steady(n: number, dtMs: number): void {
    frame(dtMs); // priming frame: sets the anchor, yields no sample
    for (let i = 0; i < n; i++) frame(dtMs);
  }
  const MS60 = 1000 / 60;
  const MS30 = 1000 / 30;
  const MS10 = 1000 / 10;

  it("emits p50 and low fps percentiles at session end from wall-clock deltas", () => {
    gameplaySession.begin(); // foreground
    frame(MS60); // priming frame anchors the sampler
    for (let i = 0; i < 180; i++) frame(MS60); // ~60fps smooth
    for (let i = 0; i < 20; i++) frame(MS10); // ~10fps hitches
    gameplaySession.end();
    // Sorted ascending, the 20 hitch frames sit in the low tail: p05 index (10)
    // lands on 10fps, p50 index (100) on 60fps. Whole-fps values.
    expect(track).toHaveBeenCalledWith("session_fps", { p50: 60, low: 10, samples: 200 });
  });

  it("records a real hitch as a low-fps sample, not a spike-clamped 1000fps", () => {
    // The regression guard for the engine's 200ms clamp: a long frame reaches the
    // sampler as its true wall-clock duration, so a half-second stall reads as
    // ~2fps in the low tail, never as a best-case frame.
    gameplaySession.begin();
    frame(MS60); // anchor
    for (let i = 0; i < 180; i++) frame(MS60);
    for (let i = 0; i < 20; i++) frame(500); // 20 real 500ms freezes -> 2fps each
    gameplaySession.end();
    const call = vi.mocked(track).mock.calls.find(([name]) => name === "session_fps");
    // p05 index (10) lands in the 2fps tail; the stalls are the WORST frames, not
    // 1000fps as the engine's 200ms spike-clamp would have made them.
    expect(call?.[1]).toMatchObject({ low: 2, p50: 60, samples: 200 });
  });

  it("does not emit session_fps below the minimum sample count", () => {
    gameplaySession.begin();
    steady(119, MS60);
    gameplaySession.end();
    expect(track).not.toHaveBeenCalledWith("session_fps", expect.anything());
  });

  it("samples fps only in the foreground (a begun visible segment)", () => {
    // No begin(): resumedAt is null, so frames are ignored and no fps is reported.
    for (let i = 0; i < 200; i++) frame(MS60);
    gameplaySession.end();
    expect(track).not.toHaveBeenCalledWith("session_fps", expect.anything());
  });

  it("skips a zero-length delta (two frames at the same timestamp)", () => {
    gameplaySession.begin();
    frame(MS60); // anchor
    gameplaySession.noteFrame(); // same clock value: dt = 0, skipped (not counted)
    for (let i = 0; i < 120; i++) frame(MS60);
    gameplaySession.end();
    // The duplicate-timestamp frame contributes nothing; only the 120 real frames.
    expect(track).toHaveBeenCalledWith("session_fps", { p50: 60, low: 60, samples: 120 });
  });

  it("drops a loop-interruption gap (in-place graphics recovery) instead of a sub-1fps sample", () => {
    // The render loop can stop and restart WITHOUT a hide/resume: an in-place
    // WebGL context-loss recovery rebuilds the engine while this page-lifetime
    // session stays active. The first frame back must not bank the whole outage
    // as a ~0fps sample in the worst-frame `low` tail.
    gameplaySession.begin();
    frame(MS60); // anchor
    for (let i = 0; i < 100; i++) frame(MS60); // 100 smooth samples
    frame(3000); // a 3-second loop stall: dropped and re-anchored, not sampled
    for (let i = 0; i < 20; i++) frame(MS60); // 20 more smooth samples -> 120 total
    gameplaySession.end();
    // If the 3s gap had leaked in, `low` would collapse toward 0; it stays 60.
    expect(track).toHaveBeenCalledWith("session_fps", { p50: 60, low: 60, samples: 120 });
  });

  it("re-anchors within a session across a hide/resume, so the gap is not sampled", () => {
    gameplaySession.begin();
    steady(100, MS60); // 100 samples, below the 120 gate: no report yet
    gameplaySession.end(); // tab hidden
    clock += 5 * 60 * 1000; // five minutes pass in the background
    gameplaySession.begin(); // resume the SAME session (no reset): anchor cleared
    // First frame only re-anchors; 20 more reach the 120 gate. If the 5-minute
    // gap had leaked in as a ~0fps sample, `low` would collapse.
    for (let i = 0; i < 21; i++) frame(MS60);
    gameplaySession.end();
    expect(track).toHaveBeenCalledWith("session_fps", { p50: 60, low: 60, samples: 120 });
  });

  it("counts the true frame total past the reservoir cap (bounded memory)", () => {
    gameplaySession.begin();
    steady(500, MS60); // > the 256 cap
    gameplaySession.end();
    const call = vi.mocked(track).mock.calls.find(([name]) => name === "session_fps");
    // All frames are 60fps, so the reservoir-replacement path is deterministic
    // here: p50/low stay 60 while `samples` reflects every frame seen.
    expect(call?.[1]).toEqual({ p50: 60, low: 60, samples: 500 });
  });

  it("emits session_fps at most once per session", () => {
    gameplaySession.begin();
    steady(200, MS60);
    gameplaySession.end(); // first background: fps reported
    gameplaySession.begin();
    steady(200, MS30);
    gameplaySession.end(); // second background: not re-reported
    const fpsCalls = vi.mocked(track).mock.calls.filter(([name]) => name === "session_fps");
    expect(fpsCalls).toHaveLength(1);
  });

  it("reset re-opens the fps sampler and re-anchors for a fresh session", () => {
    gameplaySession.begin();
    steady(200, MS60);
    gameplaySession.reset();
    window.location.href = prod; // reset() does not touch the host
    clock += 10 * 60 * 1000; // a long gap between the two sessions
    gameplaySession.begin();
    // No priming frame here: begin() cleared the anchor, so the first frame after
    // the 10-minute gap only re-anchors instead of sampling ~0fps. Then 130 real
    // 30fps frames make the reservoir.
    for (let i = 0; i < 131; i++) frame(MS30);
    gameplaySession.end();
    // If the gap had leaked in, `low` would be ~0; it is a clean 30fps.
    expect(track).toHaveBeenCalledWith("session_fps", { p50: 30, low: 30, samples: 130 });
  });
});
