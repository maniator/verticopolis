import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { decodeVctowerFile } from "../../storage/vctowerContainer";
import { parseTDT } from "../conformance/tdtWasm";

// The Wine-harness save tools in tools/simtower/ run under tsx outside the
// game's build, so a moved import or a renamed engine call breaks them
// silently. This runs each one as a developer would, into a scratch folder,
// and reads back what it wrote with the engine's own .TDT reader.
const ROOT = resolve(import.meta.dirname, "../../..");
const TSX = createRequire(import.meta.url).resolve("tsx/cli");
const SAVES = mkdtempSync(join(tmpdir(), "simtower-saves-"));
afterAll(() => rmSync(SAVES, { recursive: true, force: true }));

function run(tool: string, ...args: string[]): string {
  const r = spawnSync(process.execPath, [TSX, `tools/simtower/${tool}.ts`, ...args], {
    cwd: ROOT,
    env: { ...process.env, SIMTOWER_SAVES: SAVES },
    encoding: "utf8",
    timeout: 120_000,
  });
  expect(r.status, `${tool} failed:\n${r.stdout}\n${r.stderr}`).toBe(0);
  return r.stdout;
}

const tdt = (name: string) => {
  const file = join(SAVES, name);
  expect(existsSync(file), `${name} was not written`).toBe(true);
  return parseTDT(new Uint8Array(readFileSync(file)), name).save;
};

describe("the tools/simtower save builders", () => {
  it.each([
    ["build-economy-verify", "ECONVER.TDT"],
    ["build-express-transfer-396", "TESTXF.TDT"],
    ["build-multitransfer-503", "TESTMR.TDT"],
    ["build-ridebudget-ceiling", "TESTCEIL.TDT"],
  ])("%s writes a .TDT the engine reads back", (tool, out) => {
    run(tool);
    const save = tdt(out);
    expect(save.units.length).toBeGreaterThan(0);
    expect(save.transports.length).toBeGreaterThan(0);
  });

  it("round-trips the venue tower through both converters", () => {
    run("build-venue-cap", "2", "1", "SMOKE");
    const kinds = (units: { kind: string }[]) =>
      units
        .filter((u) => u.kind === "cinema" || u.kind === "partyHall")
        .map((u) => u.kind)
        .sort();
    const built = tdt("SMOKE.TDT");
    expect(kinds(built.units)).toEqual(["cinema", "cinema", "partyHall"]);

    // .TDT -> .vctower beside the input, then that .vctower -> .TDT again.
    run("tdt-to-vctower", join(SAVES, "SMOKE.TDT"));
    const vctower = join(SAVES, "SMOKE.imported.vctower");
    const imported = decodeVctowerFile(new Uint8Array(readFileSync(vctower))) as { units: { kind: string }[] };
    expect(kinds(imported.units)).toEqual(kinds(built.units));
    run("vctower-to-tdt", vctower);
    expect(kinds(tdt("TOWER1.TDT").units)).toEqual(kinds(built.units));
  });

  it("fails a conversion it cannot do", () => {
    const r = spawnSync(process.execPath, [TSX, "tools/simtower/tdt-to-vctower.ts", join(SAVES, "MISSING.TDT")], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(r.status).toBe(1);
  });
});
