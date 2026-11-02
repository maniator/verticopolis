import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Simulation } from "../engine/Simulation";
import { TsEngine } from "../engine/port/tsEngine";
import { facilityFloors } from "../engine/facilities";
import { decodeVctower } from "../storage/vctowerContainer";
import type { SerializedGame } from "../engine/types";
import { ViewReader } from "../simport/viewReader";
import { scheduleFromSlots, scheduleSlots } from "../simport/scheduleSlots";
import { createAppHistory } from "./appHistory";
import { createCardKit } from "./cardKit";
import { ScheduleReview } from "./scheduleReview";
import { browserAcknowledgements } from "./scheduleRecovery";
import { keepAct, recoverAct, reviewAct, type ReviewRow } from "../ui/templates/scheduleReview";

const load = (name: string) => decodeVctower(readFileSync(`conformance/fixtures/${name}.vctower`, "utf8")) as SerializedGame;
const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};

/** The paths at which two JSON values differ, so a test can say exactly what a command touched. */
function diffPaths(a: unknown, b: unknown, path = ""): string[] {
  if (a === b) return [];
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return [path];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap((k) => diffPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}/${k}`));
}

/** The game's own pieces around one tower: the port, the view, the card kit, real Undo, and the review. */
function play(raw: SerializedGame, store: Parameters<typeof browserAcknowledgements>[0] = memory()) {
  const port = new TsEngine(Simulation.deserialize(raw));
  const reader = new ViewReader(port, facilityFloors);
  reader.update();
  const kit = createCardKit({ enginePort: port, reader });
  const toasts: string[] = [];
  const opened: number[] = [];
  const said: string[] = [];
  const order: string[] = [];
  const announced: string[] = [];
  const shown: { rows: readonly ReviewRow[]; handlers: Record<string, () => void>; focus?: string }[] = [];
  const history = createAppHistory({
    enginePort: port,
    ui: { toast: (t) => void toasts.push(t) },
    followSwap: () => reader.update(),
  });
  const review = new ScheduleReview({
    engine: () => port,
    reader: () => reader,
    kit: () => kit,
    ui: {
      toast: (t) => void toasts.push(t),
      sayVisibly: (t) => void (said.push(t), order.push("say")),
      showScheduleReview: (rows, handlers, focus) => void (shown.push({ rows, handlers: handlers ?? {}, focus }), order.push("open")),
    },
    audio: { sfx: () => {} },
    captureUndo: (label) => history.capture(label),
    commitUndo: () => history.commit(),
    refreshEditor: () => {},
    announce: (m) => void announced.push(m),
    openSchedule: (id) => void opened.push(id),
    acknowledgements: browserAcknowledgements(store),
  });
  const saved = () => JSON.parse(port.serialize()) as unknown;
  const scheduleOf = (id: number) => scheduleFromSlots(port.shaftSchedule(id));
  const dialog = () => shown[shown.length - 1]!;
  return {
    port,
    reader,
    kit,
    review,
    history,
    toasts,
    said,
    order,
    announced,
    opened,
    shown,
    dialog,
    saved,
    scheduleOf,
    store,
  };
}

/** A staggered day: off through the small hours, two cars until noon, five after. */
function hoursOnShift(hour: number): number {
  if (hour < 6) return 0;
  return hour < 12 ? 2 : 5;
}

describe("the schedule review on split-tower-4 (#1548)", () => {
  it("lists every short elevator, offers the one-click choice only on the flat ones, and changes nothing by looking", () => {
    const g = play(load("split-tower-4"));
    const before = g.saved();
    g.review.open();
    expect(g.dialog().rows.map((r) => [r.id, r.preview !== undefined])).toEqual([
      [1139, true],
      [1735, true],
      [9281, true],
    ]);
    expect(g.dialog().rows[0]!.facts).toBe("8 cars installed. 3 are on shift in every hour, weekdays and weekends.");
    expect(diffPaths(before, g.saved())).toEqual([]);
  });

  it("applies the recovery to one shaft only, touching nothing but its hourly car counts", () => {
    const g = play(load("split-tower-4"));
    const before = g.saved();
    const schedule = g.scheduleOf(1139)!;
    g.review.open();
    g.dialog().handlers[recoverAct(1139)]!();
    const after = g.scheduleOf(1139)!;
    expect(after.activeCars).toEqual({
      weekday: Array(24).fill(8),
      weekend: Array(24).fill(8),
    });
    expect({ ...after, activeCars: undefined }).toEqual({
      ...schedule,
      activeCars: undefined,
    });
    // The rest of the tower is as it was: every changed path sits inside shaft 1139's schedule.
    const changed = diffPaths(before, g.saved());
    expect(changed.length).toBeGreaterThan(0);
    for (const path of changed) expect(path, path).toMatch(/activeCars|schedule/i);
    expect(g.scheduleOf(1735)!.activeCars).toEqual({
      weekday: Array(24).fill(3),
      weekend: Array(24).fill(3),
    });
    // The dialog redrew without the shaft that was recovered.
    expect(g.dialog().rows.map((r) => r.id)).toEqual([1735, 9281]);
  });

  it("is idempotent: a second recovery finds nothing to do and writes nothing", () => {
    const g = play(load("split-tower-4"));
    g.review.recover(1139);
    const once = g.saved();
    g.review.recover(1139);
    expect(g.saved()).toEqual(once);
  });

  it("undoes in one step, back to the exact earlier save, and redoes", async () => {
    const g = play(load("split-tower-4"));
    const before = g.saved();
    g.review.recover(1139);
    const recovered = g.saved();
    expect(diffPaths(before, recovered).length).toBeGreaterThan(0);
    await g.history.undo();
    expect(diffPaths(before, g.saved())).toEqual([]);
    expect(g.review.findings().map((f) => f.shaft.id)).toEqual([1139, 1735, 9281]);
    await g.history.redo();
    expect(diffPaths(recovered, g.saved())).toEqual([]);
    expect(g.review.findings().map((f) => f.shaft.id)).toEqual([1735, 9281]);
  });

  it("keeps the recovery through save and reload, and finds nothing more on the reloaded tower", () => {
    const g = play(load("split-tower-4"));
    g.review.recover(1139);
    g.review.recover(1735);
    g.review.recover(9281);
    const reloaded = play(JSON.parse(g.port.serialize()) as SerializedGame);
    expect(reloaded.review.findings()).toEqual([]);
    reloaded.review.open();
    expect(reloaded.dialog().rows).toEqual([]);
  });

  it("keeps staggered, off-duty and home-floor schedules exactly as authored", () => {
    const raw = load("split-tower-4");
    const g = play(raw);
    const staggered = {
      weekday: Array.from({ length: 24 }, (_, h) => hoursOnShift(h)),
      weekend: Array(24).fill(4),
    };
    // 5675 runs the whole fleet in the fixture; give it a staggered schedule that is NOT flat and check it is never offered the one-click.
    g.port.scheduleShaft(
      5675,
      scheduleSlots({
        activeCars: staggered,
        homeFloors: g.scheduleOf(5675)?.homeFloors,
      }),
    );
    const row = g.review.findings().find((f) => f.shaft.id === 5675);
    expect(row?.flatAt).toBeNull();
    g.review.open();
    expect(g.dialog().handlers[recoverAct(5675)]).toBeUndefined();
    expect(g.dialog().handlers[reviewAct(5675)]).toBeDefined();
    const before = g.scheduleOf(5675);
    g.review.recover(5675);
    expect(g.scheduleOf(5675)).toEqual(before);
  });
});

describe("what the player is told, and what they decide (#1548)", () => {
  /** The same tower under another founding seed: a different tower to the browser's memory. */
  const reseeded = (name: string, seed: number): SerializedGame => ({ ...load(name), initialSeed: seed }) as SerializedGame;

  it("mentions flat schedules once per tower, then never again, even after a reload", () => {
    const store = memory();
    const g = play(load("split-tower-4"), store);
    g.review.tick();
    expect(g.toasts).toHaveLength(1);
    expect(g.toasts[0]).toMatch(/3 elevators have more cars/);
    g.review.tick(); // same loaded tower
    expect(g.toasts).toHaveLength(1);
    const again = play(load("split-tower-4"), store);
    again.review.tick();
    expect(again.toasts).toEqual([]);
  });

  it("stays quiet on towers with nothing to review", () => {
    for (const name of ["sixseven_2", "sixseven-december", "towerone_6"]) {
      const g = play(load(name));
      g.review.tick();
      expect(g.toasts, name).toEqual([]);
    }
  });

  it("says nothing while the title screen is up, and mentions the tower once it is gone", () => {
    const splash = document.createElement("div");
    splash.id = "splash";
    document.body.appendChild(splash);
    const g = play(load("split-tower-4"));
    g.review.tick();
    expect(g.toasts).toEqual([]);
    splash.remove();
    g.review.tick();
    expect(g.toasts).toHaveLength(1);
  });

  it("follows a tower swap: a tower loaded or imported later is looked at on its own", () => {
    const g = play(load("sixseven_2"));
    g.review.tick();
    expect(g.toasts).toEqual([]);
    g.port.restore(JSON.stringify(load("split-tower"))); // an import or a load
    g.reader.update();
    g.review.tick();
    expect(g.toasts).toHaveLength(1);
    expect(g.toasts[0]).toMatch(/^An elevator has more cars/);
  });

  it("remembers Keep as is for that shaft in that tower, and for no other tower or shaft", () => {
    const store = memory();
    const g = play(load("split-tower-4"), store);
    g.review.open();
    expect(g.dialog().handlers[keepAct(1139)]).toBeDefined();
    g.dialog().handlers[keepAct(1139)]!();
    expect(g.dialog().rows.find((r) => r.id === 1139)).toMatchObject({
      kept: true,
    });
    expect(g.dialog().handlers[keepAct(1139)]).toBeUndefined(); // no second button for a settled answer
    expect(g.dialog().handlers[recoverAct(1139)]).toBeDefined(); // a change of mind is still one click
    expect(g.dialog().rows.find((r) => r.id === 1735)).toMatchObject({
      kept: false,
    });
    // A later visit to the same tower, a save made of it, and its earlier save all see the answer.
    for (const raw of [load("split-tower-4"), load("split-tower")]) {
      const later = play(raw, store);
      later.review.open();
      expect(
        later.dialog().rows.find((r) => r.id === 1139),
        "same tower",
      ).toMatchObject({ kept: true });
    }
    // The same shafts under another founding seed are another tower.
    const other = play(reseeded("split-tower-4", 7), store);
    other.review.open();
    expect(other.dialog().rows.find((r) => r.id === 1139)).toMatchObject({
      kept: false,
    });
  });

  it("keeps the choice when the recovery is undone, and does not mention the shaft again", async () => {
    const store = memory();
    const g = play(load("split-tower-4"), store);
    g.review.tick();
    g.review.recover(1139);
    await g.history.undo();
    g.toasts.length = 0;
    g.review.tick();
    expect(g.toasts).toEqual([]);
  });

  it("keeps a Keep as is decision when the shaft span changes but the shaft identity stays the same", () => {
    const store = memory();
    const keep = play(load("split-tower-4"), store);
    keep.review.open();
    keep.dialog().handlers[keepAct(1139)]!();
    const shaft = keep.port.sim.tower.transports.find((t) => t.id === 1139)!;
    shaft.bottom = 4;
    shaft.top = 52;
    const later = play(JSON.parse(keep.port.serialize()) as SerializedGame, store);
    later.review.open();
    expect(later.dialog().rows.find((r) => r.id === 1139)).toMatchObject({ kept: true });
    expect(later.dialog().handlers[keepAct(1139)]).toBeUndefined();
    expect(later.dialog().handlers[recoverAct(1139)]).toBeDefined();
  });

  it("sends Review schedule to that shaft's own schedule dialog and changes nothing", () => {
    const g = play(load("split-tower-4"));
    const before = g.saved();
    g.review.open();
    g.dialog().handlers[reviewAct(9281)]!();
    expect(g.opened).toEqual([9281]);
    expect(diffPaths(before, g.saved())).toEqual([]);
  });

  it("lists a service elevator with a staggered schedule for manual review without the one-click", () => {
    const raw = load("split-tower");
    const g = play(raw);
    g.port.scheduleShaft(
      1735,
      scheduleSlots({
        activeCars: {
          weekday: Array.from({ length: 24 }, (_, h) => (h < 8 ? 1 : 2)),
          weekend: Array(24).fill(2),
        },
      }),
    );
    g.review.tick(); // only flat schedules are mentioned unprompted
    expect(g.toasts).toHaveLength(1);
    expect(g.toasts[0]).toMatch(/^An elevator has/); // shaft 1139, not the staggered service elevator
    g.review.open();
    const row = g.dialog().rows.find((r) => r.id === 1735);
    expect(row).toBeDefined();
    expect(row!.preview).toBeUndefined();
    expect(row!.facts).toBe("3 cars installed. Between 1 and 2 are on shift, depending on the hour and the day.");
    expect(g.dialog().handlers[reviewAct(1735)]).toBeDefined();
  });
});

describe("the review's notices, focus and copy (#1548)", () => {
  it("waits out an open dialog before mentioning the tower, so the toast is not hidden behind it", () => {
    const dialog = document.createElement("dialog");
    dialog.id = "modal";
    dialog.setAttribute("open", "");
    document.body.appendChild(dialog);
    const g = play(load("split-tower-4"));
    g.review.tick();
    expect(g.toasts).toEqual([]);
    dialog.remove();
    g.review.tick();
    expect(g.toasts).toHaveLength(1);
    expect(g.toasts[0]).toMatch(/Open Full Statistics/);
  });

  it("holds Keep and the one-time mention for the session when the browser will not store them", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    const g = play(load("split-tower-4"), blocked);
    g.review.tick();
    expect(g.toasts).toHaveLength(1);
    g.port.restore(g.port.serialize()); // another generation of the same tower, as Undo or a reload of it would make
    g.reader.update();
    g.review.tick();
    expect(g.toasts).toHaveLength(1);
    g.review.open();
    g.dialog().handlers[keepAct(1139)]!();
    expect(g.dialog().rows.find((r) => r.id === 1139)).toMatchObject({ kept: true });
  });

  it("redraws the dialog before a notice, says a refusal visibly, and keeps the player's place", () => {
    const g = play(load("split-tower-4"));
    g.review.recover(1139);
    expect(g.dialog().focus).toBe(recoverAct(1735)); // the next elevator in the list
    g.review.recover(1139); // already done
    expect(g.said).toEqual(["That elevator already uses all of its cars."]);
    g.review.open();
    g.dialog().handlers[keepAct(1735)]!();
    expect(g.dialog().focus).toBe(recoverAct(1735));
    expect(g.announced[g.announced.length - 1]).toMatch(/^Kept the schedule of the elevator on floors .+ to .+ as it is\.$/);
  });

  it("says so, inside the redrawn dialog, when Review schedule names an elevator that is gone", () => {
    const g = play(load("split-tower-4"));
    g.review.open();
    const review = g.dialog().handlers[reviewAct(1139)]!;
    vi.spyOn(g.kit.cards, "shaft").mockReturnValue(undefined);
    g.opened.length = 0;
    g.order.length = 0;
    review();
    expect(g.opened).toEqual([]);
    expect(g.order).toEqual(["open", "say"]);
    expect(g.said).toEqual(["That elevator is gone."]);
  });

  it("says a refused recovery inside the redrawn dialog, and leaves focus on the row that failed", () => {
    const g = play(load("split-tower-4"));
    vi.spyOn(g.port, "scheduleShaft").mockReturnValue(Float64Array.of(0, 0));
    vi.spyOn(g.port, "lastReason").mockReturnValue("The elevator is busy.");
    const before = g.saved();
    g.review.recover(1139);
    expect(g.order).toEqual(["open", "say"]); // the notice goes after the redraw, or the redraw wipes it
    expect(g.said).toEqual(["The elevator is busy."]);
    expect(g.dialog().focus).toBe(recoverAct(1139));
    expect(diffPaths(before, g.saved())).toEqual([]);
    expect(g.dialog().rows.map((r) => r.id)).toEqual([1139, 1735, 9281]);
  });

  it("says an already-done recovery after the redraw too", () => {
    const g = play(load("split-tower-4"));
    g.review.recover(1139);
    g.order.length = 0;
    g.review.recover(1139);
    expect(g.order).toEqual(["open", "say"]);
  });

  it("words one shaft, a one-car count and a fully off-duty schedule correctly", () => {
    const g = play(load("split-tower"));
    g.review.tick();
    expect(g.toasts[0]).toBe(
      "An elevator has more cars than its schedule puts on shift. Open Full Statistics to review it. Nothing changes unless you choose it.",
    );
    g.port.scheduleShaft(1735, scheduleSlots({ activeCars: { weekday: Array(24).fill(0), weekend: Array(24).fill(0) } }));
    g.review.open();
    expect(g.dialog().rows.find((r) => r.id === 1735)!.facts).toBe("3 cars installed. No cars are on shift at any hour.");
    g.port.scheduleShaft(1735, scheduleSlots({ activeCars: { weekday: Array(24).fill(1), weekend: Array(24).fill(1) } }));
    g.review.open();
    expect(g.dialog().rows.find((r) => r.id === 1735)!.facts).toBe("3 cars installed. 1 is on shift in every hour, weekdays and weekends.");
  });

  it("recovers and undoes on split-tower's 5-car shaft too, and leaves both fixtures' bytes alone", async () => {
    const before = readFileSync("conformance/fixtures/split-tower.vctower");
    const g = play(load("split-tower"));
    const saved = g.saved();
    g.review.recover(1139);
    expect(g.scheduleOf(1139)!.activeCars).toEqual({ weekday: Array(24).fill(5), weekend: Array(24).fill(5) });
    await g.history.undo();
    expect(diffPaths(saved, g.saved())).toEqual([]);
    expect(readFileSync("conformance/fixtures/split-tower.vctower").equals(before)).toBe(true);
  });
});
