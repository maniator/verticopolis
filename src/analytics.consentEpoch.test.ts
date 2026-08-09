import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gameplaySession, startGameplaySession } from "./analytics";
import { setAnalyticsAdapter, type AnalyticsAdapter, type EventProps } from "./analyticsAdapter";
import { resetDesktopConsentForTests, setDesktopConsent } from "./desktopConsent";

/**
 * The measurement window a desktop consent change opens (issue #781).
 *
 * The `note*` hooks accumulate whatever the player does, and the summaries
 * (`session_builds`, `session_peak_floors`, `tool_session_uses`, `session_fps`,
 * `session_emergencies`, `session_end`) are computed from those totals at a page
 * hide, long after the fact. Only the sends were ever gated, so a session that
 * ran with sharing off and then turned it back on used to report totals covering
 * the off stretch. These pin the fix: the answer changing starts the totals over,
 * in both directions.
 */

/** Which build the gate below stands in for. `desktop` answers from the consent
 *  state, which is what the live `telemetryHostAllowed` does for a wrapped build;
 *  `web` answers from the hostname, as it does for a browser build. Under vitest
 *  the real build mode is always "test", so the unmocked gate could only ever be
 *  the hostname half and the consent could never open or shut it. */
const gate = vi.hoisted(() => ({ mode: "desktop" as "desktop" | "web" }));

vi.mock("./telemetry", async (importOriginal) => {
  const real = await importOriginal<typeof import("./telemetry")>();
  const consent = await import("./desktopConsent");
  return {
    ...real,
    telemetryHostAllowed: () =>
      gate.mode === "desktop"
        ? consent.desktopAnalyticsAllowed("desktop")
        : real.telemetryHostAllowed("production"),
  };
});

/** The first-run hold reads the same build mode, and for the same reason has to
 *  be told which one to be: a "test" mode holds nothing, so the queue that makes
 *  a pre-answer summary dangerous could not be driven at all. The real queue and
 *  the real state do the work; only the mode is supplied. */
vi.mock("./desktopConsent", async (importOriginal) => {
  const real = await importOriginal<typeof import("./desktopConsent")>();
  return {
    ...real,
    holdWhilePending: (send: () => void): void =>
      real.holdWhilePending(send, gate.mode === "desktop" ? "desktop" : "production"),
  };
});

const sent: { event: string; props: EventProps }[] = [];
let restore: AnalyticsAdapter | undefined;

/** The props of every delivered event with the given name, in order. */
function propsFor(name: string): EventProps[] {
  return sent.filter((e) => e.event === name).map((e) => e.props);
}

beforeEach(() => {
  gate.mode = "desktop";
  localStorage.clear();
  resetDesktopConsentForTests();
  gameplaySession.reset();
  sent.length = 0;
  restore = setAnalyticsAdapter({
    send: (event, props) => void sent.push({ event, props }),
    injectPageTelemetry: () => {},
  });
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
  if (restore) setAnalyticsAdapter(restore);
  gameplaySession.reset();
  resetDesktopConsentForTests();
  localStorage.clear();
});

