import { describe, it, expect, beforeEach } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { newSeededGame } from "../fixtures/towerFixtures";
import { GRID } from "../../engine/facilities";
import {
  ONBOARD_STEPS,
  firstIncompleteStep,
  shouldArm,
  isOnboarded,
  markOnboarded,
  clearOnboarded,
} from "../../ui/Onboarding";

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
  it("firstIncompleteStep walks lobby → floor → office → connect → occupied", () => {
    const sim = newSeededGame(1); // the ensured ground lobby satisfies step one
    sim.money = 1e9;
    expect(firstIncompleteStep(sim)).toBe(1); // lobby done, nothing built above it

    // Step 2: a floor above the lobby.
    for (let x = C - 10; x < C + 10; x++) sim.tower.place("floor", 2, x);
    expect(firstIncompleteStep(sim)).toBe(2);

    // Step 3: an office on it.
    const r = sim.tower.place("office", 2, C - 4);
    expect(r.ok).toBe(true);
    expect(firstIncompleteStep(sim)).toBe(3);

    // Step 4: connect the floor to the ground lobby.
    expect(sim.tower.placeTransport("elevatorStandard", C + 6, 1, 2).ok).toBe(true);
    expect(firstIncompleteStep(sim)).toBe(4);

    // Step 5: a tenant actually moves in.
    let guard = 0;
    while (!ONBOARD_STEPS[4].done(sim) && guard++ < 400) sim.tick(60);
    expect(ONBOARD_STEPS[4].done(sim)).toBe(true);
    expect(firstIncompleteStep(sim)).toBe(ONBOARD_STEPS.length); // all done
  });

  it("founding is lobby-first in both modes: an empty lot teaches the lobby", () => {
    const classic = Simulation.newGame(1, "classic");
    expect(ONBOARD_STEPS[0].id).toBe("lobby");
    expect(classic.tower.units.length).toBe(0); // canon-zero founding
    expect(firstIncompleteStep(classic)).toBe(0);
    // The first lobby goes anywhere on the ground line, 1994-style: either
    // lot edge is as legal as the center.
    expect(Simulation.newGame(1, "classic").tower.place("lobby", 1, 0).ok).toBe(true);
    expect(Simulation.newGame(1, "classic").tower.place("lobby", 1, GRID.width - 1).ok).toBe(true);
    // And it must BE a lobby: founding is lobby-first, as in 1994. Any other
    // kind is refused with the actionable reason until the lobby exists.
    const floorFirst = Simulation.newGame(1, "classic").tower.place("floor", 1, 0);
    expect(floorFirst.ok).toBe(false);
    expect(floorFirst.reason).toContain("Lay a lobby");
    expect(classic.tower.place("lobby", 1, C).ok).toBe(true);
    expect(firstIncompleteStep(classic)).toBe(1); // laying the lobby advances

    // Modern founds the same empty lot now (no seeded lobby), so step one is
    // taught identically: it is not skipped until the player lays the lobby.
    const modern = Simulation.newGame(1, "modern");
    expect(modern.tower.units.length).toBe(0);
    expect(firstIncompleteStep(modern)).toBe(0);
    expect(modern.tower.place("lobby", 1, C).ok).toBe(true);
    expect(firstIncompleteStep(modern)).toBe(1);
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

import { OnboardingController } from "../../ui/Onboarding";
import { runSplashAction } from "../../ui/splashActions";
import { isSplashUp } from "../../game/interactionState";

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
    const sim = newSeededGame(1);
    const c = makeController();
    expect(c.arm(sim)).toBe(true);
    c.arm(sim); // e.g. Replay while active
    c.arm(sim);
    expect(document.querySelectorAll("#onboard").length).toBe(1);
  });

  it("Skip marks onboarding done (once-only) and removes the panel", () => {
    const sim = newSeededGame(1);
    const c = makeController();
    c.arm(sim);
    document.querySelector<HTMLElement>('[data-onboard="skip"]')!.click();
    expect(isOnboarded()).toBe(true);
    expect(document.getElementById("onboard")).toBeNull();
    expect(c.arm(sim)).toBe(false); // never re-nags
  });

  it("resumes at the first uncompleted step when re-armed on a progressed tower", () => {
    const sim = newSeededGame(2);
    sim.money = 1e9;
    const cX = Math.floor(GRID.width / 2);
    for (let x = cX - 6; x < cX + 6; x++) sim.tower.place("floor", 2, x); // step 1
    sim.tower.place("office", 2, cX - 4); // step 2
    const c = makeController();
    c.arm(sim);
    expect(document.querySelector("#onboard .ob-cur")!.textContent).toContain("Connect it"); // step 3
  });

  it("arm() returns false and shows no panel on an already-complete tower", () => {
    const sim = newSeededGame(3);
    sim.money = 1e9;
    const cX = Math.floor(GRID.width / 2);
    for (let x = cX - 6; x < cX + 6; x++) sim.tower.place("floor", 2, x);
    const r = sim.tower.place("office", 2, cX - 4);
    sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
    sim.tower.placeTransport("elevatorStandard", cX + 5, 1, 2);
    const c = makeController();
    expect(c.arm(sim)).toBe(false); // all five steps already satisfied
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
  const opts = { mq, showHelp: vi.fn(), pauseForSplash: vi.fn(), chime: vi.fn(), onEnterTower: vi.fn() };
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
    c.showSplash({ hasSave: true, onContinue: vi.fn(), onLoadTower: vi.fn(), onNewTower: vi.fn() });
    const splash = document.getElementById("splash")!;
    expect(splash.getAttribute("aria-modal")).toBe("true");
    expect(opts.pauseForSplash).toHaveBeenCalledWith(true);
    expect(splash.querySelector('[data-splash="continue"]')).not.toBeNull();
    expect(splash.querySelector(".splash-version")!.textContent).toMatch(/^v/);
  });

  it("hides Continue when there is no save", () => {
    const { c } = makeSpyController();
    c.showSplash({ hasSave: false, onContinue: vi.fn(), onLoadTower: vi.fn(), onNewTower: vi.fn() });
    expect(document.querySelector('[data-splash="continue"]')).toBeNull();
  });

  it("keeps the lettering SVGs labeled and the decorative layers hidden from a screen reader", () => {
    const { c } = makeSpyController();
    c.showSplash({ hasSave: true, onContinue: vi.fn(), onLoadTower: vi.fn(), onNewTower: vi.fn() });
    const splash = document.getElementById("splash")!;
    // The wordmark and tagline are the accessible name of the title screen.
    expect(splash.querySelector(".splash-word")!.getAttribute("aria-label")).toBe("Verticopolis");
    expect(splash.querySelector(".splash-tag")!.getAttribute("aria-label")).toBe("the vertical metropolis");
    // textLength is preserved so the lettering always fits (camelCase SVG attr).
    expect(splash.querySelector(".splash-word text")!.getAttribute("textLength")).toBe("392");
    // The skyline and lighting layers are purely decorative.
    expect(splash.querySelector(".splash-skyline")!.getAttribute("aria-hidden")).toBe("true");
    expect(splash.querySelector(".splash-stars")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("Continue tears down the splash, resumes the engine, and calls onContinue", () => {
    const { c, opts } = makeSpyController();
    const onContinue = vi.fn();
    c.showSplash({ hasSave: true, onContinue, onLoadTower: vi.fn(), onNewTower: vi.fn() });
    document.querySelector<HTMLElement>('[data-splash="continue"]')!.click();
    expect(document.getElementById("splash")).toBeNull();
    expect(opts.pauseForSplash).toHaveBeenLastCalledWith(false);
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it("publishes the #splash element and the action registry as one step, so the host menu never dead-clicks (issue #716)", () => {
    // The desktop menu's New Tower / Load Tower decide via `isSplashUp()` (the
    // `#splash` element) and then run `runSplashAction` (the `splashActions`
    // registry). `hostCommands` ignores the registry's boolean because the two
    // are assumed to go up and come down together; if they ever desynced, a menu
    // command would silently no-op. This pins that atomicity end to end: after
    // showSplash BOTH are live, and after teardown BOTH are cleared.
    const { c } = makeSpyController();
    const onNewTower = vi.fn();
    const onLoadTower = vi.fn();
    c.showSplash({ hasSave: true, onContinue: vi.fn(), onLoadTower, onNewTower });
    expect(isSplashUp()).toBe(true);
    expect(runSplashAction("new")).toBe(true); // registry live in lockstep with the element
    expect(onNewTower).toHaveBeenCalledOnce();
    expect(runSplashAction("load")).toBe(true);
    expect(onLoadTower).toHaveBeenCalledOnce();
    document.querySelector<HTMLElement>('[data-splash="continue"]')!.click();
    expect(isSplashUp()).toBe(false);
    expect(runSplashAction("new")).toBe(false); // registry cleared with the element
  });

  it("Load Tower keeps the splash up and hands the host NO dismiss callback", () => {
    // SPEC-splash-load-tower CAP-5: the title screen is dismissed by a tower
    // arriving, never by a dialog opening. Handing out a dismiss callback here
    // is exactly how a cancelled picker, or a failed load, would end up
    // stranding the player inside the throwaway boot sim.
    const { c } = makeSpyController();
    const onLoadTower = vi.fn();
    c.showSplash({ hasSave: true, onContinue: vi.fn(), onLoadTower, onNewTower: vi.fn() });
    document.querySelector<HTMLElement>('[data-splash="load"]')!.click();
    expect(onLoadTower).toHaveBeenCalledOnce();
    expect(onLoadTower.mock.calls[0]).toHaveLength(0);
    expect(document.getElementById("splash")).not.toBeNull();
    expect(c.dismissSplash()).toBe(true); // only an arriving tower takes it down
    expect(document.getElementById("splash")).toBeNull();
  });

  it("dismissSplash reports whether it tore anything down", () => {
    // adoptSim keys the re-pause and the welcome toast off this return, so a
    // mid-game tower swap (no splash) must not claim one.
    const { c, opts } = makeSpyController();
    expect(c.dismissSplash()).toBe(false);
    c.showSplash({ hasSave: true, onContinue: vi.fn(), onLoadTower: vi.fn(), onNewTower: vi.fn() });
    expect(c.dismissSplash()).toBe(true);
    // Teardown resumes to play speed, then dismissSplash re-pauses through the
    // same required port, so the last word is always "paused".
    expect(opts.pauseForSplash).toHaveBeenLastCalledWith(true);
    expect(c.dismissSplash()).toBe(false); // idempotent
  });

  it("a tower ARRIVING dismisses the splash and hands the host the re-pause (CAP-5/CAP-6)", () => {
    // adoptSim is the one junction every arrival passes through: a loaded slot,
    // a .vctower, a 1994 .TDT. The host re-pauses there, so a tower the player
    // has not opened in weeks never starts running under them.
    const { c, opts } = makeSpyController();
    c.showSplash({ hasSave: true, onContinue: vi.fn(), onLoadTower: vi.fn(), onNewTower: vi.fn() });
    c.adoptSim(newSeededGame(9));
    expect(document.getElementById("splash")).toBeNull();
    expect(opts.onEnterTower).toHaveBeenCalledOnce();
    // The re-pause runs through the REQUIRED pauseForSplash port, not the
    // optional greeting, so a host that omits onEnterTower cannot silently
    // leave a just-loaded tower running at play speed.
    expect(opts.pauseForSplash).toHaveBeenLastCalledWith(true);
    expect(document.body.classList.contains("splash-up")).toBe(false);
  });

  it("survives every way OUT of the picker that is not a loaded tower (CAP-5)", () => {
    // The three quiet paths. An OS file-picker cancel is the quietest of all:
    // openImport binds onchange only, so a cancel fires no event whatsoever and
    // there is no callback that could have torn the splash down by mistake.
    const { c, opts } = makeSpyController();
    c.showSplash({ hasSave: true, onContinue: vi.fn(), onLoadTower: vi.fn(), onNewTower: vi.fn() });

    // 1. The picker is opened and closed again (Back, Esc, or the title-bar X).
    document.querySelector<HTMLElement>('[data-splash="load"]')!.click();
    expect(document.getElementById("splash")).not.toBeNull();

    // 2. A failed load: nothing is adopted, so nothing calls adoptSim.
    expect(document.getElementById("splash")).not.toBeNull();

    // 3. A failed import: same, the importer never reaches adoptSim.
    expect(document.getElementById("splash")).not.toBeNull();
    expect(opts.onEnterTower).not.toHaveBeenCalled();
    expect(document.body.classList.contains("splash-up")).toBe(true);
  });

  it("a mid-game tower swap does not claim a splash that was never up", () => {
    // The New Tower path dismisses before founding, and Load from inside a
    // running game has no splash at all. Neither may fire the welcome-back
    // re-pause, which would silently stop the clock on a playing tower.
    const { c, opts } = makeSpyController();
    c.adoptSim(newSeededGame(9));
    expect(opts.onEnterTower).not.toHaveBeenCalled();
  });

  it("New Tower keeps the splash up and hands the host a dismiss callback", () => {
    const { c } = makeSpyController();
    const onNewTower = vi.fn();
    c.showSplash({ hasSave: false, onContinue: vi.fn(), onLoadTower: vi.fn(), onNewTower });
    document.querySelector<HTMLElement>('[data-splash="new"]')!.click();
    expect(onNewTower).toHaveBeenCalledOnce();
    expect(document.getElementById("splash")).not.toBeNull(); // stays until host dismisses
    (onNewTower.mock.calls[0][0] as () => void)(); // invoke dismiss
    expect(document.getElementById("splash")).toBeNull();
  });

  it("Help opens help over the splash without dismissing it", () => {
    const { c, opts } = makeSpyController();
    c.showSplash({ hasSave: false, onContinue: vi.fn(), onLoadTower: vi.fn(), onNewTower: vi.fn() });
    document.querySelector<HTMLElement>('[data-splash="help"]')!.click();
    expect(opts.showHelp).toHaveBeenCalledOnce();
    expect(document.getElementById("splash")).not.toBeNull();
  });

  it("Esc resolves to the safe default: Continue with a save, no-op without one", () => {
    const withSave = makeSpyController();
    const onContinue = vi.fn();
    withSave.c.showSplash({ hasSave: true, onContinue, onLoadTower: vi.fn(), onNewTower: vi.fn() });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onContinue).toHaveBeenCalledOnce();
    expect(document.getElementById("splash")).toBeNull();

    const noSave = makeSpyController();
    const onContinue2 = vi.fn();
    noSave.c.showSplash({ hasSave: false, onContinue: onContinue2, onLoadTower: vi.fn(), onNewTower: vi.fn() });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onContinue2).not.toHaveBeenCalled(); // New Tower must be explicit
    expect(document.getElementById("splash")).not.toBeNull();
  });

  it("Esc is ignored while a modal is stacked over the splash (so canceling Help/New Tower doesn't dismiss the title screen)", () => {
    const { c } = makeSpyController();
    const onContinue = vi.fn();
    c.showSplash({ hasSave: true, onContinue, onLoadTower: vi.fn(), onNewTower: vi.fn() });
    // A returning player with a save now sees the splash on any boot that isn't a
    // post-update resume, and can open a modal over it. That modal owns Esc; the
    // splash's safeDismiss must not also fire and drop them into Continue.
    const modal = document.createElement("dialog");
    modal.id = "modal";
    modal.setAttribute("open", ""); // happy-dom reflects the attribute to `.open`
    document.body.appendChild(modal);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onContinue).not.toHaveBeenCalled();
    expect(document.getElementById("splash")).not.toBeNull();
    // Once the modal closes, Esc resolves to Continue as usual.
    modal.removeAttribute("open");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onContinue).toHaveBeenCalledOnce();
    expect(document.getElementById("splash")).toBeNull();
    modal.remove();
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

  it("adoptSim retargets a live session at the swapped-in tower", () => {
    // Mid-onboarding tower swap (New Tower / Load / undo restore): the session
    // must follow the live sim, or ticks keep reading the abandoned one and the
    // card teaches that tower's next step.
    const { c } = makeSpyController();
    c.arm(newSeededGame(1)); // seeded: armed at step 1 (add a floor)
    const empty = Simulation.newGame(2, "classic");
    expect(empty.tower.units.length).toBe(0);
    c.adoptSim(empty);
    // The panel now shows the empty lot's first step: the lobby.
    expect(document.querySelector("#onboard .ob-cur")?.textContent).toContain("Open your lobby");
    // Progress on the NEW sim advances the session.
    expect(empty.tower.place("lobby", 1, C).ok).toBe(true);
    c.tick();
    expect(document.querySelector("#onboard .ob-cur")?.textContent).toContain("Add a floor");
  });

  it("advancing a step chimes and re-renders the new current step", () => {
    const sim = newSeededGame(1);
    sim.money = 1e9;
    const { c, opts } = makeSpyController();
    c.arm(sim); // seeded fixture: the lobby step is done, so step 1 (add a floor) is armed
    expect(opts.chime).not.toHaveBeenCalled();
    for (let x = C - 6; x < C + 6; x++) sim.tower.place("floor", 2, x);
    c.tick();
    expect(opts.chime).toHaveBeenCalledOnce();
    expect(document.querySelector("#onboard .ob-cur")!.textContent).toContain("Lease an office");
  });

  it("tick is a no-op when the current step hasn't changed", () => {
    const sim = newSeededGame(1);
    const { c, opts } = makeSpyController();
    c.arm(sim);
    c.tick(); // no progress since arm
    expect(opts.chime).not.toHaveBeenCalled();
  });

  it("completing every step finishes: marks onboarded, drops pulses, shows the send-off", () => {
    vi.useFakeTimers();
    try {
      const sim = newSeededGame(1);
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
    c.arm(newSeededGame(1)); // seeded: arms at step 1, which pulses the Floor palette item
    expect(document.querySelector('.pal-item[data-kind="floor"]')!.classList.contains("tt-pulse")).toBe(true);
    expect(document.querySelector('.pal-item[data-kind="office"]')!.classList.contains("tt-pulse")).toBe(false);
  });
});
