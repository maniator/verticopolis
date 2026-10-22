import { createHash, webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EnginePackageAborted, EnginePackageError, browserDigest, isControlled, verifyEnginePackage, RECORD_CAP_BYTES, type VerifyOptions } from "./enginePackageCheck";
import { ENGINE_GLUE, ENGINE_WASM } from "./enginePackageNames";
import { engineBuildRecord, expectedOf, type EnginePackageRecord } from "./enginePackageRecord";

const sha = (d: Uint8Array | string) => createHash("sha256").update(d).digest("hex");
const enc = (s: string) => new TextEncoder().encode(s);
const ORIGIN = "https://game.example";
const URLS = { record: `${ORIGIN}/engine/BUILD.json`, glue: `${ORIGIN}/engine/${ENGINE_GLUE}`, wasm: `${ORIGIN}/engine/${ENGINE_WASM}` };

const glue = enc("export default async function init() {}\nexport class Engine {}\n");
const wasm = new Uint8Array(4096).map((_, i) => (i * 7) & 255);
const record = engineBuildRecord(glue, wasm, "a".repeat(64), sha);
const expected = expectedOf(record);

/** Another build's bytes of the same lengths, so only the digests differ. */
function flipped(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes);
  out[out.length - 1] ^= 0xff;
  return out;
}

interface Served {
  body?: Uint8Array;
  chunks?: Uint8Array[];
  status?: number;
  headers?: Record<string, string>;
  /** Make the stream error after its chunks. */
  breakAfter?: boolean;
  /** Keep the stream open after its chunks, as a server still sending would. */
  endless?: boolean;
  /** Reject the fetch itself. */
  reject?: Error;
  redirected?: string;
  /** Resolve only when the request's signal fires. */
  hang?: boolean;
}

/** A fetch over canned responses. `seen` records each request's signal. */
function server(files: Record<string, Served>) {
  const seen: { url: string; signal: AbortSignal; cancelled: boolean }[] = [];
  const fetch: VerifyOptions["fetch"] = (url, init) => {
    const spec = files[url];
    const entry = { url, signal: init.signal, cancelled: false };
    seen.push(entry);
    if (!spec) return Promise.resolve(new Response("not found", { status: 404 }));
    if (spec.reject) return Promise.reject(spec.reject);
    if (spec.hang) {
      return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    }
    const chunks = spec.chunks ?? [spec.body ?? new Uint8Array()];
    let i = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        // A real fetch errors a body that is still arriving when its signal fires.
        if (spec.endless) init.signal.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
      },
      pull(c) {
        if (i < chunks.length) c.enqueue(chunks[i++]);
        else if (spec.breakAfter) c.error(new Error("connection reset"));
        else if (spec.endless) return new Promise<void>(() => undefined);
        else c.close();
        return undefined;
      },
      cancel() {
        entry.cancelled = true;
      },
    });
    const res = new Response(stream, { status: spec.status ?? 200, headers: spec.headers });
    if (spec.redirected) {
      Object.defineProperty(res, "redirected", { value: true });
      Object.defineProperty(res, "url", { value: spec.redirected });
    }
    return Promise.resolve(res);
  };
  return { fetch, seen };
}

const recordText = (r: unknown) => enc(JSON.stringify(r, null, 2));
const good = (): Record<string, Served> => ({
  [URLS.record]: { body: recordText(record) },
  [URLS.glue]: { body: glue },
  [URLS.wasm]: { body: wasm },
});

function run(files: Record<string, Served>, over: Partial<VerifyOptions> = {}) {
  const s = server(files);
  const ctl = new AbortController();
  const promise = verifyEnginePackage({
    expected,
    urls: URLS,
    fetch: s.fetch,
    digest: async (b) => new Uint8Array(createHash("sha256").update(b).digest()),
    signal: ctl.signal,
    controlled: true,
    origin: ORIGIN,
    ...over,
  });
  return { promise, seen: s.seen, ctl };
}

async function refusal(files: Record<string, Served>, over: Partial<VerifyOptions> = {}): Promise<EnginePackageError> {
  const e = await run(files, over).promise.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(EnginePackageError);
  return e as EnginePackageError;
}

describe("a matching package", () => {
  it("returns the bytes it hashed and the served record", async () => {
    const r = await run(good()).promise;
    expect(r.glue).toEqual(glue);
    expect(r.wasm).toEqual(wasm);
    expect(r.record.package).toBe(record.package);
  });

  it("passes when BUILD.json differs only in its sources hash", async () => {
    const files = good();
    files[URLS.record] = { body: recordText({ ...record, sources: "f".repeat(64) }) };
    await expect(run(files).promise).resolves.toBeTruthy();
  });

  it("reads a body that arrives in several chunks", async () => {
    const files = good();
    files[URLS.wasm] = { chunks: [wasm.slice(0, 1000), wasm.slice(1000, 3000), wasm.slice(3000)] };
    await expect(run(files).promise).resolves.toBeTruthy();
  });

  it("asks for each of the three files once", async () => {
    const { promise, seen } = run(good());
    await promise;
    expect(seen.map((s) => s.url).sort()).toEqual([URLS.glue, URLS.record, URLS.wasm].sort());
  });
});

