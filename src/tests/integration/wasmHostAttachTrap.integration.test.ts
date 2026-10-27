import { describe, expect, it, vi } from "vitest";
import { Simulation } from "../../engine/Simulation";
import type { WasmEngine, WasmModule } from "../../dualrun/binding";
import { startWasmHost, type WasmHostApp } from "../../wasmhost/startWasmHost";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";

/**
 * A trap while a tower attaches (#1113) on the real engine: hosting latches
 * off for the page life and nothing calls into the module again. Permanent
 * host behavior: a Rust-only build latches on the same signal. Traps are
 * injected at the binding boundary, before the real call runs.
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

/** GameApp's adopt as far as the host sees it. */
function app(sim: Simulation): WasmHostApp {
  const a = {
    sim,
    adoptSim(next: Simulation) {
      next.gameplayEvents.inherit(a.sim.gameplayEvents);
      a.sim = next;
    },
  };
  return a;
}

const quiet = () => ({ info: vi.fn(), error: vi.fn() });
const ownSerialize = (sim: Simulation) => Object.prototype.hasOwnProperty.call(sim, "serialize");

/** The real module with every call into it recorded: its functions and the
 *  methods of every engine it builds. After `trapNext`, the next call of
 *  that name throws a `WebAssembly.RuntimeError` before it runs, as a Rust
 *  panic there would. */
function countedWasm(): { mod: WasmModule; calls: string[]; trapNext: (name: "Engine.fromSave" | "catalog") => void } {
  const real = wasm();
  const calls: string[] = [];
  const traps = new Set<string>();
  const enter = (name: string) => {
    calls.push(name);
    if (traps.delete(name)) throw new WebAssembly.RuntimeError("unreachable");
  };
  const counted = (engine: WasmEngine): WasmEngine =>
    new Proxy(engine, {
      get(target, key) {
        const value = Reflect.get(target, key, target) as unknown;
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          calls.push(`engine.${String(key)}`);
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
  const mod: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(real)) {
    mod[name] =
      typeof value === "function"
        ? (...args: unknown[]) => {
            enter(name);
            return (value as (...a: unknown[]) => unknown)(...args);
          }
        : value;
  }
  mod.Engine = {
    fromSave(save: string, markers?: string) {
      enter("Engine.fromSave");
      return counted(real.Engine.fromSave(save, markers));
    },
  };
  return { mod: mod as unknown as WasmModule, calls, trapNext: (name) => void traps.add(name) };
}

describe.skipIf(!hasWasmPackage())("WASM host attach trap (#1113)", () => {
  it("latches hosting off when the engine traps while a load attaches, and calls the module no more", () => {
    const { mod, calls, trapNext } = countedWasm();
    const a = app(Simulation.newGame(61, "classic"));
    const seen: unknown[] = [];
    const h = startWasmHost(a, mod, quiet(), { onFallback: (f, latched) => seen.push({ ...f, latched }) });
    try {
      a.sim.money = 1e9;
      for (let x = 170; x < 200; x++) expect(a.sim.build("lobby", 1, x).ok).toBe(true);
      a.sim.tick(1);
      expect(h.status.hosted).toBe(true);
      trapNext("Engine.fromSave");
      const loaded = Simulation.newGame(62, "classic");
      a.adoptSim(loaded);
      const trapped = calls.length;
      expect(calls[trapped - 1]).toBe("Engine.fromSave");
      expect(h.status).toMatchObject({ hosted: false, latched: true, starts: 1, lastFallback: { reason: "attach-refused", stage: "adopt" } });
      expect(seen).toEqual([{ reason: "attach-refused", stage: "adopt", latched: true }]);
      // The loaded tower runs on TypeScript: its own save and tick.
      expect(a.sim).toBe(loaded);
      expect(ownSerialize(loaded)).toBe(false);
      const minutes = loaded.clock.minutes;
      loaded.tick(1);
      expect(loaded.clock.minutes).toBe(minutes + 1);
      // A later load stays on TypeScript too, and nothing reaches the module.
      a.adoptSim(Simulation.newGame(63, "classic"));
      a.sim.tick(1);
      a.sim.serialize();
      h.stop();
      expect(h.status).toMatchObject({ hosted: false, starts: 1, fallbacks: 1 });
      expect(calls.slice(trapped)).toEqual([]);
    } finally {
      h.stop();
    }
  });

  it("latches on a trap in the attach's catalog read, which the binding's reader wraps", () => {
    const { mod, calls, trapNext } = countedWasm();
    trapNext("catalog");
    const a = app(Simulation.newGame(66, "classic"));
    const h = startWasmHost(a, mod, quiet());
    try {
      expect(calls).toEqual(["catalog"]);
      expect(h.status).toMatchObject({ hosted: false, latched: true, starts: 0, lastFallback: { reason: "attach-refused", stage: "start" } });
      expect(h.status.lastError).toMatch(/^not hosting this tower or any later one, since the Rust engine trapped: the engine returned no classic catalog: unreachable/);
      a.adoptSim(Simulation.newGame(67, "classic"));
      expect(calls).toEqual(["catalog"]);
    } finally {
      h.stop();
    }
  });
});
