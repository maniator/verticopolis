// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GameApp } from "../../main";
import { CHOICE_WAITING_NOTICE, runFrame } from "../../game/frameLoop";
import { hasBlockingModal } from "../../game/interactionState";
import type { UI } from "../../ui/UI";
import { mountAppDom, makeUI } from "../uiFixture";
import { PortCodes } from "../../simport/portCodes";
import { newViewReader } from "../../game/portAccess";
import { portOf } from "../../game/cardKit.fixture";
import { draftFromSave, draftTower, type Draft } from "../portKit/drafts";
import { noEngine } from "../portKit/rustEngine";

/**
 * The TOWER congratulations and the dialogs that freeze time (#1120).
 *
 * Both the congratulations and the emergency choice (or the update prompt)
 * can come due in one throttled pass of the frame loop: the win day rolls an
 * emergency and sets `evaluatedTower` together, and a TOWER save taken while
 * the choice was open loads with both. The congratulations used to replace
 * the shared dialog, wiping the choice's buttons while `shownChoice` stayed
 * latched, so time never moved again, on every Continue of that save.
 *
 * This drives the real frame loop, the real `UI` dialog and the Rust engine
 * loaded from a save that carries both flags, so the same file also proves
 * the engine carries the save's open choice and its TOWER rating through a
 * frame.
 */

vi.mock("../../game/trafficHud", () => ({ updateTraffic: vi.fn() }));
vi.mock("../../game/panelAnchoring", () => ({ positionPanels: vi.fn() }));

const dialog = (): HTMLDialogElement => document.getElementById("modal") as HTMLDialogElement;
const has = (sel: string): boolean => dialog().querySelector(sel) !== null;
const click = (sel: string): void => {
  const el = dialog().querySelector<HTMLElement>(sel);
  expect(el, `expected "${sel}" in the open dialog`).not.toBeNull();
  el!.click();
};
/** The congratulations are the only dialog here with the "TOWER achieved!" heading. */
const showingCongrats = (): boolean => dialog().open && (dialog().textContent ?? "").includes("TOWER achieved");

/** A mid-morning Classic tower saved as a TOWER win, with or without an open fire rescue. */
function savedTower(withChoice: boolean): Draft {
  const raw = draftTower(2024, "classic").serialize() as unknown as Record<string, unknown> & { events: Record<string, unknown> };
  raw.evaluatedTower = true;
  raw.minutes = 9 * 60;
  if (withChoice) raw.events.pending = { kind: "fireRescue", cost: 150_000, message: "Fire on the 40th floor!" };
  return draftFromSave(raw);
}

/** What the engine holds now: the frame loop moves it past the draft's read. */
const minutesOf = (sim: Draft): number => (sim.settle(), sim.clock.minutes);
const choiceOf = (sim: Draft) => (sim.settle(), sim.pendingChoice as { kind: string } | null);
const ratedTower = (sim: Draft): boolean => (sim.settle(), sim.evaluatedTower);

function makeApp(sim: Draft, ui: UI) {
  const enginePort = portOf(sim);
  const app = {
    shownChoice: false,
    shownUpdate: false,
    shownWin: false,
    speed: 1,
    prefs: { steadyClock: true },
    sim,
    enginePort,
    reader: newViewReader(enginePort),
    portCodes: new PortCodes(enginePort),
    accMinutes: 0,
    audio: { update: vi.fn(), sfx: vi.fn(), setMusicDucked: vi.fn() },
    // The camera shows the whole tower, so the frame carries every person.
    engine: { focus: vi.fn(() => ({})), viewWidth: 1, viewHeight: 1, screenToTile: (sx: number) => (sx === 0 ? -1e6 : 1e6), screenToFloor: (sy: number) => (sy === 0 ? 1e6 : -1e6) },
    ui,
    onboarding: { tick: vi.fn() },
    scheduleReview: { tick: vi.fn() },
    personCard: { tick: vi.fn() },
    selected: null,
    refreshEditor: vi.fn(),
    lastUiUpdate: -1e9,
    lastStar: sim.star,
    lastMealRushDay: { breakfast: -1, lunch: -1, dinner: -1 } as Record<string, number>,
    // The update flow's own state, so the real `maybeSurfaceUpdatePrompt` runs.
    pendingUpdate: null as (() => Promise<void>) | null,
    pendingUpdateInfo: null,
    updatePromptShown: false,
    transportStart: null,
    saveLoad: { save: vi.fn(() => true) },
  };
  return { app: app as unknown as GameApp, raw: app };
}

/** One throttled pass: the UI refresh is rate limited by wall clock. */
function pass(app: GameApp, raw: { lastUiUpdate: number }): void {
  raw.lastUiUpdate = -1e9;
  runFrame(app, 1000);
}

