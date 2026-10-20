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
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  COMPAT_RECORD_PATH,
  LOCK_FILES,
  VERSION_CONSTANTS,
  baseRecord,
  cargoVersion,
  compatInputs,
  computeCompat,
  interfaceDigest,
  isSemverIncrease,
  lockDigest,
  recordText,
  rustConstant,
  unbumpedPins,
  type CompatRecord,
  type Git,
} from "../build/engineCompat";

/**
 * The engine crate's version rule (#963, release plan section 7.4): the crate
 * version changes when the conformance lock, the save, frame layout, catalog
 * or identity record version, or the public Rust/WASM interface moves, and an
 * internal change that keeps all of them is told apart by the build hash with
 * no bump. `engine-rs/src/compat-record.json` records the version beside
 * those pins; this guard recomputes the pins from the tree and fails when one
 * moved and the record did not. `npm run engine:compat` rewrites the record
 * and refuses to when a pin differs from main's under the same version.
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
  "bump `version` in engine-rs/Cargo.toml, engine-rs/Cargo.lock and engine-rs/consumer/Cargo.lock for a lock, version-constant or interface change, then run `npm run engine:compat` and commit the record (release plan 7.4)";

/** The tree `computeCompat` reads, copied to a temp directory so a test can change one input. */
function withTree<T>(
  change: (dir: string) => void,
  then: (dir: string) => T,
): T {
  const dir = mkdtempSync(join(tmpdir(), "vc-compat-"));
  try {
    for (const f of compatInputs()) {
      mkdirSync(dirname(join(dir, f)), { recursive: true });
      copyFileSync(resolve(ROOT, f), join(dir, f));
    }
    change(dir);
    return then(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const edit = (dir: string, file: string, fn: (text: string) => string) =>
  writeFileSync(join(dir, file), fn(readFileSync(join(dir, file), "utf8")));

describe("engine crate version rule", () => {
  it("the record matches the tree", () => {
    expect(drift(record, tree), REMEDY).toEqual([]);
  });

  it("the native consumer's lockfile names the same crate version", () => {
    const lock = lf(read("engine-rs/consumer/Cargo.lock"));
    const m = /name = "verticopolis-engine"\nversion = "([^"]+)"/.exec(lock);
    expect(
      m?.[1],
      "update engine-rs/consumer/Cargo.lock to the new crate version (CI builds it with --locked)",
    ).toBe(tree.crateVersion);
  });

  it("the record is the file the script writes", () => {
    expect(lf(read(COMPAT_RECORD_PATH))).toBe(recordText(tree));
  });

  describe("each pin fails when its input moves and the record does not", () => {
    const decl = read("src/dualrun/engine.d.ts");

    it("the unchanged tree matches the record (the mutations below start from it)", () => {
      expect(
        withTree(
          () => {},
          (dir) => drift(record, computeCompat(dir)),
        ),
      ).toEqual([]);
    });

    for (const [key, c] of Object.entries(VERSION_CONSTANTS)) {
      it(c.name, () => {
        const moved = withTree(
          (dir) =>
            edit(dir, c.file, (text) =>
              text.replace(
                new RegExp(
                  `^((?:pub(?:\\(crate\\))? )?const ${c.name}: ${c.type} = )\\d+;`,
                  "m",
                ),
                "$1999;",
              ),
            ),
          (dir) => computeCompat(dir),
        );
        expect(moved[key as keyof CompatRecord]).toBe(999);
        expect(drift(record, moved)).toEqual([key]);
      });
    }

    it("the crate version in Cargo.toml", () => {
      const moved = withTree(
        (dir) =>
          edit(dir, "engine-rs/Cargo.toml", (t) =>
            t.replace(/^version = "[^"]+"/m, 'version = "9.9.9"'),
          ),
        (dir) => computeCompat(dir),
      );
      expect(drift(record, moved)).toEqual(["crateVersion"]);
    });

    it("the interface", () => {
      const moved = withTree(
        (dir) =>
          edit(
            dir,
            "src/dualrun/engine.d.ts",
            (t) => `${t}\nexport function added(): void;\n`,
          ),
        (dir) => computeCompat(dir),
      );
      expect(drift(record, moved)).toEqual(["interfaceDigest"]);
      expect(decl).toContain("engineIdentity");
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
        // A CRLF checkout digests like an LF one, and one already in CRLF stays CRLF.
        const f = LOCK_FILES[0];
        const crlf = (t: string) => t.replace(/\r?\n/g, "\r\n");
        writeFileSync(join(dir, f), crlf(readFileSync(join(dir, f), "utf8")));
        expect(lockDigest(dir)).toBe(record.lockDigest);
        writeFileSync(join(dir, f), crlf(readFileSync(join(dir, f), "utf8")));
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

  it("refuses a constant declared twice or only in a block comment", () => {
    // A `#[cfg(test)]` copy placed first is the case this stands for.
    const dup =
      "#[cfg(test)]\nconst X: u32 = 2;\n#[cfg(not(test))]\nconst X: u32 = 1;\n";
    expect(() => rustConstant(dup, "X", "u32")).toThrow(/2 times/);
    expect(() =>
      rustConstant("/*\npub const X: u32 = 1;\n*/\n", "X", "u32"),
    ).toThrow(/no `const X/);
    expect(rustConstant("/* old */\npub const X: u32 = 5;\n", "X", "u32")).toBe(
      5,
    );
  });

  it("reads past a line comment that mentions a block comment opener", () => {
    const src =
      "// see migrations/*.ts\npub const X: u32 = 7;\n/// globs like **/ close it\n";
    expect(rustConstant(src, "X", "u32")).toBe(7);
  });

  it("wires each version constant to the Rust name its key spells", () => {
    for (const [key, c] of Object.entries(VERSION_CONSTANTS)) {
      const snake = key.replace(/[A-Z]/g, (m) => `_${m}`).toUpperCase();
      expect(c.name, key).toBe(snake);
    }
  });

  it("reads a CRLF checkout of a Rust file and a Cargo.toml", () => {
    expect(rustConstant("pub const X: u32 = 4;\r\n", "X", "u32")).toBe(4);
    expect(
      cargoVersion('[package]\r\nname = "x"\r\nversion = "1.2.3"\r\n'),
    ).toBe("1.2.3");
  });

  describe("isSemverIncrease", () => {
    it.each([
      ["0.2.0", "0.2.1", true],
      ["0.2.0", "0.3.0", true],
      ["0.9.9", "1.0.0", true],
      ["0.2.0", "0.2.0", false],
      ["0.2.0", "0.1.9", false],
      ["0.2.0", "0.2.0-rc.1", false],
      ["0.2.0", "0.2.0+meta", false],
      ["0.2.0", "0.10", false],
      ["0.2.0", "0.10.0", true],
    ])("%s to %s is %s", (from, to, want) => {
      expect(isSemverIncrease(from, to)).toBe(want);
    });
  });

  describe("baseRecord, the record the compare reads from main", () => {
    const mainRecord = JSON.stringify({ ...record, crateVersion: "0.1.0" });
    /** A fake git: each rule answers a command or throws the way git does. */
    const fakeGit =
      (rules: {
        ref?: string | false;
        show?: string | false;
        log?: string;
      }): Git =>
      (args) => {
        if (args[0] === "rev-parse") {
          if (rules.ref === false) throw new Error("no ref");
          return `${rules.ref ?? "0123456789abcdef"}\n`;
        }
        if (args[0] === "show") {
          if (rules.show === false || rules.show === undefined)
            throw new Error("not in main");
          return rules.show;
        }
        if (args[0] === "log") return rules.log ?? "";
        throw new Error(`unexpected git ${args.join(" ")}`);
      };

    it("reads main's record and says which commit it came from", () => {
      const r = baseRecord(fakeGit({ show: mainRecord }));
      expect(r.record?.crateVersion).toBe("0.1.0");
      expect(r.source).toBe("origin/main@01234567");
    });

    it("lets a record that main never had be new", () => {
      const r = baseRecord(fakeGit({ show: false, log: "" }));
      expect(r.record).toBeNull();
      expect(r.source).toContain("no record yet");
    });

    it("refuses with no origin/main, and never reads the working tree", () => {
      expect(() => baseRecord(fakeGit({ ref: false }))).toThrow(
        /git fetch origin main/,
      );
    });

    it("refuses a record that main had and no longer has", () => {
      expect(() =>
        baseRecord(fakeGit({ show: false, log: "deadbeef" })),
      ).toThrow(/deleted or moved/);
    });

    it("refuses a record on main that cannot be read", () => {
      expect(() => baseRecord(fakeGit({ show: "{not json" }))).toThrow(
        /cannot be read/,
      );
      expect(() => baseRecord(fakeGit({ show: "{}" }))).toThrow(
        /no crateVersion/,
      );
    });
  });

  it("the five lock files are the whole conformance lock", () => {
    // A new file at the top of conformance/ or in events/ has to be placed:
    // add it to LOCK_FILES (and the Rust test's list) when it pins the engine,
    // or to this list when it is an input the lock already covers.
    const inputs = new Set(["README.md", "fixtures", "scenarios"]);
    const locked = new Set(LOCK_FILES.map((f) => f.split("/")[0]));
    const visible = (dir: string) =>
      readdirSync(resolve(ROOT, dir)).filter((n) => !n.startsWith("."));
    const top = visible("conformance").filter((n) => !inputs.has(n));
    expect(top.sort()).toEqual([...locked].sort());
    expect(visible("conformance/events")).toEqual(["catalog.json"]);
  });
});
