import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GameApp } from "../main";
import {
  initInstallAffordance,
  tickInstallAffordance,
  splashInstallOffered,
  activateInstall,
  __resetInstallAffordanceForTest,
} from "./installAffordance";
import { __resetPwaInstallForTest, canPromptInstall } from "../pwaInstall";
import * as analytics from "../analytics";
import { renderToFragment } from "../ui/testing/litTestUtils";
import type { TemplateResult } from "lit-html";

/** The text of the how-to modal the controller opened, for asserting WHICH
 *  variant (iOS Safari steps vs the generic browser-menu steps) it selected. */
function openedModalText(app: GameApp): string {
  const mock = app.ui.openModalTemplate as unknown as { mock: { calls: [TemplateResult][] } };
  const calls = mock.mock.calls;
  if (calls.length === 0) throw new Error("openModalTemplate was never called");
  return renderToFragment(calls[calls.length - 1][0]).textContent ?? "";
}

/**
 * The install-affordance controller (SPEC-pwa-install CAP-1..4): the passive
 * Game-panel entry tracks live offerability; the topbar chip surfaces once,
 * play-gated, then never again (a persisted flag); standalone/TWA see nothing;
 * iOS routes to the how-to; appinstalled latches the analytics fact and hides
 * both surfaces. Drives the REAL pwaInstall seam with a fake install event.
 */

const CHIP_FLAG = "vc-install-chip-shown";

function mountDom(): void {
  document.body.innerHTML = `
    <button id="btn-install" hidden></button>
    <button id="btn-install-menu" hidden></button>
    <dialog id="modal"></dialog>`;
}

const chip = () => document.getElementById("btn-install") as HTMLButtonElement;
const menu = () => document.getElementById("btn-install-menu") as HTMLButtonElement;

/** Dispatch a fake beforeinstallprompt so the seam becomes installable. */
function makeInstallable(): void {
  const e = new Event("beforeinstallprompt") as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
  e.prompt = vi.fn(() => Promise.resolve());
  e.userChoice = Promise.resolve({ outcome: "accepted" });
  e.preventDefault = vi.fn();
  window.dispatchEvent(e);
}

function makeApp(opts: { units?: number; splash?: boolean } = {}): GameApp {
  if (opts.splash) document.body.insertAdjacentHTML("beforeend", '<div id="splash"></div>');
  return {
    sim: { tower: { units: Array.from({ length: opts.units ?? 0 }, () => ({})) } },
    ui: { openModalTemplate: vi.fn(), closeModal: vi.fn() },
  } as unknown as GameApp;
}

beforeEach(() => {
  __resetPwaInstallForTest();
  __resetInstallAffordanceForTest();
  localStorage.removeItem(CHIP_FLAG);
  window.matchMedia = vi.fn((q: string) => ({ matches: false, media: q }) as MediaQueryList);
  Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (X11; Linux) Chrome/150", configurable: true });
  Object.defineProperty(navigator, "platform", { value: "Linux x86_64", configurable: true });
  Object.defineProperty(navigator, "maxTouchPoints", { value: 0, configurable: true });
  (window.navigator as { standalone?: boolean }).standalone = undefined;
  mountDom();
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetPwaInstallForTest();
  __resetInstallAffordanceForTest();
  document.body.innerHTML = "";
});

describe("passive menu entry (CAP-1)", () => {
  it("stays hidden for a plain browser with no captured event, appears when installable", () => {
    initInstallAffordance(makeApp());
    expect(menu().hidden).toBe(true);
    makeInstallable(); // onChange -> refreshMenu
    expect(menu().hidden).toBe(false);
  });

  it("shows for iOS (the how-to path is still an offer)", () => {
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17)", configurable: true });
    initInstallAffordance(makeApp());
    expect(menu().hidden).toBe(false);
  });

  it("stays hidden for a standalone session even when installable", () => {
    window.matchMedia = vi.fn((q: string) => ({ matches: q.includes("standalone") }) as MediaQueryList);
    initInstallAffordance(makeApp());
    makeInstallable();
    expect(menu().hidden).toBe(true);
    expect(chip().hidden).toBe(true);
  });
});

