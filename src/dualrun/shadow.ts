import type { Divergence, ShadowCommand } from "./commands";
import type { WasmEngine, WasmModule } from "./binding";

/**
 * The second engine behind the shadow commands: one WASM `Engine` instance
 * that receives what the live simulation received, and answers a checkpoint
 * with the first place its hashed views depart from the live ones. Runs
 * wherever the binding loads: a Web Worker in the browser, plain Node in the
 * day gate.
 */
export class ShadowEngine {
  private engine: WasmEngine | null = null;
  constructor(private readonly mod: WasmModule) {}

  /** Whether a load has succeeded and not been freed since. */
  loaded(): boolean {
    return this.engine !== null;
  }

  /** The loaded engine, for a host that reads it directly (the frame view,
   *  the save); an error naming the missing `load` otherwise. */
  handle(): WasmEngine {
    return this.live();
  }

  /** The loaded engine, or an error naming the missing `load`. */
  private live(): WasmEngine {
    if (!this.engine) throw new Error("shadow: no engine loaded; send a load command first");
    return this.engine;
  }

  /** Apply one command. A checkpoint returns the divergence it found, or
   *  null when both views agree; every other command returns null. */
  apply(cmd: ShadowCommand): Divergence | null {
    switch (cmd.op) {
      case "load": {
        // The old engine goes first, and the field is cleared before the
        // new one is built, so a refused save never leaves a freed handle
        // behind to be called into.
        const old = this.engine;
        this.engine = null;
        old?.free();
        this.engine = this.mod.Engine.fromSave(cmd.save, JSON.stringify(cmd.markers));
        return null;
      }
      case "tick": this.live().tick(cmd.dt); return null;
      case "build": this.live().build(cmd.kind, cmd.floor, cmd.x); return null;
      case "buildTransport": this.live().buildTransport(cmd.kind, cmd.x, cmd.bottom, cmd.top); return null;
      case "sellAt": this.live().sellAt(cmd.floor, cmd.x); return null;
      case "removeUnit": this.live().removeUnit(cmd.id); return null;
      case "removeTransport": this.live().removeTransport(cmd.id); return null;
      case "resizeTransport": this.live().resizeTransport(cmd.id, cmd.bottom, cmd.top); return null;
      case "setCars": this.live().setCars(cmd.id, cmd.cars); return null;
      case "addCar": this.live().addCar(cmd.id); return null;
      case "removeCar": this.live().removeCar(cmd.id); return null;
      case "extendTransport": this.live().extendTransport(cmd.id, cmd.end, cmd.targetFloor, cmd.hwm ? JSON.stringify(cmd.hwm) : null); return null;
      case "removeFacility": this.live().removeFacility(cmd.id, cmd.method); return null;
      case "setSchedule": this.live().setSchedule(cmd.id, JSON.stringify(cmd.schedule ?? null)); return null;
      case "setStop": this.live().setStop(cmd.id, cmd.floor, cmd.stop); return null;
      case "setExpressStops": this.live().setExpressStops(cmd.id); return null;
      case "clearStops": this.live().clearStops(cmd.id); return null;
      case "adjustRent": this.live().adjustRent(cmd.id, cmd.dir); return null;
      case "setNoRate": this.live().setNoRate(cmd.id); return null;
      case "priceUnit": this.live().priceUnit(cmd.id, cmd.target); return null;
      case "applyRentBatch": this.live().applyRentBatch(cmd.kind, JSON.stringify(cmd.target), cmd.onlyDefaultPriced); return null;
      case "setFilmPolicy": this.live().setFilmPolicy(cmd.id, cmd.policy); return null;
      case "rerollSubtype": this.live().rerollSubtype(cmd.id); return null;
      case "toggleAutoBridge": this.live().toggleAutoBridge(); return null;
      case "setAutoBridge": this.live().setAutoBridge(cmd.value); return null;
      case "setLabel": this.live().setLabel(cmd.id, cmd.label); return null;
      case "setTowerName": this.live().setTowerName(cmd.name); return null;
      case "setView": this.live().setView(cmd.view == null ? null : JSON.stringify(cmd.view)); return null;
      case "setMoney": this.live().setMoney(cmd.amount); return null;
      case "emit": this.live().emit(cmd.text, cmd.kind); return null;
      case "startFire": this.live().startFire(); return null;
      case "bombThreat": this.live().bombThreat(); return null;
      case "evaluateStar": this.live().evaluateStar(); return null;
      case "callExterminator": this.live().callExterminator(); return null;
      case "resolveChoice": this.live().resolveChoice(cmd.accept); return null;
      case "checkpoint": return this.compare(cmd);
      default: {
        const never: never = cmd;
        throw new Error(`shadow: unknown command ${JSON.stringify(never)}`);
      }
    }
  }

  private compare(cmd: { label: string; state: string; crowd: string }): Divergence | null {
    const e = this.live();
    const state = e.stateView();
    if (state !== cmd.state) return { label: cmd.label, view: "state", ...whereTextsDiffer(cmd.state, state) };
    const crowd = e.crowdView();
    if (crowd !== cmd.crowd) return { label: cmd.label, view: "crowd", ...whereTextsDiffer(cmd.crowd, crowd) };
    return null;
  }

  free(): void {
    this.engine?.free();
    this.engine = null;
  }
}

/** Where two canonical JSON texts differ: the first path whose parsed values
 *  differ, or, when the parsed trees agree and only the text does (a number
 *  or string spelled differently by one writer), the first differing
 *  character with a short excerpt of each side. */
export function whereTextsDiffer(live: string, shadow: string): { path: string; live: unknown; shadow: unknown } {
  const d = firstDifference(JSON.parse(live), JSON.parse(shadow));
  if (d) return d;
  let i = 0;
  while (i < live.length && i < shadow.length && live[i] === shadow[i]) i++;
  const excerpt = (t: string) => t.slice(Math.max(0, i - 40), i + 40);
  return { path: `text@${i} (the values agree; the spelling differs)`, live: excerpt(live), shadow: excerpt(shadow) };
}

/** The first path at which two JSON values differ, walking objects in sorted
 *  key order and arrays in index order, with the two values found there;
 *  null when they are the same. */
export function firstDifference(live: unknown, shadow: unknown, path = "$"): { path: string; live: unknown; shadow: unknown } | null {
  if (live === shadow) return null;
  const kind = (v: unknown) => {
    if (Array.isArray(v)) return "array";
    return v === null ? "null" : typeof v;
  };
  if (kind(live) !== kind(shadow)) return { path, live, shadow };
  if (Array.isArray(live) && Array.isArray(shadow)) {
    const len = Math.max(live.length, shadow.length);
    for (let i = 0; i < len; i++) {
      if (i >= live.length || i >= shadow.length) return { path: `${path}[${i}]`, live: live[i], shadow: shadow[i] };
      const d = firstDifference(live[i], shadow[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (kind(live) === "object") {
    const a = live as Record<string, unknown>;
    const b = shadow as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const k of keys) {
      if (!(k in a) || !(k in b)) return { path: `${path}.${k}`, live: a[k], shadow: b[k] };
      const d = firstDifference(a[k], b[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return { path, live, shadow };
}
