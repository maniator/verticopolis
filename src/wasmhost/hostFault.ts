/**
 * Telling an engine trap apart from a clean refusal (#1113), and running a
 * teardown's steps through one: what the shipped host keeps of the runtime
 * fallback's state (#874). The restore points, the fault latch and the live
 * state carried to a re-adopted tower served the TypeScript engine's fallback
 * and left with it (#921).
 */

/** wasm-bindgen's error for a call on an object a trap left borrowed. */
const POISONED = "recursive use of an object detected";

/**
 * Whether a throw from the engine is a trap, after which the module may be
 * corrupt and must not be called again (#1113): a `WebAssembly.RuntimeError`
 * (a Rust panic or abort), wasm-bindgen's borrow error that every later call
 * on a trapped object throws, or a stack overflow, which unwinds through the
 * module and leaves its stack pointer where it stopped. A stack overflow in
 * the host's own TypeScript looks the same and latches too: it cannot be told
 * apart, and latching is the safe side. A wrapper that keeps the throw as its
 * `cause` (the catalog read) is classed by it, and another realm's errors by
 * their name. Anything else is a clean answer: the engine's own `Result::Err`
 * (a plain `Error`) or a check in the host's TypeScript. Narrow on purpose:
 * one the test misses is only left a refusal, as before.
 */
export function isEngineTrap(error: unknown): boolean {
  return trapIn(error) !== null;
}

/**
 * What kind of trap it was, as a code from a closed list, so a reliability row
 * can say it without carrying the message (an engine message can quote a tower
 * name). `unreachable` is a Rust panic or abort, which is also how a failed
 * allocation ends: in a browser the two look the same. `out-of-bounds` is a
 * memory access outside the module's memory, `stack-overflow` a stack that ran
 * out, `poisoned` a call on an object an earlier trap left borrowed, and
 * `other` any other trap. `none` is not a trap.
 */
export const TRAP_KINDS = ["none", "unreachable", "out-of-bounds", "stack-overflow", "poisoned", "other"] as const;
export type TrapKind = (typeof TRAP_KINDS)[number];

/** The kind of the trap in `error` (see {@link TRAP_KINDS}). */
export function trapKind(error: unknown): TrapKind {
  const trap = trapIn(error);
  if (trap === null) return "none";
  const message = String((trap as { message?: unknown }).message ?? "");
  if (message.includes(POISONED)) return "poisoned";
  if (/call stack size|too much recursion|stack overflow/i.test(message)) return "stack-overflow";
  if (/out of bounds/i.test(message)) return "out-of-bounds";
  if (/unreachable/i.test(message)) return "unreachable";
  return "other";
}

/** The trap itself, `error` or one of its causes, or null for none. */
function trapIn(error: unknown): unknown {
  for (let e = error, depth = 0; typeof e === "object" && e !== null && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    if (typeof WebAssembly !== "undefined" && e instanceof WebAssembly.RuntimeError) return e;
    const { name, message } = e as { name?: unknown; message?: unknown };
    if (name === "RuntimeError") return e;
    if (typeof message !== "string") continue;
    if (message.includes(POISONED)) return e;
    if ((name === "RangeError" && /maximum call stack size exceeded/i.test(message)) || (name === "InternalError" && /too much recursion/i.test(message))) return e;
  }
  return null;
}

/** Run every step, even after one throws, then throw: a teardown that must
 *  let the instance go and free the engine whatever an earlier step did.
 *  A lone error is thrown as it is. Several are thrown as one new error that
 *  names them all, the first trap's first (or else the first error's), with
 *  the trap itself as its cause, so the caller latches on it (#1113). */
export function runEach(...steps: (() => void)[]): void {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 0) return;
  if (errors.length === 1) throw errors[0];
  const first = errors.find((e) => trapIn(e) !== null) ?? errors[0];
  const text = (x: unknown) => (x instanceof Error ? x.message : String(x));
  throw Object.assign(new Error([first, ...errors.filter((e) => e !== first)].map(text).join(", and ")), { cause: trapIn(first) ?? first });
}
