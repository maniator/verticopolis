import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendToRelay } from "./analyticsRelay";
import { gameplaySession } from "./analytics";

/**
 * The `final` flag on `session_end`, and the one row it is allowed past the
 * whole-second dedup.
 *
 * `session_end` re-fires on every tab-hide with a cumulative length, because the
 * terminal `pagehide` is not reliably delivered. `final` marks an emission made
 * from `pagehide` so the terminal row is identifiable without giving up that
 * fallback, and the terminal emission is let past the whole-second dedup once,
 * because on the ordinary close path (`visibilitychange: hidden`, then `pagehide`
 * in the same rounded second) the dedup would otherwise swallow it and the flag
 * would be unreachable.
 *
 * What these pin is the part that is easy to get wrong in the OTHER direction:
 * the allowance must not add a row for a blink-and-leave visit, and it is spent
 * once per window, so a bfcache `pagehide` can spend it early. When that happens
 * the session's LENGTH is unaffected (the later, larger row still reports it);
 * only which row carries the flag moves. That distinction matters enough to pin,
 * because an earlier reading of it claimed the length was lost.
 *
 * Kept as its own file so `analytics.test.ts` stays under the line guard.
 */

vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
vi.mock("./analyticsRelay", () => ({ sendToRelay: vi.fn() }));

const prod = "https://verticopolis.com/";
const localhost = "http://localhost:3000/";

describe("session_end final flag", () => {
  beforeEach(() => {
    window.location.href = prod;
    gameplaySession.reset();
    vi.mocked(sendToRelay).mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.location.href = localhost;
  });

  it("marks the terminal emission final, and lets it past the whole-second dedup once", () => {
    vi.setSystemTime(0);
    gameplaySession.begin();
    vi.setSystemTime(4000);
    gameplaySession.end(false); // visibilitychange:hidden
    gameplaySession.end(true); // pagehide in the same rounded second
    gameplaySession.end(true); // a second terminal signal must not add a row
    const ends = vi.mocked(sendToRelay).mock.calls.filter(([name]) => name === "session_end");
    expect(ends).toHaveLength(2);
    expect(ends[0][1]).toEqual({ seconds: 4, final: false });
    expect(ends[1][1]).toEqual({ seconds: 4, final: true });
  });

  it("keeps the length but moves the final flag when a bfcache pagehide spends the allowance", () => {
    // The sequence the #621 backlog row is about: pagehide into bfcache, restore,
    // play on, then close the tab (hidden, then pagehide in the same second).
    vi.setSystemTime(0);
    gameplaySession.begin();
    vi.setSystemTime(60_000);
    gameplaySession.end(true); // bfcache entry: spends the one terminal allowance
    gameplaySession.begin(); // pageshow -> visible
    vi.setSystemTime(660_000);
    gameplaySession.end(false); // visibilitychange: hidden
    gameplaySession.end(true); // pagehide, same rounded second, allowance spent
    const ends = vi.mocked(sendToRelay).mock.calls.filter(([name]) => name === "session_end");
    // The LENGTH is intact: the largest row still reports the whole 660s. What
    // the spent allowance costs is only which row carries the flag.
    expect(ends.map(([, props]) => props)).toEqual([
      { seconds: 60, final: true },
      { seconds: 660, final: false },
    ]);
  });

  it("emits a second final row when a later pagehide has a length of its own", () => {
    // The same bfcache restore, but the page is navigated away rather than
    // hidden first, so the terminal end clears the whole-second dedup on its own
    // and does not need the allowance. Two `final: true` rows, one session: this
    // is why `final` is documented as unique at no level.
    vi.setSystemTime(0);
    gameplaySession.begin();
    vi.setSystemTime(60_000);
    gameplaySession.end(true);
    gameplaySession.begin();
    vi.setSystemTime(660_000);
    gameplaySession.end(true);
    const ends = vi.mocked(sendToRelay).mock.calls.filter(([name]) => name === "session_end");
    expect(ends.map(([, props]) => props)).toEqual([
      { seconds: 60, final: true },
      { seconds: 660, final: true },
    ]);
  });

  it("stays silent on a terminal end with nothing to report", () => {
    // A prerender or blink-and-leave visit. The rule above must not start emitting
    // a zero-length row for every such visit, which would drag the median down.
    vi.setSystemTime(0);
    gameplaySession.begin();
    vi.setSystemTime(300); // 0.3s -> rounds to 0
    gameplaySession.end(true);
    expect(sendToRelay).not.toHaveBeenCalledWith("session_end", expect.anything());
  });
});