beforeEach(() => {
  mountAppDom();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe.skipIf(noEngine)("a TOWER save with an open emergency", () => {
  it("shows the choice first, keeps its buttons, and brings the congratulations after the answer", async () => {
    const { ui } = makeUI();
    vi.spyOn(ui, "update").mockImplementation(() => {});
    const sim = savedTower(true);
    const { app, raw } = makeApp(sim, ui);
    pass(app, raw);
    // The loaded save carries both flags, whichever engine hosts it.
    expect(ratedTower(sim)).toBe(true);
    expect(choiceOf(sim)?.kind).toBe("fireRescue");
    expect(raw.shownChoice).toBe(true);
    expect(has('[data-act="accept"]')).toBe(true);
    expect(has('[data-act="decline"]')).toBe(true);
    expect(showingCongrats()).toBe(false);
    expect(raw.shownWin).toBe(false);
    expect(raw.audio.sfx).not.toHaveBeenCalledWith("promote");
    // Time stays frozen under the open choice, and the choice stays on screen.
    const minutes = minutesOf(sim);
    for (let i = 0; i < 5; i++) pass(app, raw);
    expect(minutesOf(sim)).toBe(minutes);
    expect(has('[data-act="accept"]')).toBe(true);
    // The player answers: the latch clears once the engine has answered, and
    // the game moves again.
    click('[data-act="decline"]');
    await new Promise((r) => setTimeout(r, 0));
    expect(raw.shownChoice).toBe(false);
    expect(choiceOf(sim)).toBeNull();
    expect(hasBlockingModal(app)).toBe(false);
    pass(app, raw);
    expect(showingCongrats()).toBe(true);
    expect(raw.shownWin).toBe(true);
    expect(raw.audio.sfx.mock.calls.filter(([cue]) => cue === "promote")).toHaveLength(1);
    // Dismissing the congratulations leaves nothing latched, and time runs.
    click('[data-act="close"]');
    expect(dialog().open).toBe(false);
    const before = minutesOf(sim);
    for (let i = 0; i < 3; i++) pass(app, raw);
    expect(minutesOf(sim)).toBeGreaterThan(before);
    expect(raw.shownChoice).toBe(false);
  });

  it("dismissing the choice with Esc declines it and still ends in the congratulations", async () => {
    const { ui } = makeUI();
    vi.spyOn(ui, "update").mockImplementation(() => {});
    const sim = savedTower(true);
    const { app, raw } = makeApp(sim, ui);
    pass(app, raw);
    expect(raw.shownChoice).toBe(true);
    expect(has('[data-act="accept"]')).toBe(true);
    expect(has('[data-act="decline"]')).toBe(true);
    dialog().dispatchEvent(new Event("cancel", { cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(raw.shownChoice).toBe(false);
    expect(choiceOf(sim)).toBeNull();
    pass(app, raw);
    expect(showingCongrats()).toBe(true);
    click('[data-act="close"]');
    const before = minutesOf(sim);
    for (let i = 0; i < 3; i++) pass(app, raw);
    expect(minutesOf(sim)).toBeGreaterThan(before);
  });
});

describe.skipIf(noEngine)("a TOWER win with the update prompt due in the same pass", () => {
  it("shows the update prompt first, and the congratulations once it is dismissed", async () => {
    const { ui } = makeUI();
    vi.spyOn(ui, "update").mockImplementation(() => {});
    const sim = savedTower(false);
    const { app, raw } = makeApp(sim, ui);
    raw.pendingUpdate = async () => {};
    pass(app, raw);
    expect(ratedTower(sim)).toBe(true);
    expect(raw.shownUpdate).toBe(true);
    expect(has('[data-act="later"]')).toBe(true);
    expect(showingCongrats()).toBe(false);
    expect(raw.shownWin).toBe(false);
    // Frozen under the prompt, and still frozen on later passes.
    const minutes = minutesOf(sim);
    pass(app, raw);
    expect(minutesOf(sim)).toBe(minutes);
    click('[data-act="later"]');
    // The prompt's handler runs on a microtask, so the latch clears just after.
    await vi.waitFor(() => expect(raw.shownUpdate).toBe(false));
    // Later saves the game before it hands the dialog back.
    expect(raw.saveLoad.save).toHaveBeenCalledWith(true);
    pass(app, raw);
    expect(showingCongrats()).toBe(true);
    expect(raw.shownWin).toBe(true);
    click('[data-act="close"]');
    const before = minutesOf(sim);
    pass(app, raw);
    expect(minutesOf(sim)).toBeGreaterThan(before);
  });
});

describe.skipIf(noEngine)("a TOWER save with an open emergency, under a dialog that holds the player's work (#1121)", () => {
  it("keeps the dialog, stops time with a notice, then shows the choice and the congratulations in turn", async () => {
    const { ui } = makeUI();
    vi.spyOn(ui, "update").mockImplementation(() => {});
    const sim = savedTower(true);
    const { app, raw } = makeApp(sim, ui);
    // The New Tower picker opens protected, as every dialog with a decision does.
    ui.newTowerModal({ hasSave: true, onFound: vi.fn() });
    expect(ui.precedence.ownsPendingWork(dialog().open)).toBe(true);
    const minutes = minutesOf(sim);
    for (let i = 0; i < 3; i++) pass(app, raw);
    expect(has('input[name="nt-mode"]')).toBe(true);
    expect(has('[data-act="accept"]')).toBe(false);
    expect(raw.shownChoice).toBe(false);
    expect(showingCongrats()).toBe(false);
    expect(minutesOf(sim)).toBe(minutes);
    expect(choiceOf(sim)?.kind).toBe("fireRescue");
    // One notice, mounted once, however many frozen frames ask for it.
    const notices = dialog().querySelectorAll(".modal-notice");
    expect([...notices].map((n) => n.textContent)).toEqual([CHOICE_WAITING_NOTICE]);
    // The player closes their dialog: the choice comes up, then the win.
    click('[data-act="cancel"]');
    expect(dialog().open).toBe(false);
    pass(app, raw);
    expect(raw.shownChoice).toBe(true);
    expect(has('[data-act="decline"]')).toBe(true);
    click('[data-act="decline"]');
    await new Promise((r) => setTimeout(r, 0));
    expect(choiceOf(sim)).toBeNull();
    pass(app, raw);
    expect(showingCongrats()).toBe(true);
  });
});
