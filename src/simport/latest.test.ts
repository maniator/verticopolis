import { describe, expect, it } from "vitest";
import { inOrder, inOrderPer, latest, latestPer } from "./latest";

/** A promise the test settles by hand, to land answers out of order. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("latest", () => {
  it("renders an answer that lands in order", async () => {
    const ask = latest<number>();
    const painted: number[] = [];
    await ask(Promise.resolve(1), (v) => painted.push(v));
    await ask(Promise.resolve(2), (v) => painted.push(v));
    expect(painted).toEqual([1, 2]);
  });

  it("drops an older answer that lands after a newer question", async () => {
    const ask = latest<string>();
    const painted: string[] = [];
    const older = deferred<string>();
    const newer = deferred<string>();
    const first = ask(older.promise, (v) => painted.push(v));
    const second = ask(newer.promise, (v) => painted.push(v));
    newer.resolve("newer");
    await second;
    older.resolve("older");
    await first;
    expect(painted).toEqual(["newer"]);
  });

  it("drops an older answer that lands first, once a newer question is out", async () => {
    const ask = latest<string>();
    const painted: string[] = [];
    const older = deferred<string>();
    const newer = deferred<string>();
    const first = ask(older.promise, (v) => painted.push(v));
    const second = ask(newer.promise, (v) => painted.push(v));
    older.resolve("older");
    await first;
    expect(painted).toEqual([]);
    newer.resolve("newer");
    await second;
    expect(painted).toEqual(["newer"]);
  });

  it("settles a replaced question quietly when it fails, and still paints the newer answer", async () => {
    const ask = latest<string>();
    const painted: string[] = [];
    const older = deferred<string>();
    const newer = deferred<string>();
    const first = ask(older.promise, (v) => painted.push(v));
    const second = ask(newer.promise, (v) => painted.push(v));
    older.reject(new Error("engine down"));
    await expect(first).resolves.toBeUndefined();
    newer.resolve("newer");
    await second;
    expect(painted).toEqual(["newer"]);
  });

  it("hands the query's rejection to the caller and renders nothing", async () => {
    const ask = latest<number>();
    const painted: number[] = [];
    await expect(ask(Promise.reject(new Error("engine down")), (v) => painted.push(v))).rejects.toThrow("engine down");
    expect(painted).toEqual([]);
  });

  it("keeps one newest question per owner", async () => {
    const asks = latestPer<string>();
    const a = {};
    const b = {};
    expect(asks(a)).toBe(asks(a));
    expect(asks(a)).not.toBe(asks(b));
    const painted: string[] = [];
    const slowA = deferred<string>();
    const first = asks(a)(slowA.promise, (v) => painted.push(v));
    // Another owner's question does not overtake a's.
    await asks(b)(Promise.resolve("b"), (v) => painted.push(v));
    slowA.resolve("a");
    await first;
    expect(painted).toEqual(["b", "a"]);
  });
});

describe("inOrder", () => {
  it("renders every answer that lands in order, even with several questions out", async () => {
    const ask = inOrder<number>();
    const painted: number[] = [];
    const out = [deferred<number>(), deferred<number>(), deferred<number>()];
    const asked = out.map((d) => ask(d.promise, (v) => painted.push(v)));
    out.forEach((d, i) => d.resolve(i + 1));
    await Promise.all(asked);
    expect(painted).toEqual([1, 2, 3]);
  });

  it("renders an older answer that lands first, then the newer one", async () => {
    const ask = inOrder<string>();
    const painted: string[] = [];
    const older = deferred<string>();
    const newer = deferred<string>();
    const first = ask(older.promise, (v) => painted.push(v));
    const second = ask(newer.promise, (v) => painted.push(v));
    older.resolve("older");
    await first;
    expect(painted).toEqual(["older"]);
    newer.resolve("newer");
    await second;
    expect(painted).toEqual(["older", "newer"]);
  });

  it("drops an older answer, or its failure, that lands after a newer one settled", async () => {
    const ask = inOrder<string>();
    const painted: string[] = [];
    const oldest = deferred<string>();
    const older = deferred<string>();
    const newer = deferred<string>();
    const first = ask(oldest.promise, (v) => painted.push(v));
    const second = ask(older.promise, (v) => painted.push(v));
    const third = ask(newer.promise, (v) => painted.push(v));
    newer.resolve("newer");
    await third;
    oldest.resolve("oldest");
    older.reject(new Error("engine down"));
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    expect(painted).toEqual(["newer"]);
  });

  it("hands a failure that lands in order to the caller, and still renders the next answer", async () => {
    const ask = inOrder<string>();
    const painted: string[] = [];
    const older = deferred<string>();
    const newer = deferred<string>();
    const first = ask(older.promise, (v) => painted.push(v));
    const second = ask(newer.promise, (v) => painted.push(v));
    older.reject(new Error("engine down"));
    await expect(first).rejects.toThrow("engine down");
    newer.resolve("newer");
    await second;
    expect(painted).toEqual(["newer"]);
  });

  it("counts a draw that throws as settled, so an older answer landing after it is dropped", async () => {
    const ask = inOrder<string>();
    const painted: string[] = [];
    const older = deferred<string>();
    const newer = deferred<string>();
    const first = ask(older.promise, (v) => painted.push(v));
    const second = ask(newer.promise, () => {
      throw new Error("draw failed");
    });
    newer.resolve("newer");
    await expect(second).rejects.toThrow("draw failed");
    older.resolve("older");
    await expect(first).resolves.toBeUndefined();
    expect(painted).toEqual([]);
  });

  it("keeps one order per owner", async () => {
    const asks = inOrderPer<string>();
    const a = {};
    const b = {};
    expect(asks(a)).toBe(asks(a));
    expect(asks(a)).not.toBe(asks(b));
    const painted: string[] = [];
    const slowA = deferred<string>();
    const first = asks(a)(slowA.promise, (v) => painted.push(v));
    // Another owner's answer does not make a's late.
    await asks(b)(Promise.resolve("b"), (v) => painted.push(v));
    slowA.resolve("a");
    await first;
    expect(painted).toEqual(["b", "a"]);
  });
});
