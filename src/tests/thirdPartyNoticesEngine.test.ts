import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// The real notices generator run against fixture builds (#955): a build that
// ships the WASM engine must carry its record, and the generator fails closed
// on a missing, stale or incomplete one, as `verify:dist` does on every
// production build.
const ROOT = resolve(__dirname, "../..");
const SCRIPT = join(ROOT, "scripts/gen-third-party-notices.ts");
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const crate = { name: "serde", version: "1.0.229", license: "MIT OR Apache-2.0", licenseText: "MIT text", hasLicenseFile: true, kind: "crate" };
const std = { name: "Rust standard library", version: "1.97.0", license: "(MIT OR Apache-2.0) AND Unicode-3.0 AND Zlib", licenseText: "std text", hasLicenseFile: true, kind: "crate" };

/** A built tree: one bundle of the game's own code, plus the engine package as given. */
function build(engine: Record<string, string | object> | null, sources = [join(ROOT, "src/main.ts")]): string {
  const dist = mkdtempSync(join(tmpdir(), "vc-notices-"));
  dirs.push(dist);
  writeFileSync(join(dist, "app.js"), "export {};\n");
  writeFileSync(join(dist, "app.js.map"), JSON.stringify({ version: 3, sources, mappings: "" }));
  if (engine) {
    mkdirSync(join(dist, "engine"));
    for (const [file, body] of Object.entries(engine)) writeFileSync(join(dist, "engine", file), typeof body === "string" ? body : JSON.stringify(body));
  }
  return dist;
}

function run(dist: string): { status: number | null; stderr: string; notices: string | null } {
  const r = spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, VC_NOTICES_DIST: dist }, encoding: "utf8" });
  let notices: string | null = null;
  try {
    notices = readFileSync(join(dist, "third-party-notices.txt"), "utf8");
  } catch {
    // Not written: the run failed.
  }
  return { status: r.status, stderr: r.stderr, notices };
}

const WASM = "\0asm";
const WASM_SHA = createHash("sha256").update(WASM).digest("hex");
/** The engine package files; an object record gets the shipped .wasm's hash unless it names one. */
const engineFiles = (record: string | object | null, sources = "abc", wasm = WASM): Record<string, string | object> => ({
  "verticopolis_engine.js": "module.exports = {};\n",
  "verticopolis_engine_bg.wasm": wasm,
  "BUILD.json": { sources },
  "THIRD-PARTY.json": record !== null && typeof record === "object" ? { wasm: WASM_SHA, ...record } : (record ?? ""),
});

describe("the notices generator on a build that ships the WASM engine (#955)", () => {
  it("lists the engine's crates and the Rust standard library from a matching record", () => {
    const r = run(build(engineFiles({ sources: "abc", crates: [crate, std] })));
    expect(r.stderr).not.toMatch(/gen-third-party-notices:/);
    expect(r.status).toBe(0);
    expect(r.notices).toContain("serde@1.0.229 (Rust, in the WASM engine)");
    expect(r.notices).toContain("Rust standard library@1.97.0 (Rust, in the WASM engine)");
  });

  it("fails closed on a missing, stale, malformed or incomplete record", () => {
    const cases: [string, Record<string, string | object>, RegExp][] = [
      ["no record", (({ "THIRD-PARTY.json": _, ...rest }) => rest)(engineFiles(null)), /THIRD-PARTY\.json is missing or not valid JSON/],
      ["no BUILD.json", (({ "BUILD.json": _, ...rest }) => rest)(engineFiles({ sources: "abc", crates: [crate, std] })), /BUILD\.json is missing or not valid JSON/],
      ["record from another build", engineFiles({ sources: "old", crates: [crate, std] }), /source hash differs from BUILD\.json/],
      ["a .wasm from another build", engineFiles({ sources: "abc", crates: [crate, std] }, "abc", "\0asm-other"), /SHA-256 differs/],
      ["invalid JSON", engineFiles("{ not json"), /THIRD-PARTY\.json is missing or not valid JSON/],
      ["no standard library", engineFiles({ sources: "abc", crates: [crate] }), /does not list the Rust standard library/],
      ["standard library alone", engineFiles({ sources: "abc", crates: [std] }), /no crate besides the Rust standard library/],
      ["standard library with another license", engineFiles({ sources: "abc", crates: [crate, { ...std, license: "MIT" }] }), /declares MIT, not/],
      ["standard library twice", engineFiles({ sources: "abc", crates: [crate, std, std] }), /more than once/],
      ["a license off the allowlist", engineFiles({ sources: "abc", crates: [{ ...crate, license: "GPL-3.0-only" }, std] }), /not on the allowlist/],
      ["another file beside the package", { ...engineFiles({ sources: "abc", crates: [crate, std] }), "other.wasm": "\0asm" }, /ships other\.wasm/],
            ["blank license text", engineFiles({ sources: "abc", crates: [{ ...crate, licenseText: " " }, std] }), /no license file/],
    ];
    for (const [name, files, message] of cases) {
      const r = run(build(files));
      expect({ name, status: r.status, notices: r.notices }).toEqual({ name, status: 1, notices: null });
      expect(r.stderr, name).toMatch(message);
    }
  });

  it("treats an empty engine folder as no engine, and an engine file in its place as a broken package", () => {
    const dist = build({}, [join(ROOT, "src/main.ts"), join(ROOT, "node_modules/lit-html/lit-html.js")]);
    expect(run(dist).status).toBe(0);
    const file = build(null, [join(ROOT, "src/main.ts"), join(ROOT, "node_modules/lit-html/lit-html.js")]);
    writeFileSync(join(file, "engine"), "not a folder");
    const r = run(file);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/missing or not valid JSON/);
  });

  it("requires the record for any engine file, not only the glue", () => {
    const r = run(build({ "verticopolis_engine_bg.wasm": "\0asm" }));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/missing or not valid JSON/);
  });

  it("needs no record when no engine ships, and lists the npm packages as before", () => {
    const r = run(build(null, [join(ROOT, "src/main.ts"), join(ROOT, "node_modules/lit-html/lit-html.js")]));
    expect(r.stderr).not.toMatch(/gen-third-party-notices:/);
    expect(r.status).toBe(0);
    expect(r.notices).toMatch(/^lit-html@\S+$/m);
    expect(r.notices).not.toContain("(Rust, in the WASM engine)");
  });
});
