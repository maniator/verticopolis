import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inflateSync } from "fflate";
import { fromBase64 } from "./saveCompression";
import { PACK_TIMEOUT_MS, PackerLostError, packSave, resetSavePackerForTests } from "./savePacker";
import type { PackReply, PackRequest } from "./savePackWorker";

/** A stand-in for the browser's Worker: records what the packer posts and
 *  lets a test answer, fail or kill it. */
class FakeWorker {
  static made: FakeWorker[] = [];
  onmessage: ((e: MessageEvent<PackReply>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  posted: { request: PackRequest; transfer: Transferable[] }[] = [];
  terminated = false;
  constructor(
    readonly url: URL,
    readonly opts: WorkerOptions,
  ) {
    FakeWorker.made.push(this);
  }
  postMessage(request: PackRequest, transfer: Transferable[]): void {
    this.posted.push({ request, transfer });
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(data: PackReply): void {
    this.onmessage?.({ data } as MessageEvent<PackReply>);
  }
}

const bytesOf = (text: string) => new TextEncoder().encode(text);
const unpacked = (packed: Uint8Array) => new TextDecoder().decode(inflateSync(packed));
const last = () => FakeWorker.made[FakeWorker.made.length - 1];

beforeEach(() => {
  FakeWorker.made = [];
  resetSavePackerForTests();
});

afterEach(() => {
  resetSavePackerForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("packSave without a worker", () => {
  it("packs on the page: the deflate bytes and their base64", async () => {
    vi.stubGlobal("Worker", undefined);
    const { packed, base64 } = await packSave(bytesOf('{"money":5}'));
    expect(unpacked(packed)).toBe('{"money":5}');
    expect(fromBase64(base64)).toEqual(packed);
  });
});

describe("packSave with a worker", () => {
  beforeEach(() => vi.stubGlobal("Worker", FakeWorker));

  it("starts one module worker, transfers the bytes' buffer and answers the worker's reply", async () => {
    const bytes = bytesOf('{"money":1}');
    const packing = packSave(bytes);
    expect(FakeWorker.made).toHaveLength(1);
    expect(last().url.pathname.endsWith("savePackWorker.ts")).toBe(true);
    expect(last().opts).toEqual({ type: "module" });
    const [{ request, transfer }] = last().posted;
    expect(request.bytes).toBe(bytes);
    expect(transfer).toEqual([bytes.buffer]);
    const packed = new Uint8Array([4, 5]);
    last().reply({ id: request.id, packed, base64: "BAU=" });
    await expect(packing).resolves.toEqual({ packed, base64: "BAU=" });
    // A second save reuses the same worker.
    void packSave(bytesOf("{}"));
    expect(FakeWorker.made).toHaveLength(1);
    expect(last().posted).toHaveLength(2);
  });

  it("copies bytes that share their buffer instead of moving someone else's memory", async () => {
    const whole = bytesOf('xx{"a":1}');
    void packSave(whole.subarray(2));
    expect(last().posted[0].transfer).toEqual([]);
  });

  it("matches each reply to its request", async () => {
    const a = packSave(bytesOf('{"a":1}'));
    const b = packSave(bytesOf('{"b":2}'));
    const [ra, rb] = last().posted.map((p) => p.request.id);
    last().reply({ id: rb, packed: new Uint8Array([2]), base64: "Ag==" });
    last().reply({ id: ra, packed: new Uint8Array([1]), base64: "AQ==" });
    await expect(a).resolves.toMatchObject({ base64: "AQ==" });
    await expect(b).resolves.toMatchObject({ base64: "Ag==" });
  });

  it("packs on the page when the worker sends the bytes back with an error, and asks it nothing more", async () => {
    const bytes = bytesOf('{"money":7}');
    const packing = packSave(bytes);
    const { request } = last().posted[0];
    last().reply({ id: request.id, error: "no CompressionStream here", bytes });
    const { packed } = await packing;
    expect(unpacked(packed)).toBe('{"money":7}');
    expect(last().terminated).toBe(true);
    const next = await packSave(bytesOf('{"money":8}'));
    expect(unpacked(next.packed)).toBe('{"money":8}');
    expect(last().posted).toHaveLength(1);
  });

  it("answers PackerLostError for the requests a dying worker held, and packs on the page after", async () => {
    const packing = packSave(bytesOf('{"money":1}'));
    last().onerror?.();
    await expect(packing).rejects.toBeInstanceOf(PackerLostError);
    expect(last().terminated).toBe(true);
    const next = await packSave(bytesOf('{"money":2}'));
    expect(unpacked(next.packed)).toBe('{"money":2}');
    expect(FakeWorker.made).toHaveLength(1);
  });

  it("gives up on a worker that never answers", async () => {
    vi.useFakeTimers();
    const packing = packSave(bytesOf('{"money":1}'));
    const lost = expect(packing).rejects.toBeInstanceOf(PackerLostError);
    vi.advanceTimersByTime(PACK_TIMEOUT_MS);
    await lost;
    expect(last().terminated).toBe(true);
  });

  it("packs on the page when the post itself throws, with the bytes still whole", async () => {
    FakeWorker.prototype.postMessage = function () {
      throw new DOMException("could not clone", "DataCloneError");
    };
    try {
      const { packed } = await packSave(bytesOf('{"money":3}'));
      expect(unpacked(packed)).toBe('{"money":3}');
      expect(last().terminated).toBe(true);
    } finally {
      FakeWorker.prototype.postMessage = function (this: FakeWorker, request: PackRequest, transfer: Transferable[]) {
        this.posted.push({ request, transfer });
      };
    }
  });

  it("starts no worker when the browser cannot compress, and packs on the page", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    const { packed } = await packSave(bytesOf('{"money":4}'));
    expect(unpacked(packed)).toBe('{"money":4}');
    expect(FakeWorker.made).toHaveLength(0);
  });
});
