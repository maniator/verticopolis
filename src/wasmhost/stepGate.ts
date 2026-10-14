/**
 * The frame loop's hook into an engine host that does not sync after every
 * step: the coalesced main-thread host (`?engine=wasm-frame`) and the worker
 * host (`?engine=wasm-worker`). Both are experimental; the default WASM host
 * syncs after every step and registers no gate, so the frame loop behaves
 * exactly as before for it and for the TypeScript engine.
 *
 * `canStep` says whether the host takes steps this frame (the worker host
 * says no while its last batch is still in flight, so the frame loop banks
 * the owed minutes under its catch-up cap instead of queueing work without
 * bound). `flush` runs once per frame after the steps: the coalesced host
 * applies the engine's frame there, and the worker host posts the frame's
 * steps with one frame request. `settle` resolves once the read model has
 * caught up with every step and command sent so far, so an async save can
 * write the engine's exact state.
 */
export interface StepGate {
  canStep(): boolean;
  flush(): void;
  settle(): Promise<void>;
}

const gates = new WeakMap<object, StepGate>();

export function setStepGate(sim: object, gate: StepGate | null): void {
  if (gate) gates.set(sim, gate);
  else gates.delete(sim);
}

export function stepGate(sim: object): StepGate | undefined {
  return gates.get(sim);
}

/** The longest a save waits for a host to catch up; past it the save is
 *  the read model's (a hung worker must not hold an autosave forever). */
export const SETTLE_TIMEOUT_MS = 2000;

/** Wait for the host behind `sim`, if it has a gate, to catch up, for at
 *  most `timeoutMs`. A host without one (the TypeScript engine, the default
 *  WASM host) is always caught up, so this resolves at once. */
export async function settleEngine(sim: object, timeoutMs = SETTLE_TIMEOUT_MS): Promise<void> {
  const gate = gates.get(sim);
  if (!gate) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([gate.settle(), new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); })]);
  } finally {
    clearTimeout(timer);
  }
}