describe("a package that cannot be checked", () => {
  it("refuses a build that carries no package as load-failed", async () => {
    const e = await refusal(good(), { expected: null });
    expect(e.kind).toBe("load-failed");
    expect(e.message).toContain("no engine package");
  });

  it("refuses a browser without crypto.subtle as unverifiable, before any fetch", async () => {
    const { promise, seen } = run(good(), { digest: undefined });
    const e = (await promise.catch((err: unknown) => err)) as EnginePackageError;
    expect(e.kind).toBe("unverifiable");
    expect(seen).toHaveLength(0);
  });

  it("refuses a digest that rejects as unverifiable", async () => {
    const e = await refusal(good(), { digest: () => Promise.reject(new Error("no")) });
    expect(e.kind).toBe("unverifiable");
  });

  it("refuses a digest that throws synchronously as unverifiable", async () => {
    const e = await refusal(good(), {
      digest: () => {
        throw new Error("boom");
      },
    });
    expect(e.kind).toBe("unverifiable");
  });
});

describe("files that do not arrive whole", () => {
  it("treats a network error as load-failed", async () => {
    const files = good();
    files[URLS.glue] = { reject: new TypeError("offline") };
    const e = await refusal(files);
    expect(e.kind).toBe("load-failed");
    expect(e.detail.file).toBe("glue");
  });

  it.each([404, 500, 503])("treats HTTP %i on BUILD.json as load-failed, not a mismatch", async (status) => {
    const files = good();
    files[URLS.record] = { status, body: enc("nope") };
    const e = await refusal(files);
    expect(e.kind).toBe("load-failed");
    expect(e.detail.file).toBe("build-record");
  });

  it("treats a missing glue (404 from the server) as load-failed", async () => {
    const files = good();
    delete files[URLS.glue];
    const e = await refusal(files);
    expect(e.kind).toBe("load-failed");
  });

  it("treats a redirect to another origin as load-failed", async () => {
    const files = good();
    files[URLS.wasm] = { body: wasm, redirected: "https://portal.example/login" };
    const e = await refusal(files);
    expect(e.kind).toBe("load-failed");
    expect(e.detail.file).toBe("wasm");
  });

  it("treats a redirect whose final URL cannot be read as load-failed", async () => {
    const files = good();
    files[URLS.glue] = { body: glue, redirected: "not a url" };
    const { promise, seen } = run(files);
    const e = (await promise.catch((err: unknown) => err)) as EnginePackageError;
    expect(e.kind).toBe("load-failed");
    expect(e.detail.file).toBe("glue");
    expect(seen.find((x) => x.url === URLS.glue)?.cancelled).toBe(true);
  });

  it("allows a redirect that stays on the origin", async () => {
    const files = good();
    files[URLS.wasm] = { body: wasm, redirected: `${ORIGIN}/elsewhere/engine.wasm` };
    await expect(run(files).promise).resolves.toBeTruthy();
  });

  it("treats a web page served as a file (a captive portal) as load-failed", async () => {
    const files = good();
    files[URLS.glue] = { body: enc("<html>sign in</html>"), headers: { "content-type": "text/html; charset=utf-8" } };
    const e = await refusal(files);
    expect(e.kind).toBe("load-failed");
    expect(e.detail.file).toBe("glue");
  });

  it("treats a stream that errors part way as load-failed", async () => {
    const files = good();
    files[URLS.wasm] = { chunks: [wasm.slice(0, 100)], breakAfter: true };
    const e = await refusal(files);
    expect(e.kind).toBe("load-failed");
    expect(e.detail.file).toBe("wasm");
  });

  it("treats a body that ends before its Content-Length as load-failed", async () => {
    const files = good();
    files[URLS.wasm] = { body: wasm.slice(0, 100), headers: { "content-length": String(wasm.length) } };
    const e = await refusal(files);
    expect(e.kind).toBe("load-failed");
  });

  it("treats a response with no body as load-failed", async () => {
    const files = good();
    const original = server(files).fetch;
    const e = await refusal(files, {
      fetch: (url, init) => (url === URLS.record ? Promise.resolve(new Response(null, { status: 200 })) : original(url, init)),
    });
    expect(e.kind).toBe("load-failed");
  });
});

