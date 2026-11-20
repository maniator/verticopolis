import { deflateSync } from "fflate";
import { compressionEncodeSupported, deflate, toBase64 } from "./saveCompression";
import type { PackReply, PackRequest } from "./savePackWorker";

/**
 * Packing a save for the store (deflate, then base64 for the `VCZ1:` text),
 * in a worker when the browser has one, so an autosave's compression runs off
 * the main thread. The save's bytes are transferred to the worker, not copied,
 * and the deflate bytes come back the same way; the store keeps those bytes
 * as they are, so the main thread neither encodes nor checks base64 for a save.
 *
 * Without a worker (an old browser, a test), or once the worker fails (its
 * script did not load, it crashed), the page packs the save itself, as every
 * save was packed before. A failed request hands its bytes back; a worker that
 * dies takes its requests' bytes with it, and those answer
 * {@link PackerLostError} so the caller can make the save again.
 */

/** A save packed for the store: its deflate bytes, and their base64. */
export interface PackedSave {
  readonly packed: Uint8Array;
  readonly base64: string;
}

/** The worker died with this request's bytes: make the save again. */
export class PackerLostError extends Error {
  override name = "PackerLostError";
  constructor() {
    super("The save packer stopped before it answered.");
  }
}

type Waiter = {
  resolve: (packed: PackedSave) => void;
  reject: (err: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** How long a request waits for the worker before the page takes the save
 *  back: a worker that hangs must not hold every later autosave behind it. A
 *  large tower packs in well under a second on a slow phone. */
export const PACK_TIMEOUT_MS = 10_000;

/** The worker, null once it is known not to work, undefined until first asked. */
let worker: Worker | null | undefined;
const waiting = new Map<number, Waiter>();
let nextId = 1;

/** Stop using the worker: every request it still holds is lost. */
function retire(w: Worker): void {
  if (worker === w) worker = null;
  w.terminate();
  for (const waiter of waiting.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(new PackerLostError());
  }
  waiting.clear();
}

/** Send no more requests to the worker, and let it finish the ones it holds. */
function stopAsking(w: Worker): void {
  if (worker === w) worker = null;
  if (waiting.size === 0) w.terminate();
}

function packer(): Worker | null {
  if (worker !== undefined) return worker;
  worker = null;
  if (typeof Worker === "undefined" || !compressionEncodeSupported()) return null;
  try {
    const w = new Worker(new URL("./savePackWorker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<PackReply>) => {
      const waiter = waiting.get(e.data.id);
      if (!waiter) return;
      waiting.delete(e.data.id);
      clearTimeout(waiter.timer);
      if (worker !== w && waiting.size === 0) w.terminate();
      if ("error" in e.data) waiter.reject(e.data);
      else waiter.resolve({ packed: e.data.packed, base64: e.data.base64 });
    };
    w.onerror = () => retire(w);
    w.onmessageerror = () => retire(w);
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

/** Pack on this thread, as every save was packed before the worker. */
export async function packHere(bytes: Uint8Array): Promise<PackedSave> {
  const packed = compressionEncodeSupported() ? await deflate(bytes) : deflateSync(bytes, { level: 1 });
  return { packed, base64: toBase64(packed) };
}

/**
 * Pack `bytes`, in the worker when there is one. The bytes' buffer moves to
 * the worker when they own all of it (an engine save does), so the caller must
 * not use them after this call. Rejects only with {@link PackerLostError}.
 */
export async function packSave(bytes: Uint8Array): Promise<PackedSave> {
  const w = packer();
  if (!w) return packHere(bytes);
  const id = nextId++;
  const reply = new Promise<PackedSave>((resolve, reject) => {
    waiting.set(id, { resolve, reject, timer: setTimeout(() => retire(w), PACK_TIMEOUT_MS) });
  });
  const owned = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
  const request: PackRequest = { id, bytes };
  try {
    w.postMessage(request, owned ? [bytes.buffer] : []);
  } catch {
    // Nothing was sent, so the bytes are still here.
    clearTimeout(waiting.get(id)?.timer);
    waiting.delete(id);
    stopAsking(w);
    return packHere(bytes);
  }
  try {
    return await reply;
  } catch (err) {
    if (err instanceof PackerLostError) throw err;
    // The worker could not pack them and sent them back: pack here from now on.
    stopAsking(w);
    return packHere((err as { bytes: Uint8Array }).bytes);
  }
}

/** Forget the worker, for tests. */
export function resetSavePackerForTests(): void {
  if (worker) worker.terminate();
  worker = undefined;
  for (const waiter of waiting.values()) clearTimeout(waiter.timer);
  waiting.clear();
  nextId = 1;
}
