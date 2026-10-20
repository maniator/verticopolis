import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cargoPackage } from "../build/engineCompat";
import { engineSourceHash } from "./packageHash";

const ROOT = resolve(import.meta.dirname, "../..");
const BUILD = resolve(ROOT, "src/public/engine/BUILD.json");

// The served package is build output, not checked in: a local checkout has
// one only after npm run wasm:build, and these checks skip without it. CI
// keys and checks the package on the same hash (.github/actions/engine-wasm).
describe.skipIf(!existsSync(BUILD))("the served engine package", () => {
  it("was built from the Rust sources in the tree (run npm run wasm:build after a Rust change)", () => {
    const built = JSON.parse(readFileSync(BUILD, "utf8")) as { sources: string };
    expect(built.sources).toBe(engineSourceHash(resolve(ROOT, "engine-rs")));
  });

  it("names the crate it was built from (run npm run wasm:build after a Cargo.toml change)", () => {
    const built = JSON.parse(readFileSync(BUILD, "utf8")) as { crate?: unknown };
    expect(built.crate).toEqual(cargoPackage(readFileSync(resolve(ROOT, "engine-rs/Cargo.toml"), "utf8")));
  });

  it("ships the loader and the binary beside the app", () => {
    for (const f of ["verticopolis_engine.js", "verticopolis_engine_bg.wasm"]) {
      expect(existsSync(resolve(ROOT, "src/public/engine", f)), f).toBe(true);
    }
  });
});

