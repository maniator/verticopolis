import { describe, it, expect } from "vitest";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  COMPAT_RECORD_PATH,
  LOCK_FILES,
  VERSION_CONSTANTS,
  cargoVersion,
  computeCompat,
  interfaceDigest,
  lockDigest,
  recordText,
  rustConstant,
  unbumpedPins,
  type CompatRecord,
} from "../build/engineCompat";

/**
 * The engine crate's version rule (#963, release plan section 7.4): the crate
 * version changes when the conformance lock, the save, frame layout, catalog
 * or identity record version, or the public Rust/WASM interface moves, and an
 * internal change that keeps all of them is told apart by the build hash with
 * no bump. `engine-rs/src/compat-record.json` records the version beside
 * those pins; this guard recomputes the pins from the tree and fails when one
 * moved and the record did not. `npm run engine:compat` rewrites the record
 * and refuses to when a pin moved under the same version.
 *
 * What it cannot see is a record edited by hand in the same PR without a bump
 * (CI's checkout has no base branch to compare with); review owns that case.
 */

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const record = JSON.parse(read(COMPAT_RECORD_PATH)) as CompatRecord;
const tree = computeCompat(ROOT);

/** Which fields of the record the tree disagrees with. */
function drift(rec: CompatRecord, now: CompatRecord): string[] {
  return (Object.keys(now) as (keyof CompatRecord & string)[]).filter(
    (k) => rec[k] !== now[k],
  );
}

const REMEDY =
  "bump `version` in engine-rs/Cargo.toml for a lock, version-constant or interface change, then run `npm run engine:compat` and commit the record (release plan 7.4)";

describe("engine crate version rule", () => {
  it("the record matches the tree", () => {
    expect(drift(record, tree), REMEDY).toEqual([]);
  });

  it("the record is the file the script writes", () => {
    expect(lf(read(COMPAT_RECORD_PATH))).toBe(recordText(tree));
  });

  describe("each pin fails when its input moves and the record does not", () => {
    const decl = read("src/dualrun/engine.d.ts");

    for (const [key, c] of Object.entries(VERSION_CONSTANTS)) {
      it(c.name, () => {
        const moved = read(c.file).replace(
          new RegExp(
            `^((?:pub(?:\\(crate\\))? )?const ${c.name}: ${c.type} = )\\d+;`,
            "m",
          ),
          "$1999;",
        );
        expect(rustConstant(moved, c.name, c.type)).toBe(999);
        const now = { ...tree, [key]: 999 };
        expect(drift(record, now)).toEqual([key]);
      });
    }

    it("the interface", () => {
      const moved = `${decl}\nexport function added(): void;\n`;
      expect(interfaceDigest(moved)).not.toBe(record.interfaceDigest);
    });

    it("the lock, in each of its files", () => {
      const dir = mkdtempSync(join(tmpdir(), "vc-lock-"));
      try {
        for (const f of LOCK_FILES) {
          mkdirSync(dirname(join(dir, f)), { recursive: true });
          copyFileSync(resolve(ROOT, "conformance", f), join(dir, f));
        }
        expect(lockDigest(dir)).toBe(record.lockDigest);
        for (const f of LOCK_FILES) {
          const text = readFileSync(join(dir, f), "utf8");
          writeFileSync(
            join(dir, f),
            text.replace(/[0-9a-f]/, (c) => (c === "0" ? "1" : "0")),
          );
          expect(lockDigest(dir), f).not.toBe(record.lockDigest);
          writeFileSync(join(dir, f), text);
        }
        // A CRLF checkout digests like an LF one.
        const f = LOCK_FILES[0];
        writeFileSync(
          join(dir, f),
          readFileSync(join(dir, f), "utf8").replace(/\n/g, "\r\n"),
        );
        expect(lockDigest(dir)).toBe(record.lockDigest);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("a record version that differs from Cargo.toml", () => {
      expect(drift({ ...record, crateVersion: "9.9.9" }, tree)).toEqual([
        "crateVersion",
      ]);
    });
  });

  describe("the interface digest", () => {
    const base = 'export function a(): "x//y" | "z";\n/** doc */\n';
    const digest = interfaceDigest;

    it("ignores comments and spacing", () => {
      const decl = read("src/dualrun/engine.d.ts");
      const doc = decl
        .replace("/**", "/** A reworded note.")
        .replace(/;\n/g, ";\n\n");
      expect(doc).not.toBe(decl);
      expect(digest(doc)).toBe(record.interfaceDigest);
      expect(digest("a;\n// note\nb;")).toBe(digest("a;\nb;"));
    });

    it("reads a // inside a string as part of the string", () => {
      expect(digest(base)).not.toBe(
        digest('export function a(): "x//y" | "q";\n/** doc */\n'),
      );
    });

    it("reads a /* inside a line comment as part of the line comment", () => {
      const a =
        "export function b(): number;\n// see src/*.ts\nexport function b(): string;\n/** doc */\n";
      const b =
        "export function b(): number;\n// see src/*.ts\nexport function b(): boolean;\n/** doc */\n";
      expect(digest(a)).not.toBe(digest(b));
    });

    it("reads a */ inside a line comment as part of the line comment", () => {
      expect(digest("a; // x */ y\nb;")).toBe(digest("a;\nb;"));
    });
  });

  describe("unbumpedPins", () => {
    it("names a pin that moved under the same version", () => {
      expect(unbumpedPins(record, { ...record, saveVersion: 8 })).toEqual([
        "saveVersion",
      ]);
      expect(
        unbumpedPins(record, {
          ...record,
          lockDigest: "0".repeat(16),
          catalogVersion: 2,
        }),
      ).toEqual(["lockDigest", "catalogVersion"]);
    });

    it("accepts a pin that moved with the version, and nothing moving", () => {
      expect(
        unbumpedPins(record, {
          ...record,
          crateVersion: "9.9.9",
          saveVersion: 8,
        }),
      ).toEqual([]);
      expect(unbumpedPins(record, record)).toEqual([]);
    });
  });

  it("reads a constant and a version, and refuses a file without one", () => {
    expect(() =>
      rustConstant("pub const OTHER: i64 = 1;", "SAVE_VERSION", "i64"),
    ).toThrow(/SAVE_VERSION/);
    // A doc comment that quotes the declaration is not the declaration.
    expect(() =>
      rustConstant(
        "/// `pub const SAVE_VERSION: i64 = 3;`\n",
        "SAVE_VERSION",
        "i64",
      ),
    ).toThrow(/SAVE_VERSION/);
    expect(rustConstant("pub(crate) const X: u32 = 4;\n", "X", "u32")).toBe(4);
    expect(() => cargoVersion('[dependencies]\nserde = "1"\n')).toThrow(
      /version/,
    );
    expect(
      cargoVersion(
        '[package]\nname = "x"\nversion = "1.2.3"\n[dependencies]\nserde = { version = "9" }\n',
      ),
    ).toBe("1.2.3");
  });
});
