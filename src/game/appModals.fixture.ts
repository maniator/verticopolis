import { vi } from "vitest";
import type { GameApp } from "../main";
import type { Simulation } from "../engine/Simulation";
import { createTsSim } from "../simport/tsSim";
import { Simulation as RealSimulation } from "../engine/Simulation";
import { TsEngine } from "../engine/port/tsEngine";
import { PortCodes } from "../simport/portCodes";
import { catalogFor } from "../engine/catalog";
import { useTowerCatalogSource } from "../engine/towerCatalog";
import type { CatalogEconomy } from "../engine/catalogTypes";

/**
 * The hand-built fake `GameApp` the `appModals` tests pin the stats,
 * exterminator and save-slot commands against: a fake sim whose exterminator
 * pieces a test dials, and a fake port that answers the stats screen's two
 * questions about the app's tower at the time of each ask (`app.sim`, so a
 * test that swaps it gets answers about the new one, as `TsSim` gives) and
 * refuses any other. Its commands go through the real adapter over the fake
 * sim, so they land on its spies. The exterminator, coverage and log line go
 * through a fake `EnginePort` that answers the layout's records from the same
 * fake sim.
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

/** Point the fake tower's catalog at one whose exterminator is `rec` (null:
 *  no exterminator, the Classic case). The commands read it from the tower's
 *  catalog (#921). */
export function withExterminator(sim: SimShape, rec: CatalogEconomy["exterminator"]): void {
  const base = catalogFor("modern");
  const catalog = { ...base, economy: { ...base.economy, exterminator: rec } };
  useTowerCatalogSource(sim, () => catalog);
}

export function makeApp(sim: SimShape) {
  const ui = {
    showStats: vi.fn(),
    confirmModal: vi.fn(),
    showSaves: vi.fn(),
    showTowerPicker: vi.fn(),
    toast: vi.fn(),
  };
  const engine = { viewState: vi.fn(() => ({ camera: "VIEW" })) };
  const current = (): SimShape => app.sim;
  const coverage = () => (current().housekeepingCoverage as () => { infested: number })();
  let reason: string | undefined;
  const portCodes = new PortCodes(new TsEngine(RealSimulation.newGame(1)));
  const logKinds = ["info", "good", "bad", "money"];
  const enginePort = {
    crewCoverage: vi.fn(() => Float64Array.of(0, 0, 0, 0, 0, 0, coverage().infested)),
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
  };
  const port = {
    query: vi.fn((q: { op: string }): Promise<unknown> => {
      if (q.op === "statsReport") return Promise.resolve({ housekeeping: coverage(), exterminationDueDay: current().exterminationDueDay ?? null });
      if (q.op === "housekeepingCoverage") return Promise.resolve(coverage());
      return Promise.reject(new Error(`the fake port answers no ${q.op}`));
    }),
    command: createTsSim(() => app.sim as unknown as Simulation).command,
    view: { header: { minutes: 420, mode: "modern", modernCalendar: "realWorld" }, tower: { towerName: "Fake" } },
  };
  const app: {
    sim: SimShape;
    ui: typeof ui;
    engine: typeof engine;
    port: typeof port;
    enginePort: typeof enginePort;
    portCodes: PortCodes;
    adoptSim: ReturnType<typeof vi.fn>;
  } = {
    sim,
    ui,
    engine,
    port,
    enginePort,
    portCodes,
    adoptSim: vi.fn(),
  };
  return { app: app as unknown as GameApp, ui, engine, port, enginePort, adoptSim: app.adoptSim };
}
