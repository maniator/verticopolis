import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
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
function build(engine: Record<string, string | object> | null): string {
  const dist = mkdtempSync(join(tmpdir(), "vc-notices-"));
  dirs.push(dist);
  writeFileSync(join(dist, "app.js"), "export {};\n");
  writeFileSync(join(dist, "app.js.map"), JSON.stringify({ version: 3, sources: [join(ROOT, "src/main.ts")], mappings: "" }));
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

const engineFiles = (record: string | object | null, sources = "abc"): Record<string, string | object> => ({
  "verticopolis_engine.js": "module.exports = {};\n",
  "verticopolis_engine_bg.wasm": "\0asm",
  "BUILD.json": { sources },
  "THIRD-PARTY.json": record ?? "",
});

describe("the notices generator on a build that ships the WASM engine (#955)", () => {
  it("lists the engine's crates and the Rust standard library from a matching record", () => {
    const r = run(build(engineFiles({ sources: "abc", crates: [crate, std] })));
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.notices).toContain("serde@1.0.229 (Rust, in the WASM engine)");
    expect(r.notices).toContain("Rust standard library@1.97.0 (Rust, in the WASM engine)");
  });

  it("fails closed on a missing, stale, malformed or incomplete record", () => {
    const cases: [string, Record<string, string | object>, RegExp][] = [
      ["no record", (({ "THIRD-PARTY.json": _, ...rest }) => rest)(engineFiles(null)), /THIRD-PARTY\.json is missing or not valid JSON/],
      ["no BUILD.json", (({ "BUILD.json": _, ...rest }) => rest)(engineFiles({ sources: "abc", crates: [crate, std] })), /BUILD\.json is missing or not valid JSON/],
      ["record from another build", engineFiles({ sources: "old", crates: [crate, std] }), /source hash differs from BUILD\.json/],
      ["invalid JSON", engineFiles("{ not json"), /THIRD-PARTY\.json is missing or not valid JSON/],
      ["no standard library", engineFiles({ sources: "abc", crates: [crate] }), /does not list the Rust standard library/],
      ["standard library alone", engineFiles({ sources: "abc", crates: [std] }), /no crate besides the Rust standard library/],
      ["a license off the allowlist", engineFiles({ sources: "abc", crates: [{ ...crate, license: "GPL-3.0-only" }, std] }), /not on the allowlist/],
      ["blank license text", engineFiles({ sources: "abc", crates: [{ ...crate, licenseText: " " }, std] }), /no license file/],
    ];
    for (const [name, files, message] of cases) {
      const r = run(build(files));
      expect({ name, status: r.status, notices: r.notices }).toEqual({ name, status: 1, notices: null });
      expect(r.stderr, name).toMatch(message);
    }
  });

  it("requires the record for any engine file, not only the glue", () => {
    const r = run(build({ "verticopolis_engine_bg.wasm": "\0asm" }));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/missing or not valid JSON/);
  });

  it("needs no record when no engine ships", () => {
    const r = run(build(null));
    // Only the game's own code: nothing third-party to list, which the generator refuses rather than write an empty file.
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/lists no third-party packages/);
    expect(r.stderr).not.toMatch(/THIRD-PARTY|engine/);
  });
});
