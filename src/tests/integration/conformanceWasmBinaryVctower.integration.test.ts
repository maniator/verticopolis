/**
 * The binary `.vctower` file (`VCTOWER2`) through the real engine's public
 * binding: for every `.vctower` fixture, the binary file the engine writes
 * opens with `Engine.fromVctowerBytes` and `loadVctowerBytes` as the same
 * game as the text file, a text file read as bytes opens too, and a binary
 * file decoded as text is refused instead of loading as something else.
 * The binary files committed under `conformance/fixtures/binary/` open as
 * the game of their text twins, so a file exported today keeps opening.
 *
 * Skips without the WASM package, like the rest of `npm run test:wasm`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Engine } from "@verticopolis/engine/tooling/node/verticopolis_engine";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";
import { CONFORMANCE_ROOT } from "../packagePaths";

const FIXTURES = resolve(CONFORMANCE_ROOT, "fixtures");
const fixtures = readdirSync(FIXTURES)
  .filter((f) => f.endsWith(".vctower"))
  .sort();

/** Binary files committed byte for byte, each written from the text fixture of its name. */
const BINARY_FIXTURES = resolve(CONFORMANCE_ROOT, "fixtures/binary");
const binaryFixtures = readdirSync(BINARY_FIXTURES)
  .filter((f) => f.endsWith(".vctower"))
  .sort();

const VERSION = "3.0.0";
const SAVED_AT = 1_760_000_000_123;

const engines = (): typeof Engine => (wasm() as unknown as { Engine: typeof Engine }).Engine;

/** Run `body` on an engine and free it after. */
function using<T>(engine: Engine, body: (e: Engine) => T): T {
  try {
    return body(engine);
  } finally {
    engine.free();
  }
}

describe.runIf(hasWasmPackage())("the binary .vctower through the engine binding", () => {
  it("has a committed binary file to keep opening", () => {
    expect(binaryFixtures.length).toBeGreaterThan(0);
  });

  it.each(binaryFixtures)("%s: a committed binary file still opens as its text twin's game", (name) => {
    const bytes = new Uint8Array(readFileSync(resolve(BINARY_FIXTURES, name)));
    expect(new TextDecoder().decode(bytes.subarray(0, 9))).toBe("VCTOWER2\n");
    const digest = using(engines().fromVctower(readFileSync(resolve(FIXTURES, name), "utf8")), (e) => e.stateDigest());
    using(engines().fromVctowerBytes(bytes), (e) => expect(e.stateDigest()).toBe(digest));
    using(engines().newGame(1, "classic"), (e) => {
      e.loadVctowerBytes(bytes);
      expect(e.lastReason()).toBeUndefined();
      expect(e.stateDigest()).toBe(digest);
    });
  });

  it.each(fixtures)("%s: the binary file is the text file's game, a quarter smaller", (name) => {
    const text = readFileSync(resolve(FIXTURES, name), "utf8");
    const { textFile, binary, digest, save } = using(engines().fromVctower(text), (e) => ({
      textFile: e.exportVctower(VERSION, SAVED_AT)!,
      binary: e.exportVctowerBytes(VERSION, SAVED_AT)!,
      digest: e.stateDigest(),
      save: e.serialize(),
    }));
    expect(new TextDecoder().decode(binary.subarray(0, 9))).toBe("VCTOWER2\n");
    expect(binary.length).toBeLessThan(textFile.length * 0.8);

    using(engines().fromVctowerBytes(binary), (e) => {
      expect(e.stateDigest()).toBe(digest);
      expect(e.serialize()).toBe(using(engines().fromVctower(textFile), (t) => t.serialize()));
    });
    // A text file read as bytes opens as the text file does.
    using(engines().fromVctowerBytes(new TextEncoder().encode(textFile)), (e) => expect(e.stateDigest()).toBe(digest));
    // The port member a running game loads with.
    using(engines().newGame(1, "classic"), (e) => {
      e.loadVctowerBytes(binary);
      expect(e.lastReason()).toBeUndefined();
      expect(e.stateDigest()).toBe(digest);
    });
    expect(save.length).toBeGreaterThan(0);
  });

  it("refuses a binary file that was decoded as text", () => {
    const [first] = fixtures;
    const binary = using(engines().fromVctower(readFileSync(resolve(FIXTURES, first), "utf8")), (e) => e.exportVctowerBytes(VERSION, SAVED_AT)!);
    expect(() => engines().fromVctower(new TextDecoder().decode(binary))).toThrow();
    expect(() => engines().fromVctowerBytes(binary.subarray(0, 8))).toThrow();
  });
});
