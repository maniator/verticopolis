/**
 * The byte check for the engine package (#985 criterion 5): fetch
 * `engine/BUILD.json`, the glue and the binary, hash what arrived, and refuse
 * unless it is exactly the package this shell was built with. It returns the
 * verified bytes, so the loader instantiates from what was hashed and never
 * fetches a file a second time. Design:
 * _bmad-output/planning-artifacts/design/design-engine-package-set-consistency-2026-10-15.md, section 5.3.
 *
 * `fetch`, the digest and the abort signal are injected, so the unit tests run
 * in Node with no browser. The loader (rustEngine.ts) owns the deadline and
 * hands its signal in; this module checks the signal after every await and
 * throws `EnginePackageAborted` once it fires, so a late result is dropped.
 */
import { ENGINE_GLUE, ENGINE_WASM } from "./enginePackageNames.ts";
import { canonicalFilesJson, parseEngineRecord, shortId, type EnginePackageRecord, type ExpectedEnginePackage } from "./enginePackageRecord.ts";

/** Why a package was refused. `mismatch` is the bytes disagreeing with the
 *  shell, `load-failed` is the bytes not arriving whole, `unverifiable` is a
 *  browser that cannot hash them. */
export type PackageFailureKind = "mismatch" | "load-failed" | "unverifiable";

/** Which of the three files the refusal is about. */
export type PackageFile = "glue" | "wasm" | "build-record";

/** What a failure screen and the diagnostics report. Ids are 12 hex digits. */
export interface PackageFailureDetail {
  file: PackageFile | null;
  /** The digest the shell expected for `file`, when the failure is a digest. */
  expected: string | null;
  /** The digest that arrived, when it was computed. */
  found: string | null;
  /** The package id this shell was built with. */
  expectedPackage: string | null;
  /** The package id `BUILD.json` named, when it named one. */
  servedPackage: string | null;
  /** Whether a service worker controlled the page. */
  controlled: boolean;
}

export class EnginePackageError extends Error {
  readonly kind: PackageFailureKind;
  readonly detail: PackageFailureDetail;
  constructor(kind: PackageFailureKind, message: string, detail: Partial<PackageFailureDetail> & { controlled: boolean }) {
    super(message);
    this.name = "EnginePackageError";
    this.kind = kind;
    this.detail = { file: null, expected: null, found: null, expectedPackage: null, servedPackage: null, ...detail };
  }
}

/** Thrown when the caller's signal fired. The loader already reported why
 *  (its deadline), so this is never shown to a player. */
export class EnginePackageAborted extends Error {
  constructor() {
    super("the engine package check was aborted");
    this.name = "EnginePackageAborted";
  }
}

/** A sibling fetch stopped because another file already failed. */
class SiblingStopped extends Error {}

/** The most `BUILD.json` may weigh. Its real size is about 400 bytes. */
export const RECORD_CAP_BYTES = 16 * 1024;

export interface PackageUrls {
  record: string;
  glue: string;
  wasm: string;
}

export interface VerifyOptions {
  /** What the shell was built with; null when the build carries no package. */
  expected: ExpectedEnginePackage | null;
  urls: PackageUrls;
  fetch: (url: string, init: { signal: AbortSignal }) => Promise<Response>;
  /** SHA-256 of the bytes, or undefined where `crypto.subtle` is missing. */
  digest: ((bytes: Uint8Array) => Promise<Uint8Array>) | undefined;
  signal: AbortSignal;
  /** Whether a service worker controls the page, for the diagnostics. */
  controlled: boolean;
  /** The page's origin, to catch a redirect to another one. */
  origin: string;
}

export interface VerifiedPackage {
  glue: Uint8Array;
  wasm: Uint8Array;
  record: EnginePackageRecord;
}

/** `navigator.serviceWorker` is undefined when service workers are off or the
 *  context is insecure, so the diagnostics read it with a guard. */
export function isControlled(nav: { serviceWorker?: { controller?: unknown } } | undefined): boolean {
  try {
    return nav?.serviceWorker?.controller != null;
  } catch {
    // Reading it can throw a SecurityError (blocked site data, a sandboxed
    // frame); the diagnostics must still be built.
    return false;
  }
}

/** The page's digest: `crypto.subtle`, or undefined in an insecure context. */
export function browserDigest(c: { subtle?: SubtleCrypto } | null | undefined = globalThis.crypto): VerifyOptions["digest"] {
  const subtle = c?.subtle;
  if (!subtle) return undefined;
  return async (bytes) => new Uint8Array(await subtle.digest("SHA-256", bytes as BufferSource));
}

