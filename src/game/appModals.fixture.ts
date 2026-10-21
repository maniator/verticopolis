import { vi } from "vitest";
import type { GameApp } from "../main";
import { catalogFor } from "../engine/catalog";
import { useTowerCatalogSource } from "../engine/towerCatalog";
import type { CatalogEconomy } from "../engine/catalogTypes";

/**
 * The hand-built fake `GameApp` the `appModals` tests pin the stats,
 * exterminator and save-slot commands against: a fake sim whose exterminator
 * pieces a test dials, and a fake port that answers the stats screen's two
 * questions from that sim at the time of each ask and refuses any other.
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
  const coverage = () => (sim.housekeepingCoverage as () => { infested: number })();
  const port = {
    query: vi.fn((q: { op: string }): Promise<unknown> => {
      if (q.op === "statsReport") return Promise.resolve({ housekeeping: coverage(), exterminationDueDay: sim.exterminationDueDay ?? null });
      if (q.op === "housekeepingCoverage") return Promise.resolve(coverage());
      return Promise.reject(new Error(`the fake port answers no ${q.op}`));
    }),
    view: { header: { minutes: 420, mode: "modern", modernCalendar: "realWorld" }, tower: { towerName: "Fake" } },
  };
  const app = {
    sim,
    ui,
    engine,
    port,
    adoptSim: vi.fn(),
  };
  return { app: app as unknown as GameApp, ui, engine, port, adoptSim: app.adoptSim };
}