describe("engineSourceHash", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** A crate whose lib.rs pulls a file in from outside src, the way
   *  gameplay.rs embeds conformance/events/catalog.json. */
  function crate(): { crate: string; outside: string } {
    dir = mkdtempSync(join(tmpdir(), "vc-hash-"));
    const c = join(dir, "engine-rs");
    mkdirSync(join(c, "src"), { recursive: true });
    mkdirSync(join(c, "lib"));
    mkdirSync(join(dir, "conformance"));
    writeFileSync(join(c, "Cargo.toml"), "[package]\n");
    writeFileSync(join(c, "Cargo.lock"), "");
    writeFileSync(join(c, "src/lib.rs"), 'pub const C: &str = include_str!( "../../conformance/catalog.json" );\n');
    writeFileSync(join(dir, "conformance/catalog.json"), "{}");
    return { crate: c, outside: join(dir, "conformance/catalog.json") };
  }

  it("moves when a file the sources include from outside src changes", () => {
    const { crate: c, outside } = crate();
    const before = engineSourceHash(c);
    writeFileSync(outside, '{"events":[]}');
    expect(engineSourceHash(c)).not.toBe(before);
  });

  it("gives a CRLF checkout of the same sources the same hash (#880), and reads a binary file as it is", () => {
    const { crate: c, outside } = crate();
    writeFileSync(join(c, "src/more.rs"), "pub fn f() {\n    1\n}\n");
    writeFileSync(join(c, "data.bin"), Buffer.from([0, 13, 10, 1]));
    const lf = engineSourceHash(c);
    writeFileSync(join(c, "src/more.rs"), "pub fn f() {\r\n    1\r\n}\r\n");
    writeFileSync(join(c, "Cargo.toml"), "[package]\r\n");
    writeFileSync(outside, "{}");
    expect(engineSourceHash(c)).toBe(lf);
    // A lone CR is content, and so are the bytes of a binary file.
    writeFileSync(join(c, "src/more.rs"), "pub fn f() {\r    1\n}\n");
    expect(engineSourceHash(c)).not.toBe(lf);
    writeFileSync(join(c, "src/more.rs"), "pub fn f() {\n    1\n}\n");
    writeFileSync(join(c, "data.bin"), Buffer.from([0, 10, 1]));
    expect(engineSourceHash(c)).not.toBe(lf);
  });

  it("ignores a stray dotfile or editor backup beside the sources (#880)", () => {
    const { crate: c } = crate();
    const before = engineSourceHash(c);
    writeFileSync(join(c, "src/.DS_Store"), "junk");
    writeFileSync(join(c, "src/lib.rs~"), "junk");
    expect(engineSourceHash(c)).toBe(before);
  });

  it("refuses an include it cannot follow", () => {
    const { crate: c } = crate();
    writeFileSync(join(c, "src/more.rs"), 'pub const D: &str = include_str!(r"../../conformance/catalog.json");\n');
    expect(() => engineSourceHash(c)).toThrow(/cannot follow/);
  });

  it.each([
    ["braces", 'include_str! {"../../conformance/catalog.json"}'],
    ["brackets", 'include_str!["../../conformance/catalog.json"]'],
    ["a space before the !", 'include_str !("../../conformance/catalog.json")'],
    ["include!", 'include!("../../conformance/catalog.json")'],
  ])("refuses an include written with %s", (_, call) => {
    const { crate: c } = crate();
    writeFileSync(join(c, "src/more.rs"), `pub const D: &str = ${call};\n`);
    expect(() => engineSourceHash(c)).toThrow(/cannot follow/);
  });

  it("covers every file in the crate and the event catalog, without parsing the layout", () => {
    const { crate: c } = crate();
    let last = engineSourceHash(c);
    const moves = (edit: () => void) => {
      edit();
      const next = engineSourceHash(c);
      const moved = next !== last;
      last = next;
      return moved;
    };
    expect(moves(() => writeFileSync(join(c, "build.rs"), "fn main() {}\n"))).toBe(true);
    expect(moves(() => writeFileSync(join(c, "lib/gen.inc"), "1"))).toBe(true);
    mkdirSync(join(dir, "conformance/events"));
    expect(moves(() => writeFileSync(join(dir, "conformance/events/catalog.json"), "{}"))).toBe(true);
    expect(moves(() => writeFileSync(join(c, "README.md"), "docs"))).toBe(false);
    mkdirSync(join(c, "target"));
    mkdirSync(join(c, "pkg"));
    expect(moves(() => writeFileSync(join(c, "target/out.wasm"), "x"))).toBe(false);
    expect(moves(() => writeFileSync(join(c, "pkg/out.wasm"), "x"))).toBe(false);
    mkdirSync(join(c, "fuzz/target"), { recursive: true });
    expect(moves(() => writeFileSync(join(c, "fuzz/target/out.rs"), 'include!(concat!(env!("OUT_DIR"), "/x.rs"));'))).toBe(false);
    expect(moves(() => writeFileSync(join(c, ".DS_Store"), "x"))).toBe(false);
    expect(moves(() => writeFileSync(join(c, "src/lib.rs~"), "x"))).toBe(false);
  });

  it("hashes a Markdown file a source includes", () => {
    const { crate: c } = crate();
    writeFileSync(join(c, "src/doc.rs"), '#![doc = include_str!("../README.md")]\n');
    writeFileSync(join(c, "README.md"), "one");
    const before = engineSourceHash(c);
    writeFileSync(join(c, "README.md"), "two");
    expect(engineSourceHash(c)).not.toBe(before);
  });

  it("refuses an unreadable include even beside a look-alike macro", () => {
    const { crate: c } = crate();
    writeFileSync(
      join(c, "src/more.rs"),
      'pub const D: &str = my_include_str!("../../conformance/catalog.json");\npub const E: &str = include_str! {"../../conformance/catalog.json"};\n',
    );
    expect(() => engineSourceHash(c)).toThrow(/cannot follow/);
  });

  it("refuses an include whose file is missing", () => {
    const { crate: c } = crate();
    writeFileSync(join(c, "src/more.rs"), 'pub const D: &str = include_str!("../../conformance/gone.json");\n');
    expect(() => engineSourceHash(c)).toThrow(/gone\.json, which does not exist/);
  });

  it("stays put when nothing it reads changed", () => {
    const { crate: c } = crate();
    const before = engineSourceHash(c);
    writeFileSync(join(dir, "conformance/unrelated.json"), "{}");
    expect(engineSourceHash(c)).toBe(before);
  });
});
