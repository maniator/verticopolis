import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { WasmEngine } from "../../dualrun/binding";
import type { CalendarKind } from "../../shared/engineTypes";
import type { SerializedGame } from "../../shared/serializedGame";
import type { TelemetryDocument } from "../../wasmhost/telemetry";
import { REPO_ROOT } from "../conformance/scenario";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";
import { FIXTURES } from "../conformance/fixtureSim";

/**
 * The hourly elevator telemetry on the Rust engine (#868): the demand curves
 * the schedule dialog reads, the utilization average and the boarding-origin
 * rings, yesterday's housekeeping result the stats screen reads, and the
 * crowd's per-origin commute-stress averages (#514). The save never carries
 * them, so neither the conformance view nor the frame-day golden holds them.
 * Each fixture opens the way the game opens a file and runs hour by hour; every
 * hour's documents must be what the WASM host adopts, a weekday hour must
 * leave the weekend rings alone and a weekend hour the weekday rings, and the
 * runs must have filled every store with real values.
 */

const MINUTES_PER_DAY = 1440;
const MINUTES_PER_HOUR = 60;

/** Each calendar's week: its length and the weekend days that close it
 *  (`CANON` and `REAL_WORLD` in engine-rs/src/clock.rs). */
const WEEK: Record<CalendarKind, { days: number; weekendDays: number }> = {
  canon: { days: 3, weekendDays: 1 },
  realWorld: { days: 7, weekendDays: 2 },
};

type Ring = "weekday" | "weekend";

interface Seen {
  weekday: boolean;
  weekend: boolean;
  housekeeping: boolean;
  commute: boolean;
}

const saveOf = (engine: WasmEngine) => JSON.parse(engine.serialize()) as SerializedGame;

const isNum = (v: unknown): v is number => typeof v === "number";
const isPairs = (v: unknown): boolean => Array.isArray(v) && v.every((p) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]));
const isDays = (v: unknown, slot: (x: unknown) => boolean): boolean => {
  if (typeof v !== "object" || v === null) return false;
  const { weekday, weekend } = v as { weekday?: unknown; weekend?: unknown };
  return Array.isArray(weekday) && Array.isArray(weekend) && weekday.every(slot) && weekend.every(slot);
};
const isEntries = (v: unknown, value: (x: unknown) => boolean): boolean => Array.isArray(v) && v.every((e) => Array.isArray(e) && e.length === 2 && isNum(e[0]) && value(e[1]));

/** Whether a parsed document is the shape `seedElevatorTelemetry` takes, all
 *  the way down: `[shaft, value]` entries for the utilization, the demand
 *  curves (a weekday and a weekend ring of numbers) and the origin rings
 *  (rings of `[floor, count]` pairs). */
function isTelemetryDocument(v: unknown): v is TelemetryDocument {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Record<string, unknown>;
  return isEntries(d.util, isNum) && isEntries(d.hourly, (x) => isDays(x, isNum)) && isEntries(d.origins, (x) => isDays(x, isPairs));
}

function telemetryOf(engine: WasmEngine): TelemetryDocument {
  const doc: unknown = JSON.parse(engine.elevatorTelemetry());
  if (!isTelemetryDocument(doc)) throw new Error("the engine's telemetry is not the document the WASM host adopts");
  return doc;
}

/** The load every shaft recorded on `ring`, by shaft: each demand-curve hour
 *  and each boarding-origin slot that holds anything. A shaft the store has
 *  not listed yet reads as having recorded nothing. */
function ringOf(doc: TelemetryDocument, ring: Ring): Map<string, string> {
  const load = new Map<string, string>();
  for (const [id, r] of doc.hourly) load.set(`demand of shaft ${id}`, JSON.stringify(r[ring].flatMap((v, hour) => (v === 0 ? [] : [[hour, v]]))));
  for (const [id, r] of doc.origins) {
    const origins = r[ring].flatMap((slot, i) => (slot.length === 0 ? [] : [[i, slot]]));
    load.set(`origins of shaft ${id}`, JSON.stringify(origins));
  }
  for (const [key, v] of load) if (v === "[]") load.delete(key);
  return load;
}

