import type { WasmEngine } from "../../dualrun/binding";

/**
 * Engine traps for the runtime fallback's integration tests (#874). A trap is
 * injected at the binding boundary: the real method runs, so the engine's
 * state has changed, then the call throws a `WebAssembly.RuntimeError` as a
 * Rust panic does, and every later call on that engine throws wasm-bindgen's
 * borrow error, as a poisoned engine's do.
 */

export const POISONED = "recursive use of an object detected which would lead to unsafe aliasing in rust";

/** The engines a test poisoned, put back and freed for real by
 *  {@link freePoisoned} (the injected trap never reached the module). */
const poisoned: WasmEngine[] = [];

/** For `afterEach`: free every engine a test poisoned. */
export function freePoisoned(): void {
  for (const engine of poisoned.splice(0)) {
    for (const name of Object.getOwnPropertyNames(engine)) {
      if (typeof (engine as unknown as Record<string, unknown>)[name] === "function") delete (engine as unknown as Record<string, unknown>)[name];
    }
    engine.free();
  }
}

/** Make `method` run and then trap; `run: false` traps before it runs. */
export function trapAfter(engine: WasmEngine, method: keyof WasmEngine & string, run = true): void {
  const proto = Object.getPrototypeOf(engine) as Record<string, unknown>;
  const real = (engine[method] as (...args: unknown[]) => unknown).bind(engine);
  poisoned.push(engine);
  const poison = () => {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === "constructor" || typeof Object.getOwnPropertyDescriptor(proto, name)?.value !== "function") continue;
      Object.defineProperty(engine, name, {
        value: () => {
          throw new Error(POISONED);
        },
        configurable: true,
        writable: true,
      });
    }
  };
  Object.defineProperty(engine, method, {
    value: (...args: unknown[]) => {
      if (run) real(...args);
      poison();
      throw new WebAssembly.RuntimeError("unreachable");
    },
    configurable: true,
    writable: true,
  });
}