describe("a desktop consent change starts a fresh measurement window", () => {
  it("keeps an off stretch out of every summary sent after sharing is back on", () => {
    // The real sequence, driven through the real page-hide wiring: play with
    // sharing on, turn it off in Settings, play on, turn it back on, close the tab.
    setDesktopConsent("granted");
    startGameplaySession(); // consent already granted at boot: armed and timing
    gameplaySession.noteBuild("office", 5, 2);
    vi.setSystemTime(2000);
    setDesktopConsent("declined"); // the player turns sharing off
    gameplaySession.noteBuild("hotel", 40, 7); // and plays on, opted out
    gameplaySession.noteToolUsed("hotel");
    vi.setSystemTime(9000);
    setDesktopConsent("granted"); // and turns it back on
    gameplaySession.noteBuild("office", 3, 1);
    vi.setSystemTime(11000);
    window.dispatchEvent(new Event("pagehide"));

    expect(propsFor("session_builds"), "only the placement after the grant counts").toEqual([{ builds: 1 }]);
    expect(propsFor("session_peak_floors"), "floor 40 was built opted out").toEqual([{ floors: 3 }]);
    expect(propsFor("tool_session_uses")).toEqual([{ tool: "office", uses: 1 }]);
    expect(propsFor("session_end"), "and the clock covers the consented window only").toEqual([{ seconds: 2 }]);
    // The catch-all: nothing the player did while opted out may be recognizable in
    // anything that left, whatever event carried it.
    const leaked = sent.filter((e) => JSON.stringify(e.props).includes("hotel"));
    expect(leaked, "no trace of the opted-out stretch may leave").toEqual([]);
  });

  it("re-opens the once-per-session summaries for the window after a flip", () => {
    // Each summary is latched so it fires once per session. Those latches belong to
    // the window: a window that has never reported has to be able to.
    setDesktopConsent("granted");
    gameplaySession.begin();
    gameplaySession.noteBuild("office", 4, 3);
    vi.setSystemTime(3000);
    gameplaySession.end(false); // tab hidden: the consented window reports its depth
    expect(propsFor("session_builds")).toEqual([{ builds: 3 }]);

    gameplaySession.begin();
    setDesktopConsent("declined");
    gameplaySession.noteBuild("hotel", 40, 9); // opted out
    gameplaySession.end(false); // hidden again with sharing off: nothing may latch here
    gameplaySession.begin();
    setDesktopConsent("granted");
    gameplaySession.noteBuild("floor", 2, 1);
    vi.setSystemTime(9000);
    gameplaySession.end(true);

    expect(propsFor("session_builds"), "the new window reports its own depth, and only its own").toEqual([
      { builds: 3 },
      { builds: 1 },
    ]);
  });

  it("never releases a summary computed before the answer through the first-run flush", () => {
    // A page hide with the notice still open. The gate is shut, but a dropped event
    // is HELD rather than discarded, and a held event freezes its payload at emit
    // time, so a summary emitted here would still carry pre-answer totals when the
    // queue drains on the grant. No later reset could take that back, which is why
    // the summaries are skipped outright while the gate is shut.
    gameplaySession.begin();
    gameplaySession.noteBuild("office", 6, 4);
    vi.setSystemTime(4000);
    gameplaySession.end(false);
    expect(sent, "nothing leaves before the answer").toEqual([]);

    setDesktopConsent("granted"); // the player says yes and the queue drains
    expect(propsFor("session_builds"), "the flush may not carry a pre-answer summary").toEqual([]);
    expect(propsFor("session_peak_floors")).toEqual([]);
    expect(propsFor("session_end")).toEqual([]);
    expect(propsFor("first_build"), "the delta events it did hold still flush").toEqual([{ tool: "office" }]);
  });

  it("sends nothing at the moment sharing is turned off, and not that window later either", () => {
    // The choice this pins: turning sharing off DISCARDS the window rather than
    // emitting a farewell summary of the play up to that instant. A player who
    // turns the switch off expects the switch to stop traffic, and a summary sent
    // by the act of switching off is both traffic they caused by opting out and a
    // timestamped marker of the decision itself.
    setDesktopConsent("granted");
    gameplaySession.begin();
    gameplaySession.noteBuild("office", 12, 5);
    gameplaySession.noteEmergencyCounts(2, 3, 1); // a fire gutted 3 rooms, a bomb went off
    vi.setSystemTime(6000);
    const before = sent.length;
    setDesktopConsent("declined");
    expect(sent.slice(before), "opting out is not itself a reason to transmit").toEqual([]);

    setDesktopConsent("granted"); // back on, same tower, nothing new has happened
    gameplaySession.noteEmergencyCounts(2, 3, 1);
    vi.setSystemTime(8000);
    gameplaySession.end(true);
    expect(propsFor("session_builds"), "the 5 opted-out placements stay unsent").toEqual([]);
    expect(propsFor("session_emergencies"), "and the tower's earlier outbreaks are not this window's").toEqual([
      { fires: 0, firesGutRooms: 0, bombs: 0 },
    ]);
  });
});

describe("the browser path is untouched", () => {
  /**
   * A browser build has no consent surface: both writers of the answer sit behind
   * `IS_DESKTOP_BUILD` (pinned in `uiDesktopAnalytics.test.ts`), so nothing there
   * ever opens a new window and the reset can never fire. What is left to check is
   * that the shared code the desktop fix touched still behaves exactly as it did
   * when the gate is a plain hostname answer.
   */
  const prod = "https://verticopolis.com/";
  const localhost = "http://localhost:3000/";

  beforeEach(() => {
    gate.mode = "web";
    window.location.href = prod;
  });
  afterEach(() => {
    window.location.href = localhost;
  });

  it("reports depth once at the first background, at the value it held then", () => {
    gameplaySession.begin();
    gameplaySession.noteBuild("office", 5, 2);
    vi.setSystemTime(3000);
    gameplaySession.end(false);
    gameplaySession.begin();
    gameplaySession.noteBuild("floor", 3, 1); // more play after tabbing back
    vi.setSystemTime(9000);
    gameplaySession.end(false);
    expect(propsFor("session_builds"), "still once per session, still the first-background value").toEqual([
      { builds: 2 },
    ]);
    expect(propsFor("session_end"), "and one growing session, not two").toEqual([{ seconds: 3 }, { seconds: 9 }]);
  });

  it("sums emergencies across a tower replacement exactly as before", () => {
    gameplaySession.noteEmergencyCounts(2, 1, 0); // tower A accrues
    gameplaySession.noteEmergencyCounts(0, 0, 0); // a fresh tower restarts the counters
    gameplaySession.noteEmergencyCounts(1, 0, 1); // tower B accrues
    gameplaySession.end(true);
    expect(propsFor("session_emergencies")).toEqual([{ fires: 3, firesGutRooms: 1, bombs: 1 }]);
  });

  it("reports the same whatever desktop answer happens to be stored", () => {
    // A stray consent value on a browser profile means nothing: the web gate is the
    // hostname, and no browser surface writes the value in the first place.
    localStorage.setItem("vc.desktop-analytics", "declined");
    gameplaySession.begin();
    gameplaySession.noteBuild("office", 7, 3);
    vi.setSystemTime(5000);
    gameplaySession.end(true);
    expect(propsFor("session_builds")).toEqual([{ builds: 3 }]);
    expect(propsFor("session_end")).toEqual([{ seconds: 5 }]);
  });
});