describe("files from another build", () => {
  it("refuses a glue of the right size but other bytes as a mismatch naming the glue", async () => {
    const files = good();
    files[URLS.glue] = { body: flipped(glue) };
    const e = await refusal(files);
    expect(e.kind).toBe("mismatch");
    expect(e.detail.file).toBe("glue");
    expect(e.detail.expected).toBe(sha(glue).slice(0, 12));
    expect(e.detail.found).toBe(sha(flipped(glue)).slice(0, 12));
    expect(e.detail.expectedPackage).toBe(record.package.slice(0, 12));
    expect(e.detail.controlled).toBe(true);
  });

  it("refuses a binary of the right size but other bytes", async () => {
    const files = good();
    files[URLS.wasm] = { body: flipped(wasm) };
    const e = await refusal(files);
    expect(e.kind).toBe("mismatch");
    expect(e.detail.file).toBe("wasm");
  });

  it("refuses the R3 shape: a glue from one build and a binary from another", async () => {
    const other = engineBuildRecord(enc("export default async function init() { /* B */ }\n"), flipped(wasm), "c".repeat(64), sha);
    const files = good();
    files[URLS.glue] = { body: enc("export default async function init() { /* B */ }\n".padEnd(glue.length, " ")) };
    files[URLS.wasm] = { body: flipped(wasm) };
    files[URLS.record] = { body: recordText(other) };
    const e = await refusal(files);
    expect(e.kind).toBe("mismatch");
  });

  it("refuses a complete body of another size without hashing it", async () => {
    const files = good();
    files[URLS.glue] = { body: glue.slice(0, glue.length - 5) };
    const e = await refusal(files);
    expect(e.kind).toBe("mismatch");
    expect(e.detail.file).toBe("glue");
    expect(e.message).toContain("bytes");
    expect(e.detail.found).toBeNull();
  });

  it("names the served package on a body of the wrong size, so the screen can show both ids", async () => {
    const other = engineBuildRecord(glue.slice(0, glue.length - 5), wasm, "a".repeat(64), sha);
    const files = good();
    files[URLS.record] = { body: recordText(other) };
    files[URLS.glue] = { body: glue.slice(0, glue.length - 5) };
    const e = await refusal(files);
    expect(e.kind).toBe("mismatch");
    expect(e.detail.servedPackage).toBe(other.package.slice(0, 12));
    expect(e.detail.expectedPackage).toBe(record.package.slice(0, 12));
  });

  it("does not compare Content-Length with a compressed body", async () => {
    const files = good();
    files[URLS.wasm] = { body: wasm, headers: { "content-encoding": "gzip", "content-length": "17" } };
    await expect(run(files).promise).resolves.toBeTruthy();
  });

  it("compares Content-Length with an uncompressed body", async () => {
    const files = good();
    files[URLS.wasm] = { body: wasm.slice(0, 100), headers: { "content-encoding": "identity", "content-length": String(wasm.length) } };
    const e = await refusal(files);
    expect(e.kind).toBe("load-failed");
  });

  it("refuses a body longer than expected, cancelling the stream", async () => {
    const files = good();
    const long = new Uint8Array(wasm.length + 100);
    files[URLS.wasm] = { chunks: [long.slice(0, 3000), long.slice(3000)], endless: true };
    const { promise, seen } = run(files);
    const e = (await promise.catch((err: unknown) => err)) as EnginePackageError;
    expect(e.kind).toBe("mismatch");
    expect(e.detail.file).toBe("wasm");
    expect(e.message).toContain("larger than");
    // The digest the shell expects rides on the refusal, though the record was not read.
    expect(e.detail.expected).toBe(record.files[ENGINE_WASM].sha256.slice(0, 12));
    // The record arrived whole before the stream was cut, so its id is named.
    expect(e.detail.servedPackage).toBe(record.package.slice(0, 12));
    expect(seen.find((s) => s.url === URLS.wasm)?.cancelled).toBe(true);
  });

  it("refuses a Content-Length over the cap before reading, even when the header lies about the rest", async () => {
    const files = good();
    files[URLS.glue] = { body: glue, headers: { "content-length": String(glue.length + 1) } };
    const e = await refusal(files);
    expect(e.kind).toBe("mismatch");
  });

  it("counts real bytes when the Content-Length header is absent", async () => {
    const files = good();
    files[URLS.glue] = { body: new Uint8Array(glue.length + 10) };
    const e = await refusal(files);
    expect(e.kind).toBe("mismatch");
  });

  it("refuses a BUILD.json over its cap", async () => {
    const files = good();
    files[URLS.record] = { body: new Uint8Array(RECORD_CAP_BYTES + 1).fill(32) };
    const e = await refusal(files);
    expect(e.kind).toBe("mismatch");
    expect(e.detail.file).toBe("build-record");
  });
});