/** Whether any shaft recorded load on `ring`, so a run of empty stores never
 *  passes for one of real curves. */
const warmed = (doc: TelemetryDocument, ring: Ring) => doc.hourly.some(([, r]) => r[ring].some((v) => v > 0));

/** Tick an hour at a time, checking every store after each hour. */
function runHours(engine: WasmEngine, hours: number, week: { days: number; weekendDays: number }, seen: Seen, label: string): void {
  const dayOf = (minutes: number) => Math.floor(minutes / MINUTES_PER_DAY);
  const isWeekend = (day: number) => day % week.days >= week.days - week.weekendDays;
  for (let h = 0; h < hours; h++) {
    const before = telemetryOf(engine);
    const startDay = dayOf(saveOf(engine).minutes);
    engine.tick(MINUTES_PER_HOUR);
    const save = saveOf(engine);
    const doc = telemetryOf(engine);
    const at = `${label} hour ${h}`;
    const shafts = new Set(save.transports.map((t) => t.id));
    for (const [id] of [...doc.util, ...doc.hourly, ...doc.origins]) expect(shafts.has(id), `${at}: shaft ${id} is in the tower`).toBe(true);
    // An hour inside one day records into that day's rings only.
    if (dayOf(save.minutes) === startDay && save.minutes % MINUTES_PER_DAY !== 0) {
      const other: Ring = isWeekend(startDay) ? "weekday" : "weekend";
      expect(ringOf(doc, other), `${at}: a ${other === "weekday" ? "weekend" : "weekday"} hour leaves the ${other} rings alone`).toEqual(ringOf(before, other));
    }
    const hk = JSON.parse(engine.housekeepingReport() ?? "null") as { cleaned: number; leftover: number } | null;
    if (hk !== null) expect(Object.keys(hk).sort(), `${at} housekeeping`).toEqual(["cleaned", "leftover"]);
    const commute = JSON.parse(engine.commuteStress()) as [number, number][];
    const floors = commute.map(([floor]) => floor);
    expect(floors, `${at}: commute stress by floor`).toEqual([...floors].sort((a, b) => a - b));
    seen.commute ||= commute.length > 0;
    seen.weekday ||= warmed(doc, "weekday");
    seen.weekend ||= warmed(doc, "weekend");
    seen.housekeeping ||= hk !== null && (hk.cleaned > 0 || hk.leftover > 0);
  }
}

/** Two days from the fixture's own clock, then the clock moved (raw, as
 *  `clock.advance` does) to the hour before the next weekend and a day there,
 *  so the weekend rings and the weekday-to-weekend origin attribution are
 *  checked too. */
function run(fixture: string, seen: Seen): void {
  const engine = wasm().Engine.fromVctower(readFileSync(resolve(REPO_ROOT, fixture), "utf8"));
  try {
    const save = saveOf(engine);
    const week = WEEK[save.mode === "modern" ? (save.modernCalendar ?? "realWorld") : "canon"];
    runHours(engine, 48, week, seen, fixture);
    const minutes = saveOf(engine).minutes;
    let day = Math.floor(minutes / MINUTES_PER_DAY) + 1;
    while (day % week.days !== week.days - week.weekendDays || day * MINUTES_PER_DAY - MINUTES_PER_HOUR <= minutes) day++;
    const delta = day * MINUTES_PER_DAY - MINUTES_PER_HOUR - minutes;
    expect(delta, `${fixture} reaches the weekend ahead`).toBeGreaterThan(0);
    engine.advanceClock(delta);
    runHours(engine, 26, week, seen, `${fixture} weekend`);
  } finally {
    engine.free();
  }
}

describe.skipIf(!hasWasmPackage())("elevator telemetry on the Rust engine", () => {
  it("every fixture, hour by hour, through a weekday and a weekend", () => {
    const seen: Seen = { weekday: false, weekend: false, housekeeping: false, commute: false };
    for (const fixture of FIXTURES) run(fixture, seen);
    // Real values were checked, never only empty stores.
    expect(seen).toEqual({ weekday: true, weekend: true, housekeeping: true, commute: true });
  }, 300_000);
});
