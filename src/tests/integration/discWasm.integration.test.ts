import { describe, expect, it } from "vitest";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { DiscRefused, REPO_ROOT, defaultLimits, discWasmRequired, hasDiscWasm, openDiscBytes, openDiscFd, type WasmDisc } from "../disc/wasmDisc";

/**
 * The disc reader through its WASM binding must report exactly what the
 * native build reports for the committed synthetic disc
 * (`disc-rs/fixtures/expected.json`, checked natively by
 * `disc-rs/tests/fixtures.rs`), so every host gets one result. Built by
 * `npm run disc:wasm:build`; without it the suite skips, unless
 * `VC_REQUIRE_DISC_WASM=1` (CI sets it in disc-rs.yml, so a missing package
 * fails there).
 */

const FIXTURES = resolve(REPO_ROOT, "disc-rs/fixtures");
const IMAGE = resolve(FIXTURES, "synthetic-disc.iso.bin");
const expected = JSON.parse(readFileSync(resolve(FIXTURES, "expected.json"), "utf8")) as {
  opened: { entries: { token: number }[] };
  stored: ({ token: number; sha256: string } | { token: number; refusal: unknown })[];
  reads: ({ token: number; size: number; sha256: string } | { refusal: { schema: number; code: string; detail: string } })[];
};

if (discWasmRequired() && !hasDiscWasm()) throw new Error("VC_REQUIRE_DISC_WASM=1 but disc-rs/pkg/ is not built; run npm run disc:wasm:build");

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** Every entry, by the listing's own tokens, read and expanded. */
function readAll(disc: WasmDisc) {
  return expected.opened.entries.map(({ token }) => {
    try {
      const { info, bytes } = disc.read(token);
      expect(sha256(bytes)).toBe(info.sha256);
      return info;
    } catch (e) {
      if (e instanceof DiscRefused) return { refusal: e.refusal };
      throw e;
    }
  });
}

/** Every entry's bytes as stored, by hash. */
function storedAll(disc: WasmDisc) {
  return expected.opened.entries.map(({ token }) => {
    try {
      return { token, sha256: sha256(disc.readStored(token)) };
    } catch (e) {
      if (e instanceof DiscRefused) return { token, refusal: e.refusal };
      throw e;
    }
  });
}

describe.skipIf(!hasDiscWasm())("the disc reader through the WASM binding", () => {
  it("lists and reads the synthetic disc exactly as the native build does, from memory", () => {
    const disc = openDiscBytes(new Uint8Array(readFileSync(IMAGE)));
    try {
      expect(disc.opened()).toEqual(expected.opened);
      expect(readAll(disc)).toEqual(expected.reads);
      expect(storedAll(disc)).toEqual(expected.stored);
    } finally {
      disc.free();
    }
  });

  it("gives the same result reading on demand through a file handle", () => {
    const fd = openSync(IMAGE, "r");
    try {
      const size = readFileSync(IMAGE).length;
      const disc = openDiscFd(fd, size);
      try {
        expect(disc.opened()).toEqual(expected.opened);
        expect(readAll(disc)).toEqual(expected.reads);
        expect(storedAll(disc)).toEqual(expected.stored);
      } finally {
        disc.free();
      }
    } finally {
      closeSync(fd);
    }
  });

  it("refuses hostile input as a typed refusal and leaves the module usable", () => {
    const image = new Uint8Array(readFileSync(IMAGE));
    expect(() => openDiscBytes(image.subarray(0, 1024))).toThrow(DiscRefused);
    expect(() => openDiscBytes(image, { maxRecords: 1 })).toThrow(/^budget-exceeded:/);
    expect(() => openDiscBytes(image, { maxRecord: 1 })).toThrow(/bad-request/);
    expect(() => openDiscBytes(image, { maxFileBytes: 2 ** 32 - 1 })).toThrow(/^bad-request:/);
    // An oversized buffer is refused before it crosses into the module, by
    // the module's own default limit; the module refuses the same through a
    // source, where nothing is copied.
    expect(defaultLimits().maxImageBytes).toBe(900 * 1024 * 1024);
    expect(() => openDiscBytes(image, { maxImageBytes: 1024 })).toThrow(/^too-large:/);
    // A limit past the hard ceiling, or not a whole number, is refused
    // before the copy too.
    expect(() => openDiscBytes(image, { maxImageBytes: 2 ** 40 })).toThrow(/^bad-request:/);
    expect(() => openDiscBytes(image, { maxImageBytes: 1.5 })).toThrow(/^bad-request:/);
    const fd = openSync(IMAGE, "r");
    try {
      expect(() => openDiscFd(fd, image.length, { maxImageBytes: 1024 })).toThrow(/^too-large:/);
    } finally {
      closeSync(fd);
    }
    const disc = openDiscBytes(image);
    try {
      expect(() => disc.read(99)).toThrow(/bad-request/);
      // Tokens the glue would wrap or truncate are refused with a typed
      // refusal before they reach the module.
      for (const bad of [2 ** 32, -1, 1.5, Number.NaN]) {
        expect(() => disc.read(bad)).toThrow(/^bad-request:/);
        expect(() => disc.readStored(bad)).toThrow(/^bad-request:/);
      }
      expect(disc.opened()).toEqual(expected.opened);
    } finally {
      disc.free();
    }
  });

  it("refuses a host read that comes back short instead of using a short buffer", () => {
    // The source claims the image's full size but holds only its first 20
    // sectors (the descriptors and directories), so the first peek at a
    // file's header runs short and the open is refused.
    const image = readFileSync(IMAGE);
    const dir = mkdtempSync(resolve(tmpdir(), "vc-disc-"));
    const cut = resolve(dir, "cut.bin");
    writeFileSync(cut, image.subarray(0, 20 * 2048));
    const fd = openSync(cut, "r");
    try {
      expect(() => openDiscFd(fd, image.length)).toThrow(/^truncated:/);
    } finally {
      closeSync(fd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