function hex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

const NAMES: Record<PackageFile, string> = { "build-record": "BUILD.json", glue: ENGINE_GLUE, wasm: ENGINE_WASM };

/**
 * Reads a body through a stream, counting real bytes, and stops at `cap`. A
 * header that promises more than the cap is refused before reading; a header
 * that lies is caught by the count. An unavailable stream is a load failure:
 * there is no unbounded `arrayBuffer()` fallback.
 */
async function readBounded(file: PackageFile, res: Response, cap: number, ctl: AbortController, fail: (kind: PackageFailureKind, why: string) => EnginePackageError): Promise<Uint8Array> {
  // Content-Length counts the encoded bytes, while the stream yields decoded
  // ones, so it is only compared with a body that was not compressed. For a
  // compressed one the real count below is the only measure.
  const header = res.headers.get("content-length");
  const encoding = res.headers.get("content-encoding");
  const declared = header !== null && (encoding === null || encoding === "" || encoding.toLowerCase() === "identity") ? Number(header) : Number.NaN;
  if (Number.isFinite(declared) && declared > cap) {
    await res.body?.cancel().catch(() => undefined);
    throw fail("mismatch", `${NAMES[file]} is larger than the ${cap} bytes this build expects`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw fail("load-failed", `${NAMES[file]} came back with no readable body`);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (ctl.signal.aborted) throw new SiblingStopped();
      if (done) break;
      total += value.length;
      if (total > cap) {
        await reader.cancel().catch(() => undefined);
        throw fail("mismatch", `${NAMES[file]} is larger than the ${cap} bytes this build expects`);
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof EnginePackageError || e instanceof SiblingStopped) throw e;
    // A sibling's failure or the caller's deadline aborts this read too; that
    // is not this file's fault and must not outrank the real failure.
    if (ctl.signal.aborted) throw new SiblingStopped();
    throw fail("load-failed", `${NAMES[file]} stopped arriving: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (Number.isFinite(declared) && total < declared) {
    throw fail("load-failed", `${NAMES[file]} ended after ${total} of ${declared} bytes`);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * Fetches and checks the package. Resolves with the verified bytes, or throws
 * an `EnginePackageError` (a refusal) or `EnginePackageAborted` (the caller's
 * deadline).
 */
export async function verifyEnginePackage(opts: VerifyOptions): Promise<VerifiedPackage> {
  const { expected, signal } = opts;
  const base = { controlled: opts.controlled, expectedPackage: expected ? shortId(expected.package) : null };
  const fail = (kind: PackageFailureKind, why: string, more: Partial<PackageFailureDetail> = {}) => new EnginePackageError(kind, why, { ...base, ...more });
  const gone = () => {
    if (signal.aborted) throw new EnginePackageAborted();
  };
  gone();
  if (!expected) throw fail("load-failed", "this build carries no engine package; a corrected deployment is needed");
  if (!opts.digest) throw fail("unverifiable", "this browser connection cannot verify the engine files (no crypto.subtle); open the game over HTTPS");
  const digest = opts.digest;
  const sha = async (bytes: Uint8Array, file: PackageFile): Promise<string> => {
    try {
      return hex(await digest(bytes));
    } catch (e) {
      throw fail("unverifiable", `hashing ${NAMES[file]} failed: ${e instanceof Error ? e.message : String(e)}`, { file });
    }
  };

  // One controller for the three fetches: the caller's deadline stops them
  // all, and so does the first file to fail.
  const ctl = new AbortController();
  const stop = () => ctl.abort();
  signal.addEventListener("abort", stop, { once: true });
  const get = async (file: PackageFile, url: string, cap: number): Promise<Uint8Array> => {
    let res: Response;
    try {
      res = await opts.fetch(url, { signal: ctl.signal });
    } catch (e) {
      if (ctl.signal.aborted) throw new SiblingStopped();
      throw fail("load-failed", `${NAMES[file]} could not be fetched: ${e instanceof Error ? e.message : String(e)}`, { file });
    }
    if (ctl.signal.aborted) throw new SiblingStopped();
    const refuse = (why: string) => {
      void res.body?.cancel().catch(() => undefined);
      return fail("load-failed", `${NAMES[file]} ${why}`, { file });
    };
    if (res.status !== 200) throw refuse(`came back with HTTP ${res.status}`);
    if (res.redirected) {
      let origin: string | null = null;
      try {
        origin = new URL(res.url).origin;
      } catch {
        // An unparseable final URL cannot be shown to be ours.
      }
      if (origin !== opts.origin) throw refuse("was redirected to another origin");
    }
    if (/^text\/html/i.test(res.headers.get("content-type") ?? "")) throw refuse("came back as a web page");
    // The digest the shell expects for this file rides on any refusal, the
    // oversize one included (the record may not have been read yet).
    const entry = file === "build-record" ? null : expected.files[file === "glue" ? ENGINE_GLUE : ENGINE_WASM];
    return readBounded(file, res, cap, ctl, (kind, why) => fail(kind, why, { file, expected: entry ? shortId(entry.sha256) : null }));
  };
  const order: [PackageFile, string, number][] = [
    ["build-record", opts.urls.record, RECORD_CAP_BYTES],
    ["glue", opts.urls.glue, expected.files[ENGINE_GLUE].bytes],
    ["wasm", opts.urls.wasm, expected.files[ENGINE_WASM].bytes],
  ];
  let bodies: Uint8Array[];
  try {
    const settled = await Promise.allSettled(
      order.map(async ([file, url, cap]) => {
        try {
          return await get(file, url, cap);
        } catch (e) {
          stop();
          throw e;
        }
      }),
    );
    gone();
    // The first failure in a fixed order that is not a sibling's stop, so the
    // reason does not depend on which fetch lost the race.
    for (const s of settled) {
      if (s.status === "rejected" && !(s.reason instanceof SiblingStopped)) {
        // An oversize file is refused as it streams, possibly before the
        // record was read; when the record did arrive whole, the refusal
        // still names the package it served.
        const early = settled[0];
        if (s.reason instanceof EnginePackageError && s.reason.detail.servedPackage === null && early.status === "fulfilled") {
          const served = parseEngineRecord(new TextDecoder().decode(early.value));
          if (served.ok) s.reason.detail.servedPackage = shortId(served.record.package);
        }
        throw s.reason;
      }
    }
    if (settled.some((s) => s.status === "rejected")) throw new EnginePackageAborted();
    bodies = settled.map((s) => (s as PromiseFulfilledResult<Uint8Array>).value);
  } finally {
    signal.removeEventListener("abort", stop);
  }
  const [recordBytes, glue, wasm] = bodies;

  const parsed = parseEngineRecord(new TextDecoder().decode(recordBytes));
  if (!parsed.ok) throw fail("mismatch", `BUILD.json is not a usable record (${parsed.why})`, { file: "build-record" });
  const record = parsed.record;
  const served = { servedPackage: shortId(record.package) };
  // A complete body of the wrong size is a different build (a body that ends
  // early with nothing to say it was cut short reads the same way). The sizes
  // are compared before any hashing, with the served id attached.
  for (const [file, bytes] of [["glue", glue], ["wasm", wasm]] as const) {
    const want = expected.files[file === "glue" ? ENGINE_GLUE : ENGINE_WASM];
    if (bytes.length !== want.bytes) {
      throw fail("mismatch", `${NAMES[file]} is ${bytes.length} bytes; this build expects ${want.bytes}`, { file, expected: shortId(want.sha256), ...served });
    }
  }
  if (record.package !== expected.package) {
    throw fail("mismatch", `BUILD.json names package ${shortId(record.package)}; this build expects ${shortId(expected.package)}`, { file: "build-record", ...served });
  }
  // Keeping the package id while changing a file entry must not pass: the id
  // is recomputed from the served entries, never taken on trust.
  const recomputed = await sha(new TextEncoder().encode(canonicalFilesJson(record.files)), "build-record");
  gone();
  if (recomputed !== record.package) {
    throw fail("mismatch", `BUILD.json's package id does not match its own file entries`, { file: "build-record", expected: shortId(record.package), found: shortId(recomputed), ...served });
  }

  // The record's own entries need no separate comparison with the fetched
  // bytes: its package id equals the shell's, and that id was just recomputed
  // from its entries, so the entries are the shell's.
  for (const [file, bytes] of [["glue", glue], ["wasm", wasm]] as const) {
    const name = file === "glue" ? ENGINE_GLUE : ENGINE_WASM;
    const want = expected.files[name];
    const found = await sha(bytes, file);
    gone();
    if (found !== want.sha256) {
      throw fail("mismatch", `${name} is not the file this build expects (${shortId(found)}, not ${shortId(want.sha256)})`, { file, expected: shortId(want.sha256), found: shortId(found), ...served });
    }
  }
  return { glue, wasm, record };
}
