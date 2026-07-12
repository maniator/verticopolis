import { afterEach, describe, expect, it, vi } from "vitest";
import { Simulation } from "../engine/Simulation";
import { showCrashScreen } from "../ui/crashScreen";
import type { CrashScreenOptions } from "../ui/crashScreen";

/** The player-facing wording contract for the crash card. The save-status
 *  flags are computed in SaveLoad (covered by gameControllersCoverage); this
 *  file pins the sentences each flag combination renders, so a wording change
 *  is a deliberate edit here rather than an accident. */

function show(overrides: Partial<CrashScreenOptions> = {}, save: Partial<CrashScreenOptions["save"]> = {}) {
  const opts: CrashScreenOptions = {
    crash: { kind: "webgl-context-lost", repeat: false, saveFlushed: true },
    save: { flushed: true, behindSplash: false, storageBlame: false, hadPriorSave: false, ...save },
    version: "1.19.0",
    speed: 3,
    getSim: () => new Simulation(),
    frameErrors: [],
    onReload: vi.fn(),
    ...overrides,
  };
  showCrashScreen(opts);
  return { opts, card: document.getElementById("crash-screen")! };
}

afterEach(() => {
  document.getElementById("crash-screen")?.remove();
});

describe("crash screen wording and wiring", () => {
  it("the clean case says the tower was saved and explains the crash", () => {
    const { card } = show();
    expect(card.textContent).toContain("The game crashed");
    expect(card.textContent).toContain("graphics driver reset");
    expect(card.textContent).toContain("Your tower was saved. Nothing is lost.");
    expect(card.textContent).not.toContain("second crash in a row");
  });

  it("a failed flush blames storage only for a storage failure, and reassures only when a prior save exists", () => {
    const { card } = show({}, { flushed: false, storageBlame: true, hadPriorSave: true });
    expect(card.textContent).toContain("storage is full or blocked");
    expect(card.textContent).toContain("Your last saved tower is safe.");
    document.getElementById("crash-screen")!.remove();

    // Non-storage failure: neutral wording, no "free up space" style advice.
    const { card: neutral } = show({}, { flushed: false, storageBlame: false, hadPriorSave: false });
    expect(neutral.textContent).toContain("the save hit an unexpected error");
    expect(neutral.textContent).not.toContain("storage is full or blocked");
    expect(neutral.textContent).not.toContain("last saved tower is safe");
  });

  it("behind the splash it never claims a tower was saved", () => {
    const { card } = show({}, { behindSplash: true });
    expect(card.textContent).toContain("No game was in progress");
    expect(card.textContent).not.toContain("Your tower was saved");
  });

  it("a repeat crash adds the close-other-apps advice", () => {
    const { card } = show({ crash: { kind: "webgl-context-lost", repeat: true, saveFlushed: true } });
    expect(card.textContent).toContain("second crash in a row");
  });

  it("Reload fires the recovery callback, the report link is prefilled, and focus lands in the dialog", () => {
    const { opts, card } = show();
    const link = card.querySelector<HTMLAnchorElement>('[data-act="report"]')!;
    expect(link.href).toContain("github.com/maniator/verticopolis/issues/new");
    expect(link.href).toContain("template=bug_report.yml");
    const reload = card.querySelector<HTMLButtonElement>('[data-act="reload"]')!;
    expect(document.activeElement).toBe(reload);
    reload.click();
    expect(opts.onReload).toHaveBeenCalledTimes(1);
  });

  it("a second call never stacks a second card", () => {
    show();
    show();
    expect(document.querySelectorAll("#crash-screen")).toHaveLength(1);
  });
});
