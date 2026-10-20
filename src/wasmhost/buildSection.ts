/**
 * The engine's build metadata (#963): which Rust sources a binary was built
 * from, supplied by the packaging and never by the engine. The core engine
 * reads none of it and requires none of it (a hash of the sources cannot be
 * compiled into them without a build script, which `engine-rs/tests/
 * independence.rs` bans). The record is
 *
 *     { "schema": 1, "sourceHash": "<64 lowercase hex digits>" }
 *
 * and a web build writes it, as UTF-8 JSON, into a WebAssembly custom section
 * named `verticopolis.build` (`scripts/wasm-build.ts`, after wasm-bindgen and
 * before any file digest is taken). A native Rust or Godot host supplies the
 * same object by its own means (see engine-rs/API.md, "Build metadata").
 *
 * `sourceHash` is `engineSourceHash` (packageHash.ts): a hash of sources. It is
 * not the SHA-256 of the binary, which is a separate fact (the package id in
 * `BUILD.json`). The section never holds a digest of the file it sits in, so
 * stamping it creates no circular dependency.
 *
 * Keep this file ERASABLE (type-only TypeScript syntax; the rule is spelled
 * out in scripts/screenshot-env.ts): the build script imports it under plain
 * `node`. It has no imports.
 */

/** The custom section's name. */
export const BUILD_SECTION = "verticopolis.build";

/** What the host learns about a binary's build metadata. */
export type BuildMetadataResult =
  | { state: "ok"; sourceHash: string }
  | { state: "missing" }
  | { state: "malformed"; why: string };

const HEX64 = /^[0-9a-f]{64}$/;

/** The section's payload for a source hash. */
export function encodeBuildMetadata(sourceHash: string): Uint8Array {
  if (!HEX64.test(sourceHash))
    throw new Error("the source hash is not 64 lowercase hex digits");
  return new TextEncoder().encode(JSON.stringify({ schema: 1, sourceHash }));
}

/**
 * Read the metadata from the payloads of every custom section with the
 * section's name (`WebAssembly.Module.customSections` in a page, or
 * {@link customSectionsOf} on bytes). No section is `missing`; more than one,
 * text that is not JSON, another schema or a bad hash is `malformed`, with a
 * reason. Unknown keys are ignored so a later field does not strand an older
 * shell.
 */
export function parseBuildMetadata(
  payloads: ArrayLike<ArrayBuffer | Uint8Array>,
): BuildMetadataResult {
  if (payloads.length === 0) return { state: "missing" };
  if (payloads.length > 1)
    return {
      state: "malformed",
      why: `${payloads.length} ${BUILD_SECTION} sections`,
    };
  let v: unknown;
  try {
    v = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(payloads[0]),
    );
  } catch {
    return { state: "malformed", why: "not JSON" };
  }
  if (typeof v !== "object" || v === null || Array.isArray(v))
    return { state: "malformed", why: "not an object" };
  const r = v as { schema?: unknown; sourceHash?: unknown };
  if (r.schema !== 1) return { state: "malformed", why: "not schema 1" };
  if (typeof r.sourceHash !== "string" || !HEX64.test(r.sourceHash))
    return { state: "malformed", why: "bad source hash" };
  return { state: "ok", sourceHash: r.sourceHash };
}

function leb(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n !== 0) b |= 0x80;
    out.push(b);
  } while (n !== 0);
  return out;
}

/** The module's header: `\0asm` and version 1. */
const HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

function checkHeader(wasm: Uint8Array): void {
  if (wasm.length < HEADER.length || HEADER.some((b, i) => wasm[i] !== b))
    throw new Error("not a WebAssembly binary");
}

function readLeb(
  wasm: Uint8Array,
  at: number,
): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  for (let i = at; i < wasm.length && shift < 35; i++, shift += 7) {
    value += (wasm[i] & 0x7f) * 2 ** shift;
    if ((wasm[i] & 0x80) === 0) return { value, next: i + 1 };
  }
  throw new Error("malformed WebAssembly binary (section length)");
}

/** The payload of every custom section called `name`, in file order. */
export function customSectionsOf(wasm: Uint8Array, name: string): Uint8Array[] {
  checkHeader(wasm);
  const want = new TextEncoder().encode(name);
  const found: Uint8Array[] = [];
  let at = HEADER.length;
  while (at < wasm.length) {
    const id = wasm[at];
    const size = readLeb(wasm, at + 1);
    const end = size.next + size.value;
    if (end > wasm.length)
      throw new Error("malformed WebAssembly binary (section past the end)");
    if (id === 0) {
      const len = readLeb(wasm, size.next);
      const nameEnd = len.next + len.value;
      if (nameEnd > end)
        throw new Error("malformed WebAssembly binary (custom section name)");
      const sectionName = wasm.subarray(len.next, nameEnd);
      if (
        sectionName.length === want.length &&
        want.every((b, i) => sectionName[i] === b)
      )
        found.push(wasm.subarray(nameEnd, end));
    }
    at = end;
  }
  return found;
}

/**
 * The binary with the build metadata section appended. A custom section may
 * sit anywhere in a module, so appending leaves every other byte as it was.
 * Refuses a binary that already has one: stamping twice is a build bug.
 */
export function stampBuildSection(
  wasm: Uint8Array,
  sourceHash: string,
): Uint8Array {
  if (customSectionsOf(wasm, BUILD_SECTION).length > 0)
    throw new Error(`the binary already has a ${BUILD_SECTION} section`);
  const name = new TextEncoder().encode(BUILD_SECTION);
  const payload = encodeBuildMetadata(sourceHash);
  const body = [...leb(name.length), ...name];
  const size = leb(body.length + payload.length);
  const out = new Uint8Array(
    wasm.length + 1 + size.length + body.length + payload.length,
  );
  out.set(wasm, 0);
  let at = wasm.length;
  out[at++] = 0;
  out.set(size, at);
  at += size.length;
  out.set(body, at);
  at += body.length;
  out.set(payload, at);
  return out;
}
