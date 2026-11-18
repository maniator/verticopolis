import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendToRelay } from "./analyticsRelay";
import { gameplaySession } from "./analytics";
import { forwardGameplayEvents, resetEngineBridge } from "./analyticsEngineBridge";
import { resetEngineStatus } from "./analyticsEngineStatus";
import { TOWER_N_CAP, analyticsTowerProps, nextAnalyticsTower } from "./analyticsTower";

// The first-tower funnel's tower fields (#2392): every funnel event names the
// tower of its page life it belongs to, so one tab's second tower can never
// finish its first tower's funnel. The relay is the mocked transport.
vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
vi.mock("./analyticsRelay", () => ({ sendToRelay: vi.fn() }));

const founded = (mode = "classic") => ({ name: "tower_founded", payload: { mode } });
const placed = (kind: string) => ({ name: "facility_placed", payload: { kind, floor: 1, count: 1 } });
const star = (s: number) => ({ name: "star_reached", payload: { star: s } });

type Funnel = { tower_n: number; page_life: string };
/** The funnel events sent, `[name, tower_n, page_life]`, in order. */
function funnel(): [string, number, string][] {
  return vi
    .mocked(sendToRelay)
    .mock.calls.filter(([n]) => n === "new_game_started" || n === "first_build" || n === "star_reached")
    .map(([n, p]) => [n, (p as Funnel).tower_n, (p as Funnel).page_life]);
}
/** The tower numbers a `new_game_started` opened: the funnel's entrants. */
const entrants = () => funnel().filter(([n]) => n === "new_game_started").map(([, t]) => t);

describe("the first-tower funnel's tower number", () => {
  beforeEach(() => {
    window.location.href = "https://verticopolis.com/";
    gameplaySession.reset();
    resetEngineBridge();
    vi.mocked(sendToRelay).mockReset();
  });

  it("gives each tower founded in one tab its own number, so a later tower's stars finish only its own funnel", () => {
    forwardGameplayEvents([founded(), placed("lobby")]);
    nextAnalyticsTower(); // the app follows the second New
    forwardGameplayEvents([founded("modern"), placed("office"), star(2)]);
    const [a, b] = entrants();
    expect(a).not.toBe(b);
    expect(funnel()).toEqual([
      ["new_game_started", a, expect.any(String)],
      ["first_build", a, expect.any(String)],
      ["new_game_started", b, expect.any(String)],
      ["first_build", b, expect.any(String)],
      ["star_reached", b, expect.any(String)],
    ]);
  });

  it("puts an opened tower's stars on a number no founding carries", () => {
    forwardGameplayEvents([founded(), placed("lobby")]);
    nextAnalyticsTower(); // File > Open: the app follows a saved tower, with no founding
    forwardGameplayEvents([star(2), star(3)]);
    const stars = funnel().filter(([n]) => n === "star_reached").map(([, t]) => t);
    expect(stars).toHaveLength(2);
    for (const t of stars) expect(entrants()).not.toContain(t);
  });

  it("keeps the replaced tower's late events off the new tower's number", () => {
    forwardGameplayEvents([founded()]);
    nextAnalyticsTower(); // the swap to a New
    // The old tower's star drains ahead of the new tower's founding.
    forwardGameplayEvents([star(2), founded(), placed("lobby")]);
    const late = funnel().find(([n]) => n === "star_reached");
    expect(late).toBeDefined();
    expect(entrants()).not.toContain(late?.[1]);
  });

  it("keeps the number for a star an undo made the tower earn again", () => {
    forwardGameplayEvents([founded(), placed("lobby"), star(2), star(2)]);
    const stars = funnel().filter(([n]) => n === "star_reached");
    expect(stars.map(([, t]) => t)).toEqual([entrants()[0], entrants()[0]]);
  });

  it("starts over in a new page life under a new page-life id, so a reload never reuses a key", () => {
    forwardGameplayEvents([founded()]);
    const [, before, lifeBefore] = funnel()[0];
    // A reload: a fresh page life, its count and its id both new. A real
    // reload loads fresh modules; the two reset hooks stand in for that.
    gameplaySession.reset();
    resetEngineStatus();
    vi.mocked(sendToRelay).mockReset();
    forwardGameplayEvents([founded()]);
    const [, after, lifeAfter] = funnel()[0];
    expect(after).toBe(before);
    expect(lifeAfter).not.toBe(lifeBefore);
  });

  it("stops at the cap, which stands for that tower or a later one", () => {
    for (let i = 0; i < TOWER_N_CAP + 10; i++) nextAnalyticsTower();
    expect(analyticsTowerProps().tower_n).toBe(TOWER_N_CAP);
  });

  it("writes nothing to the browser's storage", () => {
    const local = window.localStorage.length;
    const session = window.sessionStorage.length;
    forwardGameplayEvents([founded(), placed("lobby"), star(2)]);
    nextAnalyticsTower();
    expect(window.localStorage.length).toBe(local);
    expect(window.sessionStorage.length).toBe(session);
  });
});
