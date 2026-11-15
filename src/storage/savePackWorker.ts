import { deflate, toBase64 } from "./saveCompression";

/**
 * The save packer's worker (`savePacker.ts`): deflates a save's bytes and
 * writes their base64, off the main thread, so an autosave of a large tower
 * does not freeze a frame for the compression. A failure sends the bytes back
 * with the error, so the page can pack them itself.
 */

/** What the page sends: a save's UTF-8 bytes, their buffer transferred. */
export interface PackRequest {
  readonly id: number;
  readonly bytes: Uint8Array;
}

/** What the worker answers: the deflate bytes and their base64, or the error
 *  with the request's bytes handed back. */
export type PackReply =
  | { readonly id: number; readonly packed: Uint8Array; readonly base64: string }
  | { readonly id: number; readonly error: string; readonly bytes: Uint8Array };

/** The worker's side of the channel, as much of it as the packer uses. */
interface Scope {
  onmessage: ((e: MessageEvent<PackRequest>) => void) | null;
  postMessage(reply: PackReply, transfer: Transferable[]): void;
}

/** Pack one request and answer it, the result's buffer transferred. */
export async function answer(scope: Pick<Scope, "postMessage">, { id, bytes }: PackRequest): Promise<void> {
  let packed: Uint8Array;
  try {
    packed = await deflate(bytes);
  } catch (err) {
    scope.postMessage({ id, error: String(err), bytes }, [bytes.buffer]);
    return;
  }
  scope.postMessage({ id, packed, base64: toBase64(packed) }, [packed.buffer]);
}

const scope = self as unknown as Scope;
scope.onmessage = (e) => void answer(scope, e.data);
