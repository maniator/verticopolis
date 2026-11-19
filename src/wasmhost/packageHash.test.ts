import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cargoPackage } from "../build/engineCompat";
import { glueMethods } from "../build/engineBundle";
import { TOOLING_METHODS } from "../engineBinding/toolingMethods";
import { engineSourceHash } from "./packageHash";
import { BUILD_SECTION, customSectionsOf, parseBuildMetadata } from "./buildSection";

const ROOT = resolve(import.meta.dirname, "../..");
const BUILD = resolve(ROOT, "src/public/engine/BUILD.json");
/** The player build's packages (browser, Node) and the tooling build's
 *  (Node, browser), all written by one npm run wasm:build (#1057). */
const PLAYER_PACKAGES = ["src/public/engine", "engine-rs/pkg-player"];
const TOOLING_PACKAGES = ["engine-rs/pkg", "engine-rs/pkg-web-tooling"];

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

  it("carries the build metadata section in both binaries, equal to BUILD.json's sources (stamped before the digests)", () => {
    const built = JSON.parse(readFileSync(BUILD, "utf8")) as { sources: string; files: Record<string, { sha256: string; bytes: number }> };
    for (const f of [...PLAYER_PACKAGES, ...TOOLING_PACKAGES].map((dir) => `${dir}/verticopolis_engine_bg.wasm`)) {
      const bytes = readFileSync(resolve(ROOT, f));
      expect(parseBuildMetadata(customSectionsOf(bytes, BUILD_SECTION)), f).toEqual({ state: "ok", sourceHash: built.sources });
    }
    // BUILD.json describes the stamped bytes, so the section cannot have been added after the digests.
    const served = readFileSync(resolve(ROOT, "src/public/engine/verticopolis_engine_bg.wasm"));
    const entry = built.files["verticopolis_engine_bg.wasm"];
    expect(entry.bytes).toBe(served.length);
    expect(entry.sha256).toBe(createHash("sha256").update(served).digest("hex"));
  });

  it("builds the binding's tier 3 ops into the tooling packages alone (#1057)", () => {
    const tier3In = (dir: string) => {
      const methods = glueMethods(readFileSync(resolve(ROOT, dir, "verticopolis_engine.js"), "utf8"));
      // The reading matched real methods, so an empty answer below is not a misread.
      expect(methods.has("tick"), `${dir} glue has no tick method`).toBe(true);
      return TOOLING_METHODS.filter((m) => methods.has(m));
    };
    for (const dir of PLAYER_PACKAGES) expect(tier3In(dir), dir).toEqual([]);
    for (const dir of TOOLING_PACKAGES) expect(tier3In(dir), dir).toEqual([...TOOLING_METHODS]);
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

  /** A crate whose lib.rs pulls a file in from outside the crate, the way
   *  the engine's tests embed conformance fixtures. */
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

  it("covers every file in the crate, without parsing the layout", () => {
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
    expect(moves(() => writeFileSync(join(c, "src/catalog.json"), "{}"))).toBe(true);
    // A file outside the crate that no source includes is not an input.
    mkdirSync(join(dir, "conformance/events"));
    expect(moves(() => writeFileSync(join(dir, "conformance/events/catalog.json"), "{}"))).toBe(false);
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

  it("leaves out the consumer crate at the top of the crate, and only there (#1945)", () => {
    const { crate: c } = crate();
    mkdirSync(join(c, "consumer/src"), { recursive: true });
    writeFileSync(join(c, "consumer/Cargo.toml"), '[dependencies]\nverticopolis-engine = { path = ".." }\n');
    const before = engineSourceHash(c);
    writeFileSync(join(c, "consumer/src/main.rs"), "fn main() {}\n");
    writeFileSync(join(c, "consumer/Cargo.lock"), "changed");
    expect(engineSourceHash(c)).toBe(before);
    // A folder of the same name inside the sources is engine code.
    mkdirSync(join(c, "src/consumer"));
    writeFileSync(join(c, "src/consumer/mod.rs"), "pub fn f() {}\n");
    expect(engineSourceHash(c)).not.toBe(before);
  });

  it("follows a #[path] module outside the crate, plain or in cfg_attr (#978)", () => {
    const { crate: c } = crate();
    mkdirSync(join(dir, "shared"));
    writeFileSync(join(dir, "shared/rules.rs"), "pub fn r() {}\n");
    writeFileSync(join(dir, "shared/extra.rs"), "pub fn e() {}\n");
    writeFileSync(join(c, "src/more.rs"), '#[path = "../../shared/rules.rs"]\nmod rules;\n#[cfg_attr(feature = "x", path = "../../shared/extra.rs")]\nmod extra;\n');
    let last = engineSourceHash(c);
    for (const f of ["shared/rules.rs", "shared/extra.rs"]) {
      writeFileSync(join(dir, f), "pub fn changed() {}\n");
      const next = engineSourceHash(c);
      expect(next, f).not.toBe(last);
      last = next;
    }
  });

  it("follows a #[path] module that itself includes a file", () => {
    const { crate: c, outside } = crate();
    mkdirSync(join(dir, "shared"));
    writeFileSync(join(dir, "shared/rules.rs"), 'pub const C: &str = include_str!("../conformance/catalog.json");\n');
    writeFileSync(join(c, "src/lib.rs"), '#[path = "../../shared/rules.rs"]\nmod rules;\n');
    const before = engineSourceHash(c);
    writeFileSync(outside, '{"moved":true}');
    expect(engineSourceHash(c)).not.toBe(before);
  });

  it("follows the child modules of a #[path] module outside the crate", () => {
    const { crate: c } = crate();
    mkdirSync(join(dir, "shared/child"), { recursive: true });
    mkdirSync(join(dir, "shared/inner/kid"), { recursive: true });
    writeFileSync(
      join(dir, "shared/rules.rs"),
      '// mod gone;\npub const S: &str = "mod gone;";\npub mod child;\n#[cfg(test)]\nmod tests {\n    fn t() {}\n}\npub(crate) mod inner {\n    mod kid;\n}\n#[path = "extra.rs"]\nmod extra;\n',
    );
    writeFileSync(join(dir, "shared/child.rs"), "mod grand;\n");
    writeFileSync(join(dir, "shared/child/grand.rs"), "pub fn g() {}\n");
    writeFileSync(join(dir, "shared/inner/kid/mod.rs"), "mod leaf;\n");
    writeFileSync(join(dir, "shared/inner/kid/leaf.rs"), "pub fn l() {}\n");
    writeFileSync(join(dir, "shared/extra.rs"), "pub fn e() {}\n");
    writeFileSync(join(c, "src/more.rs"), '#[path = "../../shared/rules.rs"]\nmod rules;\n');
    let last = engineSourceHash(c);
    for (const f of ["shared/child.rs", "shared/child/grand.rs", "shared/inner/kid/mod.rs", "shared/inner/kid/leaf.rs", "shared/extra.rs"]) {
      writeFileSync(join(dir, f), `${readFileSync(join(dir, f), "utf8")}// changed\n`);
      const next = engineSourceHash(c);
      expect(next, f).not.toBe(last);
      last = next;
    }
  });

  it("follows the child modules of a #[path] module in the skipped consumer folder", () => {
    const { crate: c } = crate();
    mkdirSync(join(c, "consumer"));
    writeFileSync(join(c, "consumer/rules.rs"), "mod child;\n");
    writeFileSync(join(c, "consumer/child.rs"), "pub fn c() {}\n");
    writeFileSync(join(c, "src/more.rs"), '#[path = "../consumer/rules.rs"]\nmod rules;\n');
    const before = engineSourceHash(c);
    writeFileSync(join(c, "consumer/child.rs"), "pub fn changed() {}\n");
    expect(engineSourceHash(c)).not.toBe(before);
  });

  it("refuses a child module of an outside #[path] module that it cannot find", () => {
    const { crate: c } = crate();
    mkdirSync(join(dir, "shared"));
    writeFileSync(join(dir, "shared/rules.rs"), "mod gone;\n");
    writeFileSync(join(c, "src/more.rs"), '#[path = "../../shared/rules.rs"]\nmod rules;\n');
    expect(() => engineSourceHash(c)).toThrow(/declares mod gone, and neither .*gone\.rs nor .*mod\.rs exists/);
    // Inside the crate the walk already holds every file, so a module left
    // out by cfg is not looked for.
    writeFileSync(join(c, "src/more.rs"), '#[cfg(feature = "off")]\nmod gone;\n');
    expect(() => engineSourceHash(c)).not.toThrow();
  });

  it("does not read a path attribute out of a comment or a string", () => {
    const { crate: c } = crate();
    writeFileSync(
      join(c, "src/more.rs"),
      '// #[path = "gone.rs"]\n/* #[path = "gone.rs"] /* nested */ */\npub const S: &str = "#[path = \\"gone.rs\\"]";\npub const R: &str = r#"\n#[path = "gone.rs"]\n"#;\npub const Q: char = \'"\';\n#[error("bad path = {0}")]\npub struct E;\npub const C: &core::ffi::CStr = cr#"\n#[path = "gone.rs"]\n"#;\n',
    );
    expect(() => engineSourceHash(c)).not.toThrow();
  });

  it.each([
    ["a missing file", '#[path = "../../shared/gone.rs"]\nmod gone;\n', /gone\.rs, which does not exist/],
    ["a raw string", '#[path = r"../../shared/rules.rs"]\nmod rules;\n', /path attribute .* cannot follow/],
    ["an escape", '#[path = "..\\\\shared\\\\rules.rs"]\nmod rules;\n', /path attribute .* cannot follow/],
  ])("refuses a #[path] with %s", (_, source, error) => {
    const { crate: c } = crate();
    writeFileSync(join(c, "src/more.rs"), source);
    expect(() => engineSourceHash(c)).toThrow(error);
  });

  it("walks a Cargo path dependency outside the crate, build output aside (#978)", () => {
    const { crate: c } = crate();
    mkdirSync(join(dir, "helper/src"), { recursive: true });
    mkdirSync(join(dir, "helper/target"));
    writeFileSync(join(dir, "helper/Cargo.toml"), "[package]\n");
    writeFileSync(join(dir, "helper/src/lib.rs"), "pub fn h() {}\n");
    writeFileSync(
      join(c, "Cargo.toml"),
      '[package]\ndescription = "the path = \\"../gone\\" key"\n# path = "../gone"\n[package.metadata.x]\nreadme-path = "../gone"\npath = "../gone"\nnested = { path = "../gone" }\nnote = "a, path = \'../gone\'"\nother = \'b, path = "../gone"\'\nkeys = ["c", "path = \'../gone\'"] # path = "../gone"\n[workspace.metadata]\ntool.path = "../gone"\n[dependencies]\nhelper = { version = "1", path = \'../helper\' }\n',
    );
    let last = engineSourceHash(c);
    const moves = (edit: () => void) => {
      edit();
      const next = engineSourceHash(c);
      const moved = next !== last;
      last = next;
      return moved;
    };
    expect(moves(() => writeFileSync(join(dir, "helper/src/lib.rs"), "pub fn changed() {}\n"))).toBe(true);
    expect(moves(() => writeFileSync(join(dir, "helper/Cargo.toml"), "[package]\nname = \"helper\"\n"))).toBe(true);
    expect(moves(() => writeFileSync(join(dir, "helper/target/out.rlib"), "x"))).toBe(false);
  });

  it("walks a path dependency written as a dotted key", () => {
    const { crate: c } = crate();
    mkdirSync(join(dir, "helper/src"), { recursive: true });
    writeFileSync(join(dir, "helper/src/lib.rs"), "pub fn h() {}\n");
    writeFileSync(join(c, "Cargo.toml"), '[dependencies]\nhelper.path = "../helper"\n');
    const before = engineSourceHash(c);
    writeFileSync(join(dir, "helper/src/lib.rs"), "pub fn changed() {}\n");
    expect(engineSourceHash(c)).not.toBe(before);
  });

  it("walks a path dependency whose key is quoted", () => {
    const { crate: c } = crate();
    const names = ["basic", "literal", "dotted", "spaced"];
    for (const name of names) {
      mkdirSync(join(dir, name, "src"), { recursive: true });
      writeFileSync(join(dir, name, "src/lib.rs"), "pub fn h() {}\n");
    }
    writeFileSync(
      join(c, "Cargo.toml"),
      '[dependencies]\nbasic = { "path" = "../basic" }\nliteral = { \'path\' = "../literal" }\ndotted."path" = "../dotted"\n"spaced name".path = "../spaced"\n[package.metadata.x]\n"path" = "../gone"\n',
    );
    let last = engineSourceHash(c);
    for (const name of names) {
      writeFileSync(join(dir, name, "src/lib.rs"), "pub fn changed() {}\n");
      const next = engineSourceHash(c);
      expect(next, name).not.toBe(last);
      last = next;
    }
  });

  it("follows a path dependency's own path dependency", () => {
    const { crate: c } = crate();
    for (const name of ["a", "b"]) mkdirSync(join(dir, name, "src"), { recursive: true });
    writeFileSync(join(dir, "a/Cargo.toml"), '[dependencies.b]\npath = "../b"\n');
    writeFileSync(join(dir, "b/Cargo.toml"), "[package]\n");
    writeFileSync(join(dir, "b/src/lib.rs"), "pub fn b() {}\n");
    writeFileSync(join(c, "Cargo.toml"), '[dependencies]\na = { path = "../a" }\n');
    const before = engineSourceHash(c);
    writeFileSync(join(dir, "b/src/lib.rs"), "pub fn changed() {}\n");
    expect(engineSourceHash(c)).not.toBe(before);
  });

  it.each([
    ["a missing folder", '[dependencies]\nh = { path = "../gone" }\n', /names the path \.\.\/gone, which does not exist/],
    ["a value it cannot read", "[dependencies]\nh = { path = concat }\n", /path key .* cannot follow/],
    ["a multi-line literal string", "[dependencies]\nh = { path = '''../helper''' }\n", /path key .* cannot follow/],
    ["a multi-line basic string", '[dependencies.h]\npath = """../helper"""\n', /path key .* cannot follow/],
    ["an empty value", '[dependencies.h]\npath = ""\n', /path key .* cannot follow/],
    ["a quoted key naming a missing folder", '[dependencies]\nh = { "path" = "../gone" }\n', /names the path \.\.\/gone, which does not exist/],
    ["a dotted key naming a missing folder", '[dependencies]\nh.path = "../gone"\n', /names the path \.\.\/gone, which does not exist/],
    ["a missing folder in a table that only starts like metadata", '[package.metadatax]\npath = "../gone"\n', /names the path \.\.\/gone, which does not exist/],
    ["a missing folder under a target-specific dependency table", "[target.'cfg(unix)'.dependencies]\nh = { path = \"../gone\" }\n", /names the path \.\.\/gone, which does not exist/],
  ])("refuses a Cargo path with %s", (_, manifest, error) => {
    const { crate: c } = crate();
    writeFileSync(join(c, "Cargo.toml"), manifest);
    expect(() => engineSourceHash(c)).toThrow(error);
  });
});
