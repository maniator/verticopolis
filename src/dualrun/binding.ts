import type { Engine } from "./engine";

/**
 * The WASM binding's surface, as wasm-bindgen declares it from
 * `engine-rs/src/wasm.rs`. `engine.d.ts` is the declaration the build writes
 * (`npm run wasm:build` refreshes it; CI fails when the checked-in copy is
 * stale), so a method added or renamed in Rust reaches TypeScript as a type
 * change and the lists below as a typecheck failure until they follow.
 */
export type WasmEngine = Engine;

export interface WasmModule {
  Engine: typeof Engine;
}

/** Every method the adapters call on an instance, and on the class. */
export const INSTANCE_METHODS = [
  "free", "mode", "money", "setMoney", "build", "buildTransport", "sellAt", "unitAt", "transportAt",
  "adjustRent", "setNoRate", "priceUnit", "setCars", "setSchedule", "setStop", "setExpressStops", "clearStops",
  "resizeTransport", "removeUnit", "removeTransport", "setLabel", "setTowerName", "setView", "setAutoBridge", "emit",
  "startFire", "fires", "bombThreat", "evaluateStar", "callExterminator", "autoBridge", "toggleAutoBridge", "setFilmPolicy",
  "rerollSubtype", "applyRentBatch", "pendingChoice", "resolveChoice", "tick", "serialize", "stateView", "crowdView",
  "stateDigest", "crowdDigest", "frameView", "logSince",
] as const satisfies readonly (keyof WasmEngine)[];
export const STATIC_METHODS = ["newGame", "fromSave", "fromVctower"] as const satisfies readonly (keyof typeof Engine)[];

// Every method of the declared class (the dispose symbol aside) and every
// static has to be in the lists above, or the binding gained one the check
// and the adapters do not know about.
type Unlisted = Exclude<keyof WasmEngine, (typeof INSTANCE_METHODS)[number] | symbol>;
const unlisted: Record<Unlisted, never> = {};
void unlisted;
type UnlistedStatic = Exclude<keyof typeof Engine, (typeof STATIC_METHODS)[number] | "prototype">;
const unlistedStatic: Record<UnlistedStatic, never> = {};
void unlistedStatic;

/** Check a loaded module against the surface above, naming what is missing,
 *  so a binding that renamed or dropped a method fails by name rather than
 *  as "not a function" deep inside a run. */
export function checkBinding(mod: unknown): WasmModule {
  const m = mod as { Engine?: unknown };
  if (typeof m.Engine !== "function") throw new Error("the WASM binding exports no Engine class; rebuild it");
  const proto = (m.Engine as { prototype: Record<string, unknown> }).prototype;
  const cls = m.Engine as unknown as Record<string, unknown>;
  const missing = [
    ...INSTANCE_METHODS.filter((name) => typeof proto[name] !== "function").map((name) => `Engine#${name}`),
    ...STATIC_METHODS.filter((name) => typeof cls[name] !== "function").map((name) => `Engine.${name}`),
  ];
  if (missing.length) throw new Error(`the WASM binding lacks ${missing.join(", ")}; rebuild it or update the adapter`);
  return mod as WasmModule;
}