describe("a BUILD.json that does not fit", () => {
  const record200 = (body: Uint8Array | string): Record<string, Served> => ({ ...good(), [URLS.record]: { body: typeof body === "string" ? enc(body) : body } });

  it.each([
    ["empty", ""],
    ["not JSON", "<html>"],
    ["schema 1", JSON.stringify({ sources: "a".repeat(64) })],
    ["missing a file", JSON.stringify({ ...record, files: { [ENGINE_GLUE]: record.files[ENGINE_GLUE] } })],
  ])("refuses %s as a mismatch with no served id", async (_name, text) => {
    const e = await refusal(record200(text));
    expect(e.kind).toBe("mismatch");
    expect(e.detail.file).toBe("build-record");
    expect(e.detail.servedPackage).toBeNull();
  });

  it("refuses another build's record and reports both ids", async () => {
    const other = engineBuildRecord(glue, flipped(wasm), "a".repeat(64), sha);
    const e = await refusal(record200(recordText(other)));
    expect(e.kind).toBe("mismatch");
    expect(e.detail.servedPackage).toBe(other.package.slice(0, 12));
    expect(e.detail.expectedPackage).toBe(record.package.slice(0, 12));
  });

  it("refuses a record that keeps this build's package id but changes a file entry", async () => {
    const forged: EnginePackageRecord = { ...record, files: { ...record.files, [ENGINE_WASM]: { sha256: sha("another binary"), bytes: wasm.length } } };
    expect(forged.package).toBe(record.package);
    const e = await refusal(record200(recordText(forged)));
    expect(e.kind).toBe("mismatch");
    expect(e.detail.file).toBe("build-record");
    expect(e.message).toContain("own file entries");
  });
});

describe("the caller's deadline and the siblings", () => {
  it("throws EnginePackageAborted when the signal fired before the start, with no fetch", async () => {
    const s = server(good());
    const ctl = new AbortController();
    ctl.abort();
    const err = await verifyEnginePackage({ expected, urls: URLS, fetch: s.fetch, digest: browserDigest(webcrypto as unknown as Crypto), signal: ctl.signal, controlled: false, origin: ORIGIN }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EnginePackageAborted);
    expect(s.seen).toHaveLength(0);
  });

  it("throws EnginePackageAborted and stops every fetch when the signal fires mid-flight", async () => {
    const files = good();
    files[URLS.wasm] = { hang: true };
    const { promise, seen, ctl } = run(files);
    await new Promise((r) => setTimeout(r, 10));
    ctl.abort();
    await expect(promise).rejects.toBeInstanceOf(EnginePackageAborted);
    expect(seen.every((s) => s.signal.aborted)).toBe(true);
  });

  it("treats a read that the deadline cut short as the caller's abort, not a load failure", async () => {
    const files = good();
    files[URLS.wasm] = { chunks: [wasm.slice(0, 100)], endless: true };
    const { promise, ctl } = run(files);
    await new Promise((r) => setTimeout(r, 10));
    ctl.abort();
    await expect(promise).rejects.toBeInstanceOf(EnginePackageAborted);
  });

  it("stops the other fetches when one file fails, and reports that file", async () => {
    const files = good();
    files[URLS.record] = { status: 503, body: enc("down") };
    files[URLS.wasm] = { hang: true };
    const { promise, seen } = run(files);
    const e = (await promise.catch((err: unknown) => err)) as EnginePackageError;
    expect(e.kind).toBe("load-failed");
    expect(e.detail.file).toBe("build-record");
    expect(seen.find((s) => s.url === URLS.wasm)?.signal.aborted).toBe(true);
  });

  it("reports the first failure in a fixed order, not whichever fetch lost the race", async () => {
    const files = good();
    files[URLS.record] = { status: 404, body: enc("x") };
    files[URLS.glue] = { body: flipped(glue) };
    const e = await refusal(files);
    expect(e.detail.file).toBe("build-record");
    expect(e.kind).toBe("load-failed");
  });
});

describe("diagnostics helpers", () => {
  it("isControlled does not throw when navigator.serviceWorker is undefined", () => {
    expect(isControlled(undefined)).toBe(false);
    expect(isControlled({})).toBe(false);
    expect(isControlled({ serviceWorker: {} })).toBe(false);
    expect(isControlled({ serviceWorker: { controller: null } })).toBe(false);
    expect(isControlled({ serviceWorker: { controller: {} } })).toBe(true);
  });

  it("browserDigest is undefined without crypto.subtle and hashes with it", async () => {
    expect(browserDigest({})).toBeUndefined();
    expect(browserDigest(null)).toBeUndefined();
    const digest = browserDigest(webcrypto as unknown as Crypto)!;
    expect(Buffer.from(await digest(enc("abc"))).toString("hex")).toBe(sha("abc"));
  });
});
