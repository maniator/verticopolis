import { BUILD_SECTION, stampBuildSection } from "./buildSection";

/** Test helpers: the smallest valid WebAssembly binary, with custom sections
 *  written by hand, so the loader and the diagnostics can be tried with a
 *  section that is missing, stamped, duplicated or garbled. */

/** The 8-byte header: a module with no sections. */
export const EMPTY_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

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

/** One custom section (id 0): its name, then the payload. */
export function customSection(name: string, payload: Uint8Array): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const body = [...leb(nameBytes.length), ...nameBytes, ...payload];
  return new Uint8Array([0x00, ...leb(body.length), ...body]);
}

/** The empty module followed by the given sections. */
export function wasmWith(...sections: Uint8Array[]): Uint8Array {
  return new Uint8Array([...EMPTY_WASM, ...sections.flatMap((s) => [...s])]);
}

/** The empty module stamped as the build stamps the engine binary. */
export const stampedWasm = (sourceHash: string): Uint8Array => stampBuildSection(EMPTY_WASM, sourceHash);

/** A `verticopolis.build` section with a payload of the test's choosing. */
export const buildSectionWith = (json: string): Uint8Array => customSection(BUILD_SECTION, new TextEncoder().encode(json));

/** A fetch that answers every request with these bytes as `application/wasm`
 *  (or as the given content type, to try the non-streaming path). */
export function wasmFetch(bytes: Uint8Array, init: ResponseInit & { type?: string } = {}): typeof fetch {
  return (async () =>
    new Response(bytes as BodyInit, { status: 200, ...init, headers: { "Content-Type": init.type ?? "application/wasm", ...(init.headers as Record<string, string> | undefined) } })) as unknown as typeof fetch;
}
