import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendToRelay } from "./analyticsRelay";
import {
  gameplaySession,
  trackEconomyAction,
  trackEconomyActionOnce,
  trackEmergencyChoice,
} from "./analytics";
import { bindEngineBridge, forwardGameplayEvents, resetEngineBridge } from "./analyticsEngineBridge";

// The #611 gameplay-analytics surface: the economy_action event (demolish +
// latched price/capacity tuning), the per-occurrence emergency_choice, and the
// once-per-session session_emergencies summary. Stub the vendor surface like the
// sibling analytics suites so the host gate, the latches, and the multi-tower
// accumulator can be asserted without a real beacon.
vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
vi.mock("./analyticsRelay", () => ({ sendToRelay: vi.fn() }));

const prod = "https://verticopolis.com/";
const localhost = "http://localhost:3000/";

/** The props of every emitted event with the given name, in call order. */
function propsFor(name: string): Record<string, unknown>[] {
  return vi
    .mocked(sendToRelay)
    .mock.calls.filter(([n]) => n === name)
    .map(([, props]) => props as Record<string, unknown>);
}

describe("economy_action telemetry", () => {
  beforeEach(() => {
    window.location.href = prod;
    gameplaySession.reset(); // clears both the economy latch and the emergency accumulator
    vi.mocked(sendToRelay).mockReset();
  });

  afterEach(() => {
    window.location.href = localhost;
  });

  it("reports demolish per action with the sell/bulldoze detail", () => {
    trackEconomyAction("demolish", "bulldoze");
    trackEconomyAction("demolish", "sell");
    expect(propsFor("economy_action")).toEqual([
      { action: "demolish", detail: "bulldoze" },
      { action: "demolish", detail: "sell" },
    ]);
  });

  it("latches price_tune and capacity_tune to one emission each per session", () => {
    trackEconomyActionOnce("price_tune");
    trackEconomyActionOnce("price_tune");
    trackEconomyActionOnce("capacity_tune");
    trackEconomyActionOnce("capacity_tune");
    expect(propsFor("economy_action")).toEqual([{ action: "price_tune" }, { action: "capacity_tune" }]);
  });

  it("is host-gated: nothing fires on a non-deployed host", () => {
    window.location.href = localhost;
    trackEconomyAction("demolish", "sell");
    trackEconomyActionOnce("price_tune");
    trackEmergencyChoice("fireRescue", "accept");
    expect(sendToRelay).not.toHaveBeenCalled();
  });

  it("clears BOTH economy latches on reset (test isolation)", () => {
    trackEconomyActionOnce("price_tune");
    trackEconomyActionOnce("capacity_tune");
    gameplaySession.reset();
    window.location.href = prod; // reset does not touch the host
    trackEconomyActionOnce("price_tune"); // re-fires after reset
    trackEconomyActionOnce("capacity_tune"); // re-fires after reset
    // 2 before reset + 2 after = 4; a latch that survived reset would drop one.
    expect(propsFor("economy_action")).toHaveLength(4);
  });
});

describe("emergency_choice telemetry", () => {
  beforeEach(() => {
    window.location.href = prod;
    gameplaySession.reset();
    vi.mocked(sendToRelay).mockReset();
  });

  afterEach(() => {
    window.location.href = localhost;
  });

  it("reports each accept/decline once, carrying the kind", () => {
    trackEmergencyChoice("fireRescue", "accept");
    trackEmergencyChoice("bombThreat", "decline");
    expect(propsFor("emergency_choice")).toEqual([
      { kind: "fireRescue", decision: "accept" },
      { kind: "bombThreat", decision: "decline" },
    ]);
  });
});

describe("session_emergencies telemetry", () => {
  // The engine's emergency events, folded through the analytics bridge (#873
  // phase 2). `notePlaying` is the frame loop's throttled call, so it is what
  // marks a session as played.
  const fire = { name: "fire_started", payload: {} };
  const gutted = (rooms: number) => ({ name: "fire_gutted", payload: { rooms } });
  const bomb = (rooms: number) => ({ name: "bomb_detonated", payload: { rooms } });
  const played = (): void => gameplaySession.notePlaying();

  beforeEach(() => {
    window.location.href = prod;
    gameplaySession.reset();
    resetEngineBridge();
    vi.mocked(sendToRelay).mockReset();
  });

  afterEach(() => {
    window.location.href = localhost;
  });

  it("emits once at the terminal end EVEN WHEN ALL ZERO (for the denominator)", () => {
    played(); // the frame loop ran: a real play session
    gameplaySession.end(true); // pagehide (terminal)
    expect(propsFor("session_emergencies")).toEqual([{ fires: 0, firesGutRooms: 0, bombs: 0 }]);
  });

  it("carries the folded events through to the summary", () => {
    played();
    forwardGameplayEvents([fire, fire, gutted(3), bomb(4)]);
    gameplaySession.end(true);
    // A bomb counts once however many rooms it took; bomb rooms are not fire rooms.
    expect(propsFor("session_emergencies")).toEqual([{ fires: 2, firesGutRooms: 3, bombs: 1 }]);
  });

  it("waits for the terminal end: a mid-session tab-hide does NOT latch, so a LATE fire is still captured", () => {
    // The regression this fix addresses: a fire ignites AFTER an early tab switch.
    played(); // early in the session
    gameplaySession.end(false); // visibilitychange:hidden (tab switch, NOT terminal)
    expect(propsFor("session_emergencies")).toHaveLength(0); // nothing latched yet
    forwardGameplayEvents([fire, gutted(2)]); // player tabbed back, a fire ignited and gutted 2 rooms
    gameplaySession.end(true); // pagehide (terminal): the late fire is reported
    expect(propsFor("session_emergencies")).toEqual([{ fires: 1, firesGutRooms: 2, bombs: 0 }]);
  });

  it("sums every tower the tab played, across a new game in the same batch", () => {
    played();
    // Tower A's last events arrive in the same drain as tower B's founding.
    forwardGameplayEvents([fire, fire, gutted(1), { name: "tower_founded", payload: { mode: "classic" } }, fire, bomb(0)]);
    gameplaySession.end(true);
    expect(propsFor("session_emergencies")).toEqual([{ fires: 3, firesGutRooms: 1, bombs: 1 }]);
  });

  it("folds the engine's last events at the terminal end, so a fire in the final frame counts", () => {
    played();
    const pending = [fire, gutted(1)];
    bindEngineBridge(() => ({ drainGameplayEvents: () => pending.splice(0) as never, gameplayEventsDropped: 0, gameplayEvents: { discardOnHandOff: false } }));
    gameplaySession.end(true);
    expect(propsFor("session_emergencies")).toEqual([{ fires: 1, firesGutRooms: 1, bombs: 0 }]);
  });

  it("emits at most once per session across repeated terminal ends", () => {
    played();
    forwardGameplayEvents([fire]);
    gameplaySession.end(true);
    gameplaySession.end(true);
    expect(propsFor("session_emergencies")).toHaveLength(1);
  });

  it("does NOT emit for a no-play session the frame loop never ran", () => {
    gameplaySession.end(true); // frame loop never ticked
    expect(propsFor("session_emergencies")).toHaveLength(0);
  });

  it("is host-gated: nothing fires on a non-deployed host", () => {
    window.location.href = localhost;
    played();
    forwardGameplayEvents([fire, gutted(2), bomb(1)]);
    gameplaySession.end(true);
    expect(sendToRelay).not.toHaveBeenCalled();
  });
});
