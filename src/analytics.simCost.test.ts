import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendToRelay } from "./analyticsRelay";
import { gameplaySession } from "./analytics";

// session_sim_cost and the tower context on session_fps. Same transport stubs
// as analytics.fps.test.ts: the relay is stubbed so the contract is asserted
// without a real endpoint.
vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
vi.mock("./analyticsRelay", () => ({ sendToRelay: vi.fn() }));

const prod = "https://verticopolis.com/";
const localhost = "http://localhost:3000/";

describe("session engine cost (session_sim_cost)", () => {
  let clock: number;
  let nowSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    window.location.href = prod;
    gameplaySession.reset();
    vi.mocked(sendToRelay).mockReset();
    clock = 1_000;
    nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);
  });
  afterEach(() => {
    nowSpy.mockRestore();
    window.location.href = localhost;
  });

  /** `hours` game hours of 15-minute steps that each took `ms`, with a
   *  rendered frame per step, starting from game minute 600. */
  function play(hours: number, ms: number, speed: number, population: number): void {
    let minutes = 600;
    gameplaySession.noteSimStep(ms, minutes, speed, population, 1); // anchor
    for (let i = 0; i < hours * 4; i++) {
      minutes += 15;
      clock += 1000 / 60;
      gameplaySession.noteFrame();
      gameplaySession.noteSimStep(ms, minutes, speed, population, 1);
    }
  }

  it("sends the engine's milliseconds per game hour once, with the tower's size and speed", () => {
    gameplaySession.begin();
    play(40, 2.5, 50, 3200);
    gameplaySession.end();
    gameplaySession.begin();
    play(4, 9, 50, 3300);
    gameplaySession.end();
    const sent = vi.mocked(sendToRelay).mock.calls.filter(([name]) => name === "session_sim_cost");
    expect(sent).toEqual([["session_sim_cost", { ms_per_game_hour: 10, game_hours: 40, population: 3200, speed: 50 }]]);
  });

  it("puts the peak population and the main speed on session_fps", () => {
    gameplaySession.begin();
    play(40, 1, 15, 800);
    gameplaySession.end();
    expect(sendToRelay).toHaveBeenCalledWith("session_fps", expect.objectContaining({ population: 800, speed: 15 }));
  });

  it("waits for two game hours before sending", () => {
    gameplaySession.begin();
    play(1, 3, 15, 50);
    gameplaySession.end();
    expect(sendToRelay).not.toHaveBeenCalledWith("session_sim_cost", expect.anything());
  });

  it("counts nothing while the tab is hidden", () => {
    play(10, 3, 15, 50); // never begun: background
    gameplaySession.end();
    expect(sendToRelay).not.toHaveBeenCalledWith("session_sim_cost", expect.anything());
  });

  it("starts a new window from nothing", () => {
    gameplaySession.begin();
    play(10, 3, 15, 50);
    gameplaySession.startEpoch();
    play(1, 3, 15, 50);
    gameplaySession.end();
    expect(sendToRelay).not.toHaveBeenCalledWith("session_sim_cost", expect.anything());
  });
});