describe("play-gated chip, once ever (CAP-1)", () => {
  it("does not surface before real play, surfaces once the player has built, and sets the once flag", () => {
    initInstallAffordance(makeApp());
    makeInstallable();
    // Splash still up / empty tower: the tick returns early at the play-gate
    // (before the session guard is set), so the chip stays hidden and the gate
    // is not latched.
    tickInstallAffordance(makeApp({ splash: true, units: 0 }));
    expect(chip().hidden).toBe(true);
    expect(localStorage.getItem(CHIP_FLAG)).toBeNull(); // not burned by a non-qualifying tick
    // In-game with a placed unit: the gate trips, the chip surfaces once.
    document.getElementById("splash")?.remove();
    tickInstallAffordance(makeApp({ units: 1 }));
    expect(chip().hidden).toBe(false);
    expect(localStorage.getItem(CHIP_FLAG)).toBe("1");
  });

  it("does not burn the once-ever flag when the chip element is absent", () => {
    initInstallAffordance(makeApp());
    makeInstallable();
    document.getElementById("btn-install")?.remove(); // e.g. not the app page
    tickInstallAffordance(makeApp({ units: 2 }));
    expect(localStorage.getItem(CHIP_FLAG)).toBeNull(); // flag intact for a real future appearance
  });

  it("never re-surfaces once shown before (a later session leaves the chip to the menu)", () => {
    localStorage.setItem(CHIP_FLAG, "1"); // shown in a prior session
    initInstallAffordance(makeApp());
    makeInstallable();
    tickInstallAffordance(makeApp({ units: 5 })); // played + offerable, but already shown ever
    expect(chip().hidden).toBe(true);
  });

  it("resolves once the player is in-game even if not offerable, so it can't poll forever (Firefox / late offer -> the menu carries it)", () => {
    initInstallAffordance(makeApp());
    // Played, but no beforeinstallprompt (e.g. Firefox, or Chrome before the
    // event): the chip is decided ONCE here (no chip), and the poll stops.
    tickInstallAffordance(makeApp({ units: 3 }));
    expect(chip().hidden).toBe(true);
    // A later offer does NOT re-surface the chip (the poll resolved), but the
    // always-live menu entry picks it up via the seam's onChange.
    makeInstallable();
    tickInstallAffordance(makeApp({ units: 3 }));
    expect(chip().hidden).toBe(true); // resolved: the chip poll is done
    expect(menu().hidden).toBe(false); // the menu carries the late offer
  });

  it("resolves immediately for a standalone session without probing availability every frame", () => {
    window.matchMedia = vi.fn((q: string) => ({ matches: q.includes("standalone") }) as MediaQueryList);
    initInstallAffordance(makeApp());
    makeInstallable(); // even with an event, standalone offers nothing
    tickInstallAffordance(makeApp({ units: 4 }));
    expect(chip().hidden).toBe(true);
    // Prove it resolved: flip out of standalone + tick again; a still-polling
    // controller would now surface the chip, a resolved one leaves it hidden.
    window.matchMedia = vi.fn((q: string) => ({ matches: false, media: q }) as MediaQueryList);
    tickInstallAffordance(makeApp({ units: 4 }));
    expect(chip().hidden).toBe(true);
  });
});

describe("iOS activation (CAP-3)", () => {
  it("opens the Add-to-Home-Screen how-to, never a prompt", () => {
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17)", configurable: true });
    const app = makeApp();
    initInstallAffordance(app);
    // No beforeinstallprompt on iOS, so no native prompt is even possible: the
    // activation can only reach the how-to.
    expect(canPromptInstall()).toBe(false);
    menu().click();
    expect(app.ui.openModalTemplate).toHaveBeenCalledTimes(1);
  });
});

