import { vi } from "vitest";
import type { GameApp } from "../main";
import { Simulation } from "../engine/Simulation";
import { TsEngine } from "../engine/port/tsEngine";
import { PortCodes } from "../simport/portCodes";
import { catalogFor } from "../engine/catalog";
import { catalogOn, useTowerCatalogSource } from "../engine/towerCatalog";
import type { CatalogEconomy } from "../engine/catalogTypes";

/**
 * The hand-built fake `GameApp` the `appModals` tests pin the stats,
 * exterminator and save-slot commands against: a fake sim whose exterminator
 * pieces a test dials, and a fake `EnginePort` that answers the layout's
 * records (the stats sheet, the coverage, the booking and the log line) from
 * the app's tower at the time of each ask, and saves and loads stand-in text (`app.sim`, so a test that swaps it
 * gets answers about the new one, its catalog and a moved generation).
 */

/** Let the port's answers and the renders queued behind them run. */
export const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export interface Refusal {
  ok: false;
  reason?: "funds" | "pending" | "none" | string;
  cost?: number;
}

export interface SimShape {
  view: unknown;
  exterminationDueDay: number | undefined;
  mode: "modern";
  housekeepingCoverage: ReturnType<typeof vi.fn>;
  callExterminator: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
}

/** A sim where the exterminator is offerable: Modern recovery exists, rooms are
 *  infested, and none is en route. Callers dial the pieces they need. */
export function makeSim(over: Partial<SimShape> = {}): SimShape {
  const sim: SimShape = {
    view: null,
    exterminationDueDay: undefined,
    mode: "modern",
    housekeepingCoverage: vi.fn(() => ({ infested: 2 })),
    callExterminator: vi.fn(() => ({ ok: true })),
    emit: vi.fn(),
    ...over,
  };
  withExterminator(sim, { calloutFee: 100, perRoomFee: 50 });
  return sim;
}

/** The fake ports each fake tower is loaded in. The commands read the
 *  catalog through the engine the app holds (#921, PR 5e), so a catalog
 *  dialed on a tower reaches the port showing it. */
const portsShowing = new WeakMap<SimShape, Set<object>>();

/** Have `port` answer the catalog of `sim`, read afresh. */
function showCatalog(port: object, sim: SimShape): void {
  useTowerCatalogSource(port, (mode) => catalogOn(sim, mode));
}

/** Point the fake tower's catalog at one whose exterminator is `rec` (null:
 *  no exterminator, the Classic case). The commands read it from the
 *  engine's catalog (#921). */
export function withExterminator(sim: SimShape, rec: CatalogEconomy["exterminator"]): void {
  const base = catalogFor("modern");
  const catalog = { ...base, economy: { ...base.economy, exterminator: rec } };
  useTowerCatalogSource(sim, () => catalog);
  for (const port of portsShowing.get(sim) ?? []) showCatalog(port, sim);
}

/** Load `sim` into the fake `port`, out of whichever tower it showed. */
function loadInto(port: object, sim: SimShape, before?: SimShape): void {
  if (before) portsShowing.get(before)?.delete(port);
  const ports = portsShowing.get(sim) ?? new Set<object>();
  ports.add(port);
  portsShowing.set(sim, ports);
  showCatalog(port, sim);
}

export function makeApp(sim: SimShape) {
  const ui = {
    showStats: vi.fn(),
    confirmModal: vi.fn(),
    showSaves: vi.fn(),
    showTowerPicker: vi.fn(),
    toast: vi.fn(),
  };
  const engine = { viewState: vi.fn(() => ({ tile: 40, floor: 3, zoom: 2 })) };
  const current = (): SimShape => app.sim;
  const coverage = () => (current().housekeepingCoverage as () => { infested: number })();
  let reason: string | undefined;
  let generation = 1;
  const real = new TsEngine(Simulation.newGame(1, "modern"));
  const portCodes = new PortCodes(real);
  const logKinds = ["info", "good", "bad", "money"];
  const enginePort = {
    generation: () => generation,
    crewCoverage: vi.fn(() => Float64Array.of(0, 0, 0, 0, 0, 0, coverage().infested)),
    /** A fresh Modern tower's sheet with the fake tower's infested rooms and
     *  booking written in. */
    statsSheet: vi.fn(() => {
      const rec = real.statsSheet();
      const head = portCodes.fields("statsSheet");
      rec[head.indexOf("exterminationDueDay")] = current().exterminationDueDay ?? NaN;
      const infested = head.length + portCodes.fields("statsStrip").length + portCodes.fields("crewCoverage").indexOf("infested");
      rec[infested] = coverage().infested;
      return rec;
    }),
    bookExterminator: vi.fn(() => {
      const r = (current().callExterminator as () => { ok: boolean; reason?: string; cost?: number; rooms?: number })();
      reason = r.ok ? undefined : (r.reason ?? "unavailable");
      return Float64Array.of(r.ok ? 1 : 0, 0, r.cost ?? 0, r.rooms ?? 0);
    }),
    logLine: vi.fn((text: string, kindCode: number) => {
      (current().emit as (t: string, k: string) => void)(text, logKinds[kindCode]);
      return Float64Array.of(1, 0);
    }),
    lastReason: () => reason,
    setCamera: vi.fn((tile: number, floor: number, zoom: number) => {
      current().view = { tile, floor, zoom };
    }),
    serialize: vi.fn(() => "SAVE TEXT"),
    /** Loads any text but "BAD": the swap moves the generation, and the
     *  caller has the app follow it. */
    loadSave: vi.fn((text: string) => {
      if (text === "BAD") return Float64Array.of(0, generation);
      generation++;
      return Float64Array.of(1, generation);
    }),
  };
  const reader = {
    update: vi.fn(),
    header: { minutes: 420, mode: "modern", modernCalendar: "realWorld" },
    tower: { towerName: "Fake" },
  };
  let tower = sim;
  const app: {
    sim: SimShape;
    ui: typeof ui;
    engine: typeof engine;
    reader: typeof reader;
    enginePort: typeof enginePort;
    portCodes: PortCodes;
    followSwap: ReturnType<typeof vi.fn>;
  } = {
    /** A swap moves the generation, as the engine's swaps do. */
    get sim() {
      return tower;
    },
    set sim(next: SimShape) {
      loadInto(enginePort, next, tower);
      tower = next;
      generation++;
    },
    ui,
    engine,
    reader,
    enginePort,
    portCodes,
    followSwap: vi.fn(),
  };
  loadInto(enginePort, sim);
  return { app: app as unknown as GameApp, ui, engine, reader, enginePort, followSwap: app.followSwap };
}
