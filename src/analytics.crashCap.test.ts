import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendToRelay } from "./analyticsRelay";
import { gameplaySession } from "./analytics";

/**
 * The per-session cap and dedup on the `crash` event.
 *
 * `noteCrash` fires every time the crash screen is shown, and a repeating WebGL
 * context loss re-shows it IN PLACE with no reload: one session emitted 8,269
 * `crash` events on 2026-09-12. The counts that produces are meaningless, and
 * worse, the flood spends the ingest route's per-IP minute budget so the SAME
 * session's `session_builds`, `tool_session_uses`, `session_fps` and
 * `session_end` are 429'd away, putting the data loss exactly on the sessions
 * worth studying. These tests pin the guard that stops it (`analyticsThrottle.ts`,
 * which the `$exception` path shares).
 *
 * Its own file so `analytics.test.ts` stays under the line guard.
 */

vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
vi.mock("./analyticsRelay", () => ({ sendToRelay: vi.fn() }));

const prod = "https://verticopolis.com/";
const localhost = "http://localhost:3000/";

/** The tower context every crash in these tests carries, so the assertions are
 *  about the crash SHAPE the fingerprint reads, not about this payload. */
const context = { version: "2.25.2", star: 3, population: 800 };

/** Every `crash` event the relay saw, in order, as [name, props] pairs. */
function crashCalls(): Array<[string, Record<string, unknown>]> {
  return vi.mocked(sendToRelay).mock.calls.filter(([name]) => name === "crash") as Array<[string, Record<string, unknown>]>;
}

describe("crash event cap and dedup", () => {
  beforeEach(() => {
    window.location.href = prod;
    gameplaySession.reset();
    vi.mocked(sendToRelay).mockReset();
  });

  afterEach(() => {
    window.location.href = localhost;
  });

  it("collapses a context-loss loop to the first loss and the first repeat", () => {
    // The shape a real loop has, per `recoverFromContextLoss`: the first mid-game
    // loss flushes and tries an in-place recovery, which fails, so it reports
    // `recoveryFailed: true` with `repeat: false`. Every later loss inside 90s
    // takes the repeat early return, so it reports `repeat: true` with
    // `recoveryFailed: false`. The two never both read true on a device, so the
    // loop is staged with exactly those two payloads rather than one `base`.
    const shared = { kind: "webgl-context-lost", saveFlushed: true, behindSplash: false, ...context };
    const firstLoss = { ...shared, repeat: false, recoveryFailed: true };
    const looping = { ...shared, repeat: true, recoveryFailed: false };
    gameplaySession.noteCrash(firstLoss);
    for (let i = 0; i < 40; i++) gameplaySession.noteCrash(looping);

    const crashes = crashCalls();
    expect(crashes).toHaveLength(2); // the two shapes the loop actually has
    // The first event's payload is untouched by the guard.
    expect(crashes[0][1]).toEqual(firstLoss);
    // The loop signal survives the dedup, which is why `repeat` is in the
    // fingerprint: without it the 40 repeats would collapse into the first loss
    // and nothing would ever report that this session looped.
    expect(crashes[1][1]).toEqual(looping);
  });

  it("reports a repeat-flagged loop even when no earlier crash shape preceded it", () => {
    // A loop whose first screen is already a repeat (the loss landed within 90s of
    // one from a previous page), so there is only ever one shape to report.
    const crash = { kind: "webgl-context-lost", repeat: true, recoveryFailed: false, saveFlushed: true, behindSplash: false, ...context };
    for (let i = 0; i < 25; i++) gameplaySession.noteCrash(crash);
    const crashes = crashCalls();
    expect(crashes).toHaveLength(1);
    expect(crashes[0][1]).toEqual(crash);
  });

  it("keeps a save-flush failure distinct from an identical crash that saved", () => {
    // saveFlushed is the one crash flag that reports actual player harm, and in a
    // long loop it can flip on its own (the crash flush writes a whole tower every
    // time, so storage can fill mid-flood) while every other flag holds. Leaving it
    // out of the fingerprint would drop that crash as a duplicate and the session
    // would report "saved" for a loss that lost the tower.
    const base = { kind: "webgl-context-lost", repeat: true, recoveryFailed: false, behindSplash: false, ...context };
    gameplaySession.noteCrash({ ...base, saveFlushed: true });
    gameplaySession.noteCrash({ ...base, saveFlushed: true }); // a true duplicate: dropped
    gameplaySession.noteCrash({ ...base, saveFlushed: false }); // the flush failed: a new shape
    const crashes = crashCalls();
    expect(crashes).toHaveLength(2);
    expect(crashes.map(([, props]) => props.saveFlushed)).toEqual([true, false]);
  });

  it("stops at the per-session cap even for genuinely distinct crash shapes", () => {
    const base = { kind: "webgl-context-lost", repeat: false, recoveryFailed: false, saveFlushed: true, behindSplash: false, ...context };
    // 16 distinct fingerprints: the cap has to hold whether or not the dedup
    // catches them first, since distinct-but-endless is a flood too.
    for (let i = 0; i < 16; i++) gameplaySession.noteCrash({ ...base, kind: `synthetic-loss-${i}` });
    expect(crashCalls()).toHaveLength(10);
  });

  it("re-opens the cap for a fresh measurement window", () => {
    const crash = { kind: "webgl-context-lost", repeat: false, recoveryFailed: false, saveFlushed: true, behindSplash: false, ...context };
    gameplaySession.noteCrash(crash);
    gameplaySession.noteCrash(crash); // deduped
    gameplaySession.reset(); // a consent epoch (or a test) opens a new window
    gameplaySession.noteCrash(crash);
    expect(crashCalls()).toHaveLength(2);
  });

  it("re-opens the cap for a new PAGE LIFE, which the session id outlives", () => {
    // The throttle is module memory, so a reload gives it a fresh budget, while
    // `sessionStorage` keeps the session id across that reload on purpose. One
    // `distinct_id` can therefore carry more than the cap. This pins the seam
    // rather than leaving it to be rediscovered: `reset()` stands in for the
    // fresh module a reload produces, and the crash screen's own reload button
    // is the path that reaches it.
    //
    // Deliberate. The flood the cap exists to stop needs no reload (the screen
    // re-shows in place, which is how one page life reached 8,269 events), and a
    // crash that survives a reload is a new incident worth reporting: the player
    // asked for a fresh page and the GPU died again.
    const crash = { kind: "webgl-context-lost", repeat: true, recoveryFailed: false, saveFlushed: true, behindSplash: false, ...context };
    for (let i = 0; i < 25; i++) gameplaySession.noteCrash({ ...crash, kind: `loss-${i}` });
    expect(crashCalls()).toHaveLength(10); // this page life is spent

    gameplaySession.reset(); // the reload
    for (let i = 0; i < 25; i++) gameplaySession.noteCrash({ ...crash, kind: `loss-${i}` });
    // A full second budget, under what would be the same session id on the wire.
    expect(crashCalls()).toHaveLength(20);
  });
});
