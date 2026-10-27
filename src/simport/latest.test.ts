import { describe, expect, it } from "vitest";
import { latest, latestPer } from "./latest";

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
