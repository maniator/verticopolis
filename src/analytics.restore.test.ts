import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendToRelay } from "./analyticsRelay";
import { gameplaySession, startGameplaySession } from "./analytics";

// The per-window summaries across a back/forward-cache restore (#621). The
// relay is stubbed, as in the sibling analytics suites, so the contract is
// asserted without a real endpoint.
vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
vi.mock("./analyticsRelay", () => ({ sendToRelay: vi.fn() }));

const prod = "https://verticopolis.com/";
const localhost = "http://localhost:3000/";

/** A `pageshow`; `persisted` true is a restore from the back/forward cache. */
function pageshow(persisted: boolean): Event {
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: persisted });
  return event;
}

/** Every payload the relay saw for one event, in order. */
function sent(name: string): unknown[] {
  return vi
    .mocked(sendToRelay)
    .mock.calls.filter(([n]) => n === name)
    .map(([, props]) => props);
}

describe("summaries across a back/forward-cache restore (#621)", () => {
  beforeEach(() => {
    window.location.href = prod;
    gameplaySession.reset();
    vi.mocked(sendToRelay).mockReset();
    startGameplaySession();
  });
  afterEach(() => {
    window.location.href = localhost;
  });

  it("reports the play after a restore as its own summary, counting nothing twice", () => {
    gameplaySession.noteBuild("office", 4);
    gameplaySession.noteBuild("office", 5);
    window.dispatchEvent(new Event("pagehide")); // into the cache: first summary
    window.dispatchEvent(pageshow(true)); // back out of it
    gameplaySession.noteBuild("lobby", 0);
    window.dispatchEvent(new Event("pagehide")); // the real close
    expect(sent("session_builds")).toEqual([{ builds: 2 }, { builds: 1 }]);
    expect(sent("session_peak_floors")).toEqual([{ floors: 5 }, { floors: 0 }]);
    expect(sent("tool_session_uses")).toEqual([
      { tool: "office", uses: 2 },
      { tool: "lobby", uses: 1 },
    ]);
  });

  it("re-opens nothing on an ordinary page show, so a second hide sends no second summary", () => {
    gameplaySession.noteBuild("office", 4);
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(pageshow(false));
    gameplaySession.noteBuild("lobby", 0);
    window.dispatchEvent(new Event("pagehide"));
    expect(sent("session_builds")).toEqual([{ builds: 1 }]);
  });

  it("sends the restored stretch's emergencies on their own, after the fires the first summary carried", () => {
    gameplaySession.notePlaying();
    gameplaySession.noteEmergency("fires");
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(pageshow(true));
    gameplaySession.notePlaying();
    window.dispatchEvent(new Event("pagehide"));
    expect(sent("session_emergencies")).toEqual([
      { fires: 1, firesGutRooms: 0, bombs: 0 },
      { fires: 0, firesGutRooms: 0, bombs: 0 },
    ]);
  });
});