describe("splash front door (CAP-5)", () => {
  it("splashInstallOffered is false in wrapped builds even when not standalone", () => {
    expect(splashInstallOffered("native")).toBe(false);
    expect(splashInstallOffered("desktop")).toBe(false);
  });

  it("splashInstallOffered is true for a not-standalone session and false for standalone", () => {
    expect(splashInstallOffered()).toBe(true);
    window.matchMedia = vi.fn((q: string) => ({ matches: q.includes("standalone") }) as MediaQueryList);
    expect(splashInstallOffered()).toBe(false);
  });

  it("activateInstall drives the native prompt when an event is captured, never the how-to", async () => {
    const app = makeApp();
    initInstallAffordance(app);
    const e = new Event("beforeinstallprompt") as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: string }>;
    };
    const promptSpy = vi.fn(() => Promise.resolve());
    e.prompt = promptSpy;
    e.userChoice = Promise.resolve({ outcome: "accepted" });
    e.preventDefault = vi.fn();
    window.dispatchEvent(e);

    await activateInstall(app, "splash");
    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(app.ui.openModalTemplate).not.toHaveBeenCalled();
  });

  it("activateInstall falls back to the BROWSER how-to on a non-iOS session with no captured event (a splash tap before the browser fires)", async () => {
    const app = makeApp(); // default UA is Linux Chrome, not iOS
    initInstallAffordance(app);
    expect(canPromptInstall()).toBe(false);
    await activateInstall(app, "splash");
    // No native prompt possible, so the honest browser-menu how-to opens: it must
    // be the browser variant (mentions the browser menu), NOT the iOS Safari steps.
    expect(app.ui.openModalTemplate).toHaveBeenCalledTimes(1);
    const text = openedModalText(app);
    expect(text).toMatch(/menu/i);
    expect(text).not.toMatch(/Safari/);
  });

  it("activateInstall routes an iOS session to the iOS how-to variant, not the browser one", async () => {
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17)", configurable: true });
    const app = makeApp();
    initInstallAffordance(app);
    expect(canPromptInstall()).toBe(false); // iOS never fires beforeinstallprompt
    await activateInstall(app, "splash");
    expect(app.ui.openModalTemplate).toHaveBeenCalledTimes(1);
    // The iOS variant names the Safari Share sheet; the browser-menu copy must not leak in.
    expect(openedModalText(app)).toMatch(/Safari/);
  });

  it("does not stack a how-to behind an in-flight native prompt (re-entrancy guard)", async () => {
    const app = makeApp();
    initInstallAffordance(app);
    // A prompt whose sheet never resolves this tick: promptInstall clears the
    // one-shot up front, so a concurrent second tap sees canPromptInstall() false.
    let release!: () => void;
    const e = new Event("beforeinstallprompt") as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: string }>;
    };
    e.prompt = () => Promise.resolve();
    e.userChoice = new Promise<{ outcome: string }>((r) => (release = () => r({ outcome: "dismissed" })));
    e.preventDefault = vi.fn();
    window.dispatchEvent(e);

    const first = activateInstall(app, "splash"); // enters the prompt branch, awaits userChoice
    await activateInstall(app, "splash"); // concurrent tap: must be a no-op, NOT a how-to
    expect(app.ui.openModalTemplate).not.toHaveBeenCalled();
    release();
    await first;
    expect(app.ui.openModalTemplate).not.toHaveBeenCalled(); // still the prompt path, never a modal
  });

  it("activateInstall offers nothing to a standalone session (defensive: no surface should call it)", async () => {
    window.matchMedia = vi.fn((q: string) => ({ matches: q.includes("standalone") }) as MediaQueryList);
    const app = makeApp();
    initInstallAffordance(app);
    await activateInstall(app, "splash");
    expect(app.ui.openModalTemplate).not.toHaveBeenCalled();
  });
});

describe("per-surface tap tracking (CAP-4 install_offer)", () => {
  it("reports the tapped surface: the topbar chip as 'chip'", () => {
    const track = vi.spyOn(analytics, "trackAppAction").mockImplementation(() => {});
    initInstallAffordance(makeApp());
    makeInstallable();
    chip().click();
    expect(track).toHaveBeenCalledWith("install_offer", "chip");
  });

  it("reports the Game-panel entry as 'menu'", () => {
    const track = vi.spyOn(analytics, "trackAppAction").mockImplementation(() => {});
    initInstallAffordance(makeApp());
    makeInstallable();
    menu().click();
    expect(track).toHaveBeenCalledWith("install_offer", "menu");
  });

  it("reports the splash front door as 'splash' via activateInstall", async () => {
    const track = vi.spyOn(analytics, "trackAppAction").mockImplementation(() => {});
    const app = makeApp();
    initInstallAffordance(app);
    await activateInstall(app, "splash");
    expect(track).toHaveBeenCalledWith("install_offer", "splash");
  });

  it("records the tap even when no offer is available (the engagement half of the funnel)", async () => {
    // No captured event, not iOS, not standalone: the how-to fallback path. The tap
    // must still be counted, so the offer's reach is measured independent of outcome.
    const track = vi.spyOn(analytics, "trackAppAction").mockImplementation(() => {});
    const app = makeApp();
    initInstallAffordance(app);
    expect(canPromptInstall()).toBe(false);
    await activateInstall(app, "splash");
    expect(track).toHaveBeenCalledWith("install_offer", "splash");
  });
});

describe("appinstalled (CAP-4 + hide)", () => {
  it("latches the analytics fact once and hides all surfaces, including the splash front door", () => {
    const trackOnce = vi.spyOn(analytics, "trackAppActionOnce").mockImplementation(() => {});
    // A splash front-door button is up (install accepted while the splash is still
    // mounted): appinstalled must retire it too, or it lingers as a dead control.
    document.body.insertAdjacentHTML("beforeend", '<button data-splash="install"></button>');
    const splashInstall = () => document.querySelector('[data-splash="install"]') as HTMLButtonElement;
    initInstallAffordance(makeApp());
    makeInstallable();
    expect(menu().hidden).toBe(false);
    window.dispatchEvent(new Event("appinstalled"));
    expect(trackOnce).toHaveBeenCalledWith("install_app");
    expect(menu().hidden).toBe(true);
    expect(chip().hidden).toBe(true);
    expect(splashInstall().hidden).toBe(true);
  });
});
