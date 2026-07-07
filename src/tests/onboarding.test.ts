import { describe, it, expect, beforeEach } from "vitest";
import { Simulation } from "../engine/Simulation";
import { GRID } from "../engine/facilities";
import {
  ONBOARD_STEPS,
  firstIncompleteStep,
  shouldArm,
  isOnboarded,
  markOnboarded,
  clearOnboarded,
} from "../ui/Onboarding";

const C = Math.floor(GRID.width / 2);

describe("Onboarding — flag persistence", () => {
  beforeEach(() => clearOnboarded());
  it("round-trips the once-only flag", () => {
    expect(isOnboarded()).toBe(false);
    markOnboarded();
    expect(isOnboarded()).toBe(true);
    clearOnboarded();
    expect(isOnboarded()).toBe(false);
  });
});

describe("Onboarding — arm gating", () => {
  beforeEach(() => clearOnboarded());
  it("arms only when the player starts a New Tower and hasn't onboarded", () => {
    expect(shouldArm(true)).toBe(true); // New Tower, first time
    expect(shouldArm(false)).toBe(false); // Continue never arms
    markOnboarded();
    expect(shouldArm(true)).toBe(false); // returning player, even on New Tower
  });
});

describe("Onboarding — steps advance on real progress", () => {
  it("firstIncompleteStep walks floor → office → connect → occupied", () => {
    const sim = Simulation.newGame(1); // seeds a ground lobby on floor 1
    sim.money = 1e9;
    expect(firstIncompleteStep(sim)).toBe(0); // nothing built above the lobby yet

    // Step 1: a floor above the lobby.
    for (let x = C - 10; x < C + 10; x++) sim.tower.place("floor", 2, x);
    expect(firstIncompleteStep(sim)).toBe(1);

    // Step 2: an office on it.
    const r = sim.tower.place("office", 2, C - 4);
    expect(r.ok).toBe(true);
    expect(firstIncompleteStep(sim)).toBe(2);

    // Step 3: connect the floor to the ground lobby.
    expect(sim.tower.placeTransport("elevatorStandard", C + 6, 1, 2).ok).toBe(true);
    expect(firstIncompleteStep(sim)).toBe(3);

    // Step 4: a tenant actually moves in.
    let guard = 0;
    while (!ONBOARD_STEPS[3].done(sim) && guard++ < 400) sim.tick(60);
    expect(ONBOARD_STEPS[3].done(sim)).toBe(true);
    expect(firstIncompleteStep(sim)).toBe(ONBOARD_STEPS.length); // all done
  });

  it("each step has distinct desktop and mobile hint copy and a pulse target", () => {
    for (const s of ONBOARD_STEPS) {
      expect(s.hintDesktop.length).toBeGreaterThan(0);
      expect(s.hintMobile.length).toBeGreaterThan(0);
      expect(s.hintDesktop).not.toBe(s.hintMobile); // device-specific gestures
      expect(s.pulse).toMatch(/pal-item|#speed/);
    }
  });
});

import { OnboardingController } from "../ui/Onboarding";

function makeController(mobile = false) {
  document.body.innerHTML = '<div id="hint"></div><div id="palette-scroll"></div><div id="speed"></div>';
  const mq = { matches: mobile, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList;
  return new OnboardingController({ mq, showHelp() {}, pauseForSplash() {}, chime() {} });
}

describe("Onboarding — controller lifecycle", () => {
  beforeEach(() => clearOnboarded());

  it("sets a device-aware default hint on construction (mobile ≠ desktop)", () => {
    makeController(true);
    const mobileHint = document.getElementById("hint")!.textContent;
    makeController(false);
    const desktopHint = document.getElementById("hint")!.textContent;
    expect(mobileHint).not.toBe(desktopHint);
    expect(mobileHint).toMatch(/[Tt]ap/);
  });

  it("arm() is re-entrant — re-arming never stacks a second panel", () => {
    const sim = Simulation.newGame(1);
    const c = makeController();
    expect(c.arm(sim)).toBe(true);
    c.arm(sim); // e.g. Replay while active
    c.arm(sim);
    expect(document.querySelectorAll("#onboard").length).toBe(1);
  });

  it("Skip marks onboarding done (once-only) and removes the panel", () => {
    const sim = Simulation.newGame(1);
    const c = makeController();
    c.arm(sim);
    document.querySelector<HTMLElement>('[data-onboard="skip"]')!.click();
    expect(isOnboarded()).toBe(true);
    expect(document.getElementById("onboard")).toBeNull();
    expect(c.arm(sim)).toBe(false); // never re-nags
  });

  it("resumes at the first uncompleted step when re-armed on a progressed tower", () => {
    const sim = Simulation.newGame(2);
    sim.money = 1e9;
    const cX = Math.floor(GRID.width / 2);
    for (let x = cX - 6; x < cX + 6; x++) sim.tower.place("floor", 2, x); // step 1
    sim.tower.place("office", 2, cX - 4); // step 2
    const c = makeController();
    c.arm(sim);
    expect(document.querySelector("#onboard .ob-cur")!.textContent).toContain("Connect it"); // step 3
  });

  it("arm() returns false and shows no panel on an already-complete tower", () => {
    const sim = Simulation.newGame(3);
    sim.money = 1e9;
    const cX = Math.floor(GRID.width / 2);
    for (let x = cX - 6; x < cX + 6; x++) sim.tower.place("floor", 2, x);
    const r = sim.tower.place("office", 2, cX - 4);
    sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
    sim.tower.placeTransport("elevatorStandard", cX + 5, 1, 2);
    const c = makeController();
    expect(c.arm(sim)).toBe(false); // all four steps already satisfied
    expect(document.getElementById("onboard")).toBeNull();
  });
});

import { vi, afterEach } from "vitest";

/** A controller wired with spy opts and an mq whose change handler is capturable. */
function makeSpyController(mobile = false) {
  document.body.innerHTML = '<div id="hint"></div><div id="palette-scroll"></div><div id="speed"></div>';
  let mqHandler: (() => void) | null = null;
  const mq = {
    matches: mobile,
    addEventListener: (_e: string, h: () => void) => {
      mqHandler = h;
    },
    removeEventListener() {},
  } as unknown as MediaQueryList;
  const opts = { mq, showHelp: vi.fn(), pauseForSplash: vi.fn(), chime: vi.fn() };
  const c = new OnboardingController(opts);
  return { c, opts, fireMq: () => mqHandler?.() };
}

describe("Onboarding — splash / title screen", () => {
  beforeEach(() => clearOnboarded());
  // showSplash registers a document-level keydown (Esc) handler that only its
  // own teardownSplash removes. Tests that leave a splash mounted would leak it
  // onto `document` across tests; drop any lingering overlay + Esc handler here.
  afterEach(() => {
    document.getElementById("splash")?.remove();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); // spends any live safeDismiss latch
  });

  it("mounts a modal splash, pauses the engine, and offers Continue only with a save", () => {
    const { c, opts } = makeSpyController();
    c.showSplash({ hasSave: true, onContinue: vi.fn(), onNewTower: vi.fn() });
    const splash = document.getElementById("splash")!;
    expect(splash.getAttribute("aria-modal")).toBe("true");
    expect(opts.pauseForSplash).toHaveBeenCalledWith(true);
    expect(splash.querySelector('[data-splash="continue"]')).not.toBeNull();
    expect(splash.querySelector(".splash-version")!.textContent).toMatch(/^v/);
  });

  it("hides Continue when there is no save", () => {
    const { c } = makeSpyController();
    c.showSplash({ hasSave: false, onContinue: vi.fn(), onNewTower: vi.fn() });
    expect(document.querySelector('[data-splash="continue"]')).toBeNull();
  });

  it("Continue tears down the splash, resumes the engine, and calls onContinue", () => {
    const { c, opts } = makeSpyController();
    const onContinue = vi.fn();
    c.showSplash({ hasSave: true, onContinue, onNewTower: vi.fn() });
    document.querySelector<HTMLElement>('[data-splash="continue"]')!.click();
    expect(document.getElementById("splash")).toBeNull();
    expect(opts.pauseForSplash).toHaveBeenLastCalledWith(false);
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it("New Tower keeps the splash up and hands the host a dismiss callback", () => {
    const { c } = makeSpyController();
    const onNewTower = vi.fn();
    c.showSplash({ hasSave: false, onContinue: vi.fn(), onNewTower });
    document.querySelector<HTMLElement>('[data-splash="new"]')!.click();
    expect(onNewTower).toHaveBeenCalledOnce();
    expect(document.getElementById("splash")).not.toBeNull(); // stays until host dismisses
    (onNewTower.mock.calls[0][0] as () => void)(); // invoke dismiss
    expect(document.getElementById("splash")).toBeNull();
  });

  it("Help opens help over the splash without dismissing it", () => {
    const { c, opts } = makeSpyController();
    c.showSplash({ hasSave: false, onContinue: vi.fn(), onNewTower: vi.fn() });
    document.querySelector<HTMLElement>('[data-splash="help"]')!.click();
    expect(opts.showHelp).toHaveBeenCalledOnce();
    expect(document.getElementById("splash")).not.toBeNull();
  });

  it("Esc resolves to the safe default: Continue with a save, no-op without one", () => {
    const withSave = makeSpyController();
    const onContinue = vi.fn();
    withSave.c.showSplash({ hasSave: true, onContinue, onNewTower: vi.fn() });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onContinue).toHaveBeenCalledOnce();
    expect(document.getElementById("splash")).toBeNull();

    const noSave = makeSpyController();
    const onContinue2 = vi.fn();
    noSave.c.showSplash({ hasSave: false, onContinue: onContinue2, onNewTower: vi.fn() });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onContinue2).not.toHaveBeenCalled(); // New Tower must be explicit
    expect(document.getElementById("splash")).not.toBeNull();
  });

  it("the persistent hint follows a media-query change (desktop ↔ mobile copy)", () => {
    const { fireMq, ...ctx } = makeSpyController(false);
    void ctx;
    const desktop = document.getElementById("hint")!.textContent;
    // Flip the mq to mobile and fire its change handler.
    (ctx.c as unknown as { opts: { mq: { matches: boolean } } }).opts.mq.matches = true;
    fireMq();
    expect(document.getElementById("hint")!.textContent).not.toBe(desktop);
  });
});

describe("Onboarding — tick advances and finishes on real progress", () => {
  beforeEach(() => clearOnboarded());

  it("advancing a step chimes and re-renders the new current step", () => {
    const sim = Simulation.newGame(1);
    sim.money = 1e9;
    const { c, opts } = makeSpyController();
    c.arm(sim); // step 0 — add a floor
    expect(opts.chime).not.toHaveBeenCalled();
    for (let x = C - 6; x < C + 6; x++) sim.tower.place("floor", 2, x);
    c.tick();
    expect(opts.chime).toHaveBeenCalledOnce();
    expect(document.querySelector("#onboard .ob-cur")!.textContent).toContain("Lease an office");
  });

  it("tick is a no-op when the current step hasn't changed", () => {
    const sim = Simulation.newGame(1);
    const { c, opts } = makeSpyController();
    c.arm(sim);
    c.tick(); // no progress since arm
    expect(opts.chime).not.toHaveBeenCalled();
  });

  it("completing every step finishes: marks onboarded, drops pulses, shows the send-off", () => {
    vi.useFakeTimers();
    try {
      const sim = Simulation.newGame(1);
      sim.money = 1e9;
      const { c } = makeSpyController();
      c.arm(sim);
      for (let x = C - 6; x < C + 6; x++) sim.tower.place("floor", 2, x);
      const r = sim.tower.place("office", 2, C - 4);
      sim.tower.placeTransport("elevatorStandard", C + 5, 1, 2);
      sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
      c.tick();
      expect(isOnboarded()).toBe(true);
      expect(document.querySelector("#onboard")!.textContent).toContain("landlord");
      expect(document.querySelectorAll(".tt-pulse")).toHaveLength(0);
      vi.runAllTimers(); // drain the 6s send-off timer so it can't bleed into later tests
    } finally {
      vi.useRealTimers();
    }
  });

  it("the active step pulses its palette control", () => {
    document.body.innerHTML =
      '<div id="hint"></div><div id="palette-scroll">' +
      '<div class="pal-item" data-kind="floor"></div><div class="pal-item" data-kind="office"></div>' +
      '</div><div id="speed"></div>';
    const mq = { matches: false, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList;
    const c = new OnboardingController({ mq, showHelp() {}, pauseForSplash() {}, chime() {} });
    c.arm(Simulation.newGame(1)); // step 0 pulses the Floor palette item
    expect(document.querySelector('.pal-item[data-kind="floor"]')!.classList.contains("tt-pulse")).toBe(true);
    expect(document.querySelector('.pal-item[data-kind="office"]')!.classList.contains("tt-pulse")).toBe(false);
  });
});
