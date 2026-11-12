// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CARS,
  CLASSIC_UX,
  button,
  cancel,
  chipAt,
  dialog,
  flush,
  homesShown,
  lastAnnounce,
  ok,
  open,
  press,
  q,
  row,
  saved,
  stopsPort,
  text,
} from "./uiElevatorSchedule.fixture";

/**
 * The schedule dialog's own edits against canned engine answers: the count
 * strip and its stepper, the response steppers, the live stop edits, the home
 * chips, the Advanced fold, and OK and Cancel. What the dialog does with each
 * engine answer is in `uiElevatorSchedule.test.ts`.
 */

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const bars = (): HTMLButtonElement[] => Array.from(dialog().querySelectorAll<HTMLButtonElement>(".es-bar"));
const selected = (): string[] => Array.from(dialog().querySelectorAll(".es-bar.sel")).map((b) => b.getAttribute("aria-label")!);
const stepper = (label: string, nth = 0): HTMLButtonElement => dialog().querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`)[nth];
const key = (el: Element, k: string): void => void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
const pointer = (el: Element, type: string, buttonNo = 0): void => void el.dispatchEvent(new MouseEvent(type, { button: buttonNo, bubbles: true }));
const toggleServe = async (floor: number | string, serve: boolean): Promise<void> => {
  const box = dialog().querySelector<HTMLInputElement>(`input[aria-label="Serve floor ${floor}"]`)!;
  box.checked = serve;
  box.dispatchEvent(new Event("change"));
  await flush();
};
const rowOf = (floor: string): Element =>
  Array.from(dialog().querySelectorAll(".es-grid-row")).find((r) => r.querySelector(".es-cell-floor")?.textContent?.replace(/[◎L▲]/g, "") === floor)!;

describe("the count strip", () => {
  it("selects the evening hour on a weekday open and edits it with the docked stepper", () => {
    const { ctx, apply } = open({ ux: CLASSIC_UX });
    expect(selected()).toEqual(["weekday 17:00, 4 of 4 cars"]);
    expect(text(".es-fleet")).toBe("4 of 4");
    expect(stepper("more cars").disabled).toBe(true);
    stepper("fewer cars").click();
    expect(selected()).toEqual(["weekday 17:00, 3 of 4 cars"]);
    expect(text(".es-strip-step .es-val")).toBe("3 cars");
    expect(ctx.facts.mock.lastCall![0].activeCars!.weekday![17]).toBe(3);
    ok();
    expect(saved(apply).activeCars.weekday).toEqual(row(CARS).map((v, h) => (h === 17 ? 3 : v)));
  });

  it("extends the selection with shift-click and steps the whole span", () => {
    const { apply } = open({ ux: CLASSIC_UX });
    bars()[3].click();
    bars()[5].dispatchEvent(new MouseEvent("click", { shiftKey: true, bubbles: true }));
    expect(selected()).toHaveLength(3);
    expect(text(".es-strip-step span")).toBe("Hours 03:00–05:00");
    stepper("fewer cars").click();
    stepper("fewer cars").click();
    stepper("fewer cars").click();
    expect(text(".es-strip-step .es-val")).toBe("1 car");
    // A span drawn backward reads the same.
    bars()[9].click();
    bars()[7].dispatchEvent(new MouseEvent("click", { shiftKey: true, bubbles: true }));
    expect(text(".es-strip-step span")).toBe("Hours 07:00–09:00");
    ok();
    expect(saved(apply).activeCars.weekday.slice(2, 7)).toEqual([4, 1, 1, 1, 4]);
  });

  it("adjusts with the up and down arrows and moves with left and right", () => {
    const { apply } = open({ ux: CLASSIC_UX });
    key(bars()[2], "ArrowDown");
    key(bars()[2], "ArrowDown");
    key(bars()[2], "ArrowUp");
    expect(selected()).toEqual(["weekday 02:00, 3 of 4 cars"]);
    expect(document.activeElement).toBe(bars()[2]);
    key(bars()[2], "ArrowRight");
    expect(selected()).toEqual(["weekday 03:00, 4 of 4 cars"]);
    expect(document.activeElement).toBe(bars()[3]);
    key(bars()[0], "ArrowLeft");
    expect(selected()).toEqual(["weekday 00:00, 4 of 4 cars"]);
    key(bars()[23], "ArrowRight");
    expect(selected()).toEqual(["weekday 23:00, 4 of 4 cars"]);
    key(bars()[23], "Enter");
    expect(selected()).toEqual(["weekday 23:00, 4 of 4 cars"]);
    ok();
    expect(saved(apply).activeCars.weekday[2]).toBe(3);
  });

  it("switches the day tab, asking the engine about the weekend and editing its row", () => {
    const { ctx, apply } = open({ ux: CLASSIC_UX });
    bars()[3].click();
    bars()[5].dispatchEvent(new MouseEvent("click", { shiftKey: true, bubbles: true }));
    button("Weekend").click();
    expect(q(".es-day .es-on")?.textContent).toBe("Weekend");
    expect(q(".es-strip-bars")?.getAttribute("aria-label")).toBe("Cars on shift by hour, weekend");
    expect(ctx.autoTune.mock.lastCall![1]).toBe(true);
    expect(ctx.facts.mock.lastCall![1]).toBe(true);
    // A fresh day starts with the single anchor hour, not the weekday's span.
    expect(selected()).toHaveLength(1);
    stepper("fewer cars").click();
    button("Weekday").click();
    expect(q(".es-day .es-on")?.textContent).toBe("Weekday");
    expect(ctx.facts.mock.lastCall![1]).toBe(false);
    ok();
    expect(saved(apply).activeCars.weekday).toEqual(row(CARS));
    expect(saved(apply).activeCars.weekend.filter((v) => v === 3)).toHaveLength(1);
  });

  it("runs every car every hour of both days", () => {
    const current = { activeCars: { weekday: row(1), weekend: row(0) } };
    const { ctx, apply } = open({ current, ux: CLASSIC_UX });
    expect(text(".es-allcars")).toBe("All 4 cars, all hours");
    press(".es-allcars");
    expect(lastAnnounce(ctx)).toBe("All 4 cars now run every hour, both day types.");
    ok();
    expect(saved(apply).activeCars).toEqual({ weekday: row(CARS), weekend: row(CARS) });
  });

  it("speaks of one car on a one-car shaft", () => {
    open({ cars: 1 });
    expect(text(".es-allcars")).toBe("All 1 car, all hours");
  });

  it("folds the Modern strip behind Advanced", () => {
    open();
    expect(bars()).toHaveLength(0);
    const summary = q("details.es-adv summary")!;
    summary.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(bars()).toHaveLength(24);
    expect(q("details.es-adv")?.hasAttribute("open")).toBe(true);
    summary.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(bars()).toHaveLength(0);
  });
});

describe("touch selection", () => {
  it("spans on a second tap and starts over on a third", () => {
    vi.stubGlobal("matchMedia", (media: string) => ({
      media,
      matches: media === "(pointer: coarse)",
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    open({ ux: CLASSIC_UX });
    // The seeded 17:00 selection never anchors a span: the first tap selects.
    bars()[5].click();
    expect(selected()).toEqual(["weekday 05:00, 4 of 4 cars"]);
    bars()[8].click();
    expect(selected()).toHaveLength(4);
    bars()[10].click();
    expect(selected()).toEqual(["weekday 10:00, 4 of 4 cars"]);
    // A second tap on the anchored bar itself keeps the single selection.
    bars()[10].click();
    expect(selected()).toEqual(["weekday 10:00, 4 of 4 cars"]);
  });

  it("selects anew on every plain click with a fine pointer", () => {
    open({ ux: CLASSIC_UX });
    bars()[5].click();
    bars()[8].click();
    expect(selected()).toEqual(["weekday 08:00, 4 of 4 cars"]);
  });
});

describe("press and hold", () => {
  it("repeats a step while held, until the stepper runs out, then stops", () => {
    vi.useFakeTimers();
    const { ctx, apply } = open({ ux: CLASSIC_UX });
    const fewer = stepper("fewer cars");
    pointer(fewer, "pointerdown");
    vi.advanceTimersByTime(399);
    expect(text(".es-strip-step .es-val")).toBe("4 cars");
    vi.advanceTimersByTime(1 + 150 * 2);
    expect(text(".es-strip-step .es-val")).toBe("2 cars");
    vi.advanceTimersByTime(150 * 10);
    expect(text(".es-strip-step .es-val")).toBe("0 cars");
    expect(fewer.disabled).toBe(true);
    const asked = ctx.facts.mock.calls.length;
    vi.advanceTimersByTime(150 * 4);
    expect(ctx.facts.mock.calls.length).toBe(asked);
    pointer(fewer, "pointerup");
    vi.runAllTimers();
    ok();
    expect(saved(apply).activeCars.weekday[17]).toBe(0);
  });

  it("stops on release, swallows the trailing click and ignores a non-primary button", () => {
    vi.useFakeTimers();
    open({ ux: CLASSIC_UX });
    const raise = stepper("raise");
    pointer(raise, "pointerdown");
    vi.advanceTimersByTime(400 + 150);
    expect(q(".es-spread .es-val")?.textContent).toBe("1");
    pointer(raise, "pointerup");
    // The click that ends a repeating hold is swallowed, not a further step.
    const trailing = new MouseEvent("click", { bubbles: true, cancelable: true });
    raise.dispatchEvent(trailing);
    expect(trailing.defaultPrevented).toBe(true);
    vi.advanceTimersByTime(150 * 5);
    expect(q(".es-spread .es-val")?.textContent).toBe("1");
    // A short press after that steps once by its click alone.
    pointer(raise, "pointerdown");
    pointer(raise, "pointerleave");
    raise.click();
    vi.advanceTimersByTime(400 + 150 * 5);
    expect(q(".es-spread .es-val")?.textContent).toBe("2");
    pointer(raise, "pointerdown", 2);
    vi.advanceTimersByTime(400 + 150 * 5);
    expect(q(".es-spread .es-val")?.textContent).toBe("2");
  });

  it("stops repeating once the dialog is closed", () => {
    vi.useFakeTimers();
    const { ctx } = open({ ux: CLASSIC_UX });
    pointer(stepper("raise"), "pointerdown");
    cancel();
    expect(dialog().open).toBe(false);
    const asked = ctx.facts.mock.calls.length;
    vi.advanceTimersByTime(400 + 150 * 5);
    expect(ctx.facts.mock.calls.length).toBe(asked);
    expect(ctx.announce).not.toHaveBeenCalled();
  });
});

describe("the response steppers", () => {
  it("steps Waiting Car Response with its live sentence", () => {
    const { ctx, apply } = open();
    expect(stepper("lower").disabled).toBe(true);
    stepper("raise").click();
    expect(lastAnnounce(ctx)).toBe("Waiting Car Response set to 1. Higher holds idle cars in place longer.");
    expect(Array.from(dialog().querySelectorAll(".es-hint")).map((p) => p.textContent)).toContain("Higher holds idle cars in place longer.");
    stepper("lower").click();
    expect(lastAnnounce(ctx)).toBe("Waiting Car Response: 0. Idle cars answer the nearest call.");
    open({ current: { waitingCarResponse: 30 } });
    expect(stepper("raise").disabled).toBe(true);
    expect(apply).not.toHaveBeenCalled();
  });

  it("steps Standard Floor Departure two seconds at a time", () => {
    const { ctx, apply } = open();
    stepper("raise", 1).click();
    expect(lastAnnounce(ctx)).toBe("Standard Floor Departure: 50 seconds.");
    expect(dialog().querySelectorAll(".es-spread .es-val")[1].textContent).toBe("50 sec");
    stepper("lower", 1).click();
    stepper("lower", 1).click();
    expect(lastAnnounce(ctx)).toBe("Standard Floor Departure: 46 seconds.");
    ok();
    expect(saved(apply).standardFloorDeparture).toBe(46);
    open({ current: { standardFloorDeparture: 60 } });
    expect(stepper("raise", 1).disabled).toBe(true);
  });
});

describe("live stop edits", () => {
  it("renders endpoints as fixed stops and the middle floors as toggles", () => {
    open();
    expect(dialog().querySelectorAll(".es-always")).toHaveLength(2);
    expect(Array.from(dialog().querySelectorAll("input[type=checkbox]")).map((i) => i.getAttribute("aria-label"))).toEqual([
      "Serve floor 3",
      "Serve floor 2",
    ]);
    expect(rowOf("1").querySelector(".es-lobby-mark")).not.toBeNull();
    expect(rowOf("1").querySelector(".es-base")).not.toBeNull();
  });

  it("skips and serves a floor, re-reading the rows and asking the engine again", async () => {
    const { ctx } = open();
    const asked = ctx.facts.mock.calls.length;
    await toggleServe(3, false);
    expect(ctx.stops.setServe).toHaveBeenCalledWith(3, false);
    expect(ctx.stops.read).toHaveBeenCalledTimes(2);
    expect(ctx.facts.mock.calls.length).toBe(asked + 1);
    expect(lastAnnounce(ctx)).toBe("Floor 3 skipped.");
    expect(rowOf("3").classList.contains("es-skipped")).toBe(true);
    expect(rowOf("3").querySelector(".es-chip")).toBeNull();
    // Stop edits applied live: they leave the working copy clean.
    expect(q(".modal-warn")).toBeNull();
    await toggleServe(3, true);
    expect(lastAnnounce(ctx)).toBe("Floor 3 served.");
    expect(rowOf("3").classList.contains("es-skipped")).toBe(false);
  });

  it("says a floor the engine keeps must stay a stop", async () => {
    const { ctx } = open({ stops: stopsPort(4, [1], [2]) });
    await toggleServe(2, false);
    expect(lastAnnounce(ctx)).toBe("Floor 2 must stay a stop.");
    expect(dialog().querySelector<HTMLInputElement>('input[aria-label="Serve floor 2"]')!.checked).toBe(true);
  });

  it("names a basement floor with the B-n grammar", async () => {
    const { ctx } = open({ bottom: -1, stops: stopsPort(2, [1], [], -1) });
    await toggleServe("B1", false);
    expect(ctx.stops.setServe).toHaveBeenCalledWith(0, false);
    expect(lastAnnounce(ctx)).toBe("Floor B1 skipped.");
    expect(rowOf("B2").querySelector(".es-always")).not.toBeNull();
  });

  it("sets lobby-only stops and every stop", async () => {
    const { ctx } = open();
    button("Express (lobbies)").click();
    await flush();
    expect(ctx.stops.expressStops).toHaveBeenCalledTimes(1);
    expect(lastAnnounce(ctx)).toBe("Stops set to lobbies only.");
    expect(dialog().querySelectorAll(".es-skipped")).toHaveLength(2);
    button("All stops").click();
    await flush();
    expect(ctx.stops.allStops).toHaveBeenCalledTimes(1);
    expect(lastAnnounce(ctx)).toBe("Stopping at every floor.");
    expect(q(".es-skipped")).toBeNull();
  });

  it("drops a bulk stop edit that lands after the dialog closed", async () => {
    const { ctx } = open();
    button("Express (lobbies)").click();
    cancel();
    await flush();
    expect(ctx.stops.expressStops).toHaveBeenCalledTimes(1);
    expect(ctx.stops.read).toHaveBeenCalledTimes(1);
    expect(ctx.announce).not.toHaveBeenCalled();
  });

  it("drops a late all-stops edit the same way", async () => {
    const { ctx } = open();
    button("All stops").click();
    cancel();
    await flush();
    expect(ctx.stops.allStops).toHaveBeenCalledTimes(1);
    expect(ctx.announce).not.toHaveBeenCalled();
  });

  it("shows an express shaft's stops as a fact, with no toggles", () => {
    open({ isExpress: true });
    expect(Array.from(dialog().querySelectorAll(".es-hint")).map((p) => p.textContent)).toContain("Serves all lobbies and sky lobbies");
    expect(q("input[type=checkbox]")).toBeNull();
    expect(q(".es-always")).toBeNull();
    expect(Array.from(dialog().querySelectorAll("button")).some((b) => b.textContent === "Express (lobbies)")).toBe(false);
  });
});

describe("home chips", () => {
  it("leaves a re-pressed home alone and moves a car on a new chip", () => {
    const { ctx, apply } = open();
    const asked = ctx.facts.mock.calls.length;
    expect(chipAt(1, 1).getAttribute("aria-pressed")).toBe("true");
    chipAt(1, 1).click();
    expect(ctx.facts.mock.calls.length).toBe(asked);
    expect(q(".modal-warn")).toBeNull();
    chipAt(3, 2).click();
    expect(homesShown()).toEqual(["3:2", "1:1", "1:3", "1:4"]);
    expect(ctx.facts.mock.lastCall![0].homeFloors).toEqual([1, 3, 1, 1]);
    expect(ctx.autoTune.mock.lastCall![0].homeFloors).toEqual([1, 3, 1, 1]);
    button("Home all cars at the lobby").click();
    expect(homesShown()).toEqual(["1:1", "1:2", "1:3", "1:4"]);
    ok();
    expect(saved(apply).homeFloors).toEqual([1, 1, 1, 1]);
  });
});

describe("OK and Cancel", () => {
  it("applies once per open and closes when the engine has answered", async () => {
    const { apply } = open();
    ok();
    ok();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(saved(apply)).toEqual({ activeCars: { weekday: row(CARS), weekend: row(CARS) }, homeFloors: [1, 1, 1, 1], waitingCarResponse: 0, standardFloorDeparture: 48 });
    await flush();
    expect(dialog().open).toBe(false);
    expect(q(".es-body")).toBeNull();
  });

  it("closes a pristine dialog on the first Cancel without applying", () => {
    const { apply } = open();
    cancel();
    expect(dialog().open).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it("asks before discarding edits, and any edit disarms the ask", () => {
    const { apply } = open();
    press(".es-allcars");
    expect(q(".modal-warn")?.getAttribute("role")).toBe("status");
    cancel();
    expect(dialog().open).toBe(true);
    expect(text('[data-act="close"]')).toBe("Discard changes?");
    expect(q(".modal-warn")?.getAttribute("role")).toBe("alert");
    press(".es-allcars");
    expect(text('[data-act="close"]')).toBe("Cancel");
    cancel();
    cancel();
    expect(dialog().open).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it("routes Esc through the same guard", () => {
    open();
    press(".es-allcars");
    const esc = new Event("cancel", { cancelable: true });
    dialog().dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(text('[data-act="close"]')).toBe("Discard changes?");
    // The live region announces text, not a role change, so arming must change the warning's words.
    expect(text(".modal-warn")).toBe("Press Discard changes? again to close without saving.");
    const again = new Event("cancel", { cancelable: true });
    dialog().dispatchEvent(again);
    expect(again.defaultPrevented).toBe(false);
    expect(q(".es-body")).toBeNull();
  });

  it("routes a backdrop click through the guard and ignores clicks inside", () => {
    open();
    press(".es-allcars");
    q(".es-body")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(text('[data-act="close"]')).toBe("Cancel");
    dialog().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(text('[data-act="close"]')).toBe("Discard changes?");
    dialog().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(dialog().open).toBe(false);
  });
});
