import { existsSync, readSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The disc reader's WASM binding (`disc-rs/src/wasm.rs`, built by
 * `npm run disc:wasm:build` into `disc-rs/pkg/`) for Node: the parity suite
 * and the developer-only `tools/simtower/disc-check.ts` load it here.
 * Structured values cross as JSON text and refusals as errors whose message
 * is the refusal's JSON; this adapter parses both and nothing more.
 */

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PKG = resolve(REPO_ROOT, "disc-rs/pkg/verticopolis_disc.js");
const PKG_FILES = [PKG, resolve(REPO_ROOT, "disc-rs/pkg/verticopolis_disc_bg.wasm"), resolve(REPO_ROOT, "disc-rs/pkg/package.json")];

/** True once the binding has been built (glue, module and CommonJS marker). */
export const hasDiscWasm = (): boolean => PKG_FILES.every((f) => existsSync(f));

/** CI's switch: the binding must be present, a skip is a failure. */
export const discWasmRequired = (): boolean => process.env.VC_REQUIRE_DISC_WASM === "1";

/** The result shapes the crate declares (`disc-rs/src/disc.rs`), schema 1. */
export interface DiscEntry {
  token: number;
  path: string;
  size: number;
  stored: "plain" | "kwaj" | "unreadable";
  method?: number;
  expandedSize?: number;
}

export interface DiscOpened {
  schema: number;
  source: "iso";
  entries: DiscEntry[];
}

export interface DiscReadInfo {
  schema: number;
  token: number;
  size: number;
  sha256: string;
}

export interface DiscRefusal {
  schema: number;
  code: string;
  detail: string;
}

/** The one schema this adapter understands; anything else is refused. */
export const DISC_SCHEMA = 1;

interface RawDisc {
  opened(): string;
  read(token: number): { info(): string; takeBytes(): Uint8Array; free(): void };
  readStored(token: number): Uint8Array;
  free(): void;
}

interface RawModule {
  defaultLimits(): string;
  hardLimits(): string;
  Disc: {
    openBytes(bytes: Uint8Array, limits?: string): RawDisc;
    openSource(source: { read(offset: number, length: number): Uint8Array }, size: number, limits?: string): RawDisc;
  };
}

let loaded: RawModule | undefined;
function module(): RawModule {
  if (!loaded) loaded = createRequire(import.meta.url)(PKG) as RawModule;
  return loaded;
}

/** A thrown refusal, decoded; anything else (a trap, a bug) is rethrown. */
export class DiscRefused extends Error {
  constructor(readonly refusal: DiscRefusal) {
    super(`${refusal.code}: ${refusal.detail}`);
  }
}

function call<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      throw e;
    }
    const r = parsed as Partial<DiscRefusal>;
    if (typeof r.code === "string" && typeof r.detail === "string" && typeof r.schema === "number") {
      checkSchema(r.schema);
      throw new DiscRefused({ schema: r.schema, code: r.code, detail: r.detail });
    }
    throw e;
  }
}

function checkSchema(schema: number): void {
  if (schema !== DISC_SCHEMA) throw new Error(`disc reader schema ${schema} is not the ${DISC_SCHEMA} this host understands`);
}

export interface WasmDisc {
  opened(): DiscOpened;
  read(token: number): { info: DiscReadInfo; bytes: Uint8Array };
  readStored(token: number): Uint8Array;
  free(): void;
}

/** A token crosses as a u32, which the glue would wrap (`2 ** 32` reads as
 *  0); anything that is not a whole u32 is refused here instead. */
function checkToken(token: number): void {
  if (!Number.isInteger(token) || token < 0 || token > 0xffff_ffff) {
    throw new DiscRefused({ schema: DISC_SCHEMA, code: "bad-request", detail: `token must be a whole number from 0 to 4294967295, got ${token}` });
  }
}

function wrap(raw: RawDisc): WasmDisc {
  return {
    opened() {
      const o = JSON.parse(raw.opened()) as DiscOpened;
      checkSchema(o.schema);
      return o;
    },
    read(token) {
      checkToken(token);
      const r = call(() => raw.read(token));
      try {
        const info = JSON.parse(r.info()) as DiscReadInfo;
        checkSchema(info.schema);
        return { info, bytes: r.takeBytes() };
      } finally {
        r.free();
      }
    },
    readStored: (token) => {
      checkToken(token);
      return call(() => raw.readStored(token));
    },
    free: () => raw.free(),
  };
}

/** The limits the module enforces when a host passes none. */
export function defaultLimits(): Record<string, number> {
  return JSON.parse(module().defaultLimits()) as Record<string, number>;
}

/** The ceilings no host-supplied limit may exceed. */
export function hardLimits(): Record<string, number> {
  return JSON.parse(module().hardLimits()) as Record<string, number>;
}

/** The largest buffer `openDiscBytes` copies into 32-bit WASM memory; a
 *  larger image goes through `openDiscFd` (or a worker's `File` source),
 *  which reads on demand. */
const MAX_BYTES_IN_MEMORY = 2 ** 31 - 1;

/** Open an image already in memory. The size is checked here, before the
 *  bytes are copied into the module's memory, so an oversized buffer is a
 *  typed refusal instead of an allocation trap. Prefer `openDiscFd` (or a
 *  worker's `File` source) for a real disc. */
export function openDiscBytes(bytes: Uint8Array, limits?: Record<string, number>): WasmDisc {
  const asked = limits?.maxImageBytes ?? defaultLimits().maxImageBytes!;
  if (!Number.isInteger(asked) || asked < 0 || asked > hardLimits().maxImageBytes!) {
    throw new DiscRefused({ schema: DISC_SCHEMA, code: "bad-request", detail: `maxImageBytes must be a whole number up to the hard limit, got ${asked}` });
  }
  const max = Math.min(asked, MAX_BYTES_IN_MEMORY);
  if (bytes.length > max) {
    throw new DiscRefused({ schema: DISC_SCHEMA, code: "too-large", detail: `a ${bytes.length}-byte image is past the ${max}-byte limit for an in-memory open` });
  }
  return wrap(call(() => module().Disc.openBytes(bytes, limits && JSON.stringify(limits))));
}

/** Open an image from an open file descriptor, read on demand. */
export function openDiscFd(fd: number, size: number, limits?: Record<string, number>): WasmDisc {
  // The module trusts this callback to return a Uint8Array of exactly
  // `length` bytes; it refuses a short one, and the type is fixed here.
  const source = {
    read(offset: number, length: number): Uint8Array {
      const buf = new Uint8Array(length);
      let done = 0;
      while (done < length) {
        const n = readSync(fd, buf, done, length - done, offset + done);
        if (n === 0) break;
        done += n;
      }
      return done === length ? buf : buf.subarray(0, done);
    },
  };
  return wrap(call(() => module().Disc.openSource(source, size, limits && JSON.stringify(limits))));
}
