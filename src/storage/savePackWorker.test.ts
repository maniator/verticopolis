import { describe, expect, it, vi } from "vitest";
import { inflateSync } from "fflate";
import { fromBase64 } from "./saveCompression";
import { answer } from "./savePackWorker";

describe("the save packer's worker", () => {
  it("answers the deflate bytes and their base64, the result's buffer transferred", async () => {
    const postMessage = vi.fn();
    const bytes = new TextEncoder().encode('{"money":9}');
    await answer({ postMessage }, { id: 3, bytes });
    expect(postMessage).toHaveBeenCalledTimes(1);
    const [reply, transfer] = postMessage.mock.calls[0] as [{ id: number; packed: Uint8Array; base64: string }, Transferable[]];
    expect(reply.id).toBe(3);
    expect(new TextDecoder().decode(inflateSync(reply.packed))).toBe('{"money":9}');
    expect(fromBase64(reply.base64)).toEqual(reply.packed);
    expect(transfer).toEqual([reply.packed.buffer]);
  });

  it("hands the bytes back with the error when it cannot compress", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    try {
      const postMessage = vi.fn();
      const bytes = new TextEncoder().encode("{}");
      await answer({ postMessage }, { id: 4, bytes });
      const [reply, transfer] = postMessage.mock.calls[0] as [{ id: number; error: string; bytes: Uint8Array }, Transferable[]];
      expect(reply.id).toBe(4);
      expect(reply.error).toMatch(/CompressionStream/);
      expect(reply.bytes).toBe(bytes);
      expect(transfer).toEqual([bytes.buffer]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
