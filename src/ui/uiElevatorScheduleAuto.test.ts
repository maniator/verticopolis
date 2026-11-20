// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  CARS,
  CLASSIC_UX,
  TUNE_COLD,
  TUNE_WEEKDAY,
  dialog,
  homesShown,
  lastAnnounce,
  ok,
  open,
  press,
  q,
  row,
  saved,
} from "./uiElevatorSchedule.fixture";

/**
 * The schedule dialog's Auto box (Modern, owner 2026-11-17): while it is
 * ticked the engine re-tunes the car counts every morning, so the dialog
 * locks the controls that set them and saves the flag with the schedule.
 * The engine's answers are canned; the re-tune itself is a Rust test.
 */

afterEach(() => {
  document.body.innerHTML = "";
});

const autoBox = (): HTMLInputElement | null => q<HTMLInputElement>(".es-auto input");
const tick = (): void => {
  autoBox()!.click();
};
const hints = (): string[] => Array.from(dialog().querySelectorAll(".es-hint")).map((p) => p.textContent ?? "");
const presetButtons = (): HTMLButtonElement[] =>
  Array.from(dialog().querySelectorAll<HTMLButtonElement>(".es-presets .btn"));
const AUTO_HINT = "Auto re-tunes the car counts every morning from measured traffic. Uncheck Auto to set them by hand.";

describe("the Auto box", () => {
  it("is offered unticked in Modern for a hand-set schedule, and not at all in Classic", () => {
    const { apply } = open({ autoTune: TUNE_WEEKDAY });
    expect(autoBox()?.checked).toBe(false);
    expect(q(".es-autotune")).not.toBeNull();
    ok();
    expect(saved(apply).autoTune).toBe(false);
    document.body.innerHTML = "";
    const classic = open({ ux: CLASSIC_UX, current: { autoTune: true } });
    expect(autoBox()).toBeNull();
    ok();
    expect(saved(classic.apply).autoTune, "Classic never saves the flag on").toBe(false);
  });

  it("opens ticked on a shaft that runs Auto, locking the count controls", () => {
    const { apply } = open({ current: { autoTune: true }, autoTune: TUNE_WEEKDAY });
    expect(autoBox()?.checked).toBe(true);
    expect(q(".es-autotune"), "the one-time button hides").toBeNull();
    expect(presetButtons().every((b) => b.disabled)).toBe(true);
    expect(q<HTMLButtonElement>(".es-allcars")?.disabled).toBe(true);
    expect(hints()).toContain(AUTO_HINT);
    press(".es-adv summary");
    expect(
      Array.from(dialog().querySelectorAll<HTMLButtonElement>(".es-strip-step .es-sq")).every((b) => b.disabled),
    ).toBe(true);
    expect(q(".es-bar")?.getAttribute("aria-readonly")).toBe("true");
    ok();
    expect(saved(apply).autoTune).toBe(true);
  });

  it("ticking it fills the counts from the engine's proposal and keeps the homes", () => {
    const current = { activeCars: { weekday: row(CARS), weekend: row(1) }, homeFloors: [2, 2, 3, 3] };
    const { ctx, apply } = open({ current, autoTune: TUNE_WEEKDAY });
    const asked = ctx.autoTune.mock.calls.length;
    tick();
    expect(ctx.autoTune.mock.calls.length).toBeGreaterThan(asked);
    expect(lastAnnounce(ctx)).toBe("Auto on. The car counts re-tune every morning from measured traffic.");
    expect(homesShown()).toEqual(["3:3", "3:4", "2:1", "2:2"]);
    ok();
    const s = saved(apply);
    expect(s.autoTune).toBe(true);
    expect(s.activeCars).toEqual({ weekday: TUNE_WEEKDAY.proposal!.weekday, weekend: row(1) });
    expect(s.homeFloors).toEqual([2, 2, 3, 3]);
  });

  it("ticking it seeds the staging floors when the player has set none, as the Auto-tune button does", () => {
    const { apply } = open({
      current: { activeCars: { weekday: row(CARS), weekend: row(1) }, homeFloors: [] },
      autoTune: TUNE_WEEKDAY,
    });
    tick();
    ok();
    const s = saved(apply);
    expect(s.autoTune).toBe(true);
    expect(s.homeFloors).toEqual(TUNE_WEEKDAY.proposal!.homeFloors);
  });

  it("ticked on a cold shaft, it keeps the counts and says it is waiting", () => {
    const { apply } = open({ current: { activeCars: { weekday: row(3), weekend: row(3) } }, autoTune: TUNE_COLD });
    tick();
    expect(hints()).toContain("Auto starts once this shaft has measured a day of traffic.");
    expect(hints()).not.toContain("Auto-tune needs a day or two of measured traffic first.");
    ok();
    expect(saved(apply).activeCars).toEqual({ weekday: row(3), weekend: row(3) });
    expect(saved(apply).autoTune).toBe(true);
  });

  it("unticking it hands the counts back to the player", () => {
    const { ctx, apply } = open({ current: { autoTune: true }, autoTune: TUNE_WEEKDAY });
    tick();
    expect(lastAnnounce(ctx)).toBe("Auto off. The car counts stay as you set them.");
    expect(autoBox()?.checked).toBe(false);
    expect(presetButtons().some((b) => b.disabled && b.textContent === "Rush")).toBe(false);
    expect(q<HTMLButtonElement>(".es-allcars")?.disabled).toBe(false);
    expect(hints()).not.toContain(AUTO_HINT);
    ok();
    expect(saved(apply).autoTune).toBe(false);
  });
});
