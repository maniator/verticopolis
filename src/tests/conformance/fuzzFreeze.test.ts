import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT } from "./scenario";
import { checkFreeze, FREEZE_MARKER_PATH, parseMarker, type FreezeMarker } from "./fuzzFreeze";
import { fuzzKey, fuzzKeyFiles, fuzzKeyParts } from "./fuzzKey";

const A = "a".repeat(64);
const B = "b".repeat(64);
const APPROVAL = "https://github.com/maniator/verticopolis/issues/1104#issuecomment-123456";
const closed: FreezeMarker = { open: false, key: null, resets: [] };
const open = (key: string, resets: FreezeMarker["resets"] = []): FreezeMarker => ({ open: true, key, resets });

describe("checkFreeze", () => {
  it("lets any key through while no window is open", () => {
    expect(checkFreeze(closed, closed, A).ok).toBe(true);
    expect(checkFreeze(closed, null, B).ok).toBe(true);
  });

  it("lets a PR that leaves the key alone through", () => {
    expect(checkFreeze(open(A), open(A), A)).toMatchObject({ ok: true });
  });

  it("fails a PR that moves the key while the window is open", () => {
    const v = checkFreeze(open(A), open(A), B);
    expect(v.ok).toBe(false);
    expect(v.message).toContain("restarts the 14 nights");
  });

  it("fails a PR that rewrites the marker's key to match its own change without a reset", () => {
    const v = checkFreeze(open(B), open(A), B);
    expect(v.ok).toBe(false);
    expect(v.message).toContain("no owner-approved reset");
  });

  it("accepts the same move once a reset for that step is recorded", () => {
    expect(checkFreeze(open(B, [{ from: A, to: B, approval: APPROVAL }]), open(A), B).ok).toBe(true);
  });

  it("does not take a reset the base already holds (a revert and redo needs a new approval)", () => {
    const spent = [{ from: A, to: B, approval: APPROVAL }];
    expect(checkFreeze(open(B, spent), open(A, spent), B).ok).toBe(false);
  });

  it("does not take a reset for another step", () => {
    expect(checkFreeze(open(B, [{ from: B, to: A, approval: APPROVAL }]), open(A), B).ok).toBe(false);
  });

  it("lifts the freeze once the marker is closed", () => {
    expect(checkFreeze(closed, open(A), B)).toMatchObject({ ok: true, message: "The window is closed by this PR." });
  });

  it("lets a PR open a window on the key it computes, and fails one that records another", () => {
    expect(checkFreeze(open(A), closed, A).ok).toBe(true);
    expect(checkFreeze(open(B), closed, A).ok).toBe(false);
  });
});

describe("parseMarker", () => {
  it("reads the closed and open shapes", () => {
    expect(parseMarker(JSON.stringify(closed))).toEqual(closed);
    expect(parseMarker(JSON.stringify(open(A, [{ from: A, to: B, approval: APPROVAL }])))).toMatchObject({ open: true, key: A });
  });

  it.each([
    ["not JSON", "{"],
    ["an array", "[]"],
    ["no open flag", '{"key":null,"resets":[]}'],
    ["an open window without a key", '{"open":true,"key":null,"resets":[]}'],
    ["a closed window with a key", `{"open":false,"key":"${A}","resets":[]}`],
    ["a short key", '{"open":true,"key":"abc","resets":[]}'],
    ["no resets list", '{"open":false,"key":null}'],
    ["a reset without an owner link", `{"open":false,"key":null,"resets":[{"from":"${A}","to":"${B}","approval":"yes"}]}`],
    ["a reset linked outside the repository", `{"open":false,"key":null,"resets":[{"from":"${A}","to":"${B}","approval":"https://example.com/x#issuecomment-1"}]}`],
  ])("refuses %s", (_name, text) => {
    expect(typeof parseMarker(text)).toBe("string");
  });
});

describe("the repository's marker", () => {
  it("parses, and holds the 3.0.0 window the owner opened at the freeze (2026-11-10), reset for #1877 and for the 3.0.1 bomb search (#1886)", () => {
    const marker = parseMarker(readFileSync(resolve(REPO_ROOT, FREEZE_MARKER_PATH), "utf8"));
    // A reset or a closed window changes this on purpose, in the same PR.
    expect(marker).toEqual({
      open: true,
      key: "e6e86f4380cc99c8d57a0ce6643e2c30ec2edd192a74f86693dc85bd600f7356",
      resets: [
        { from: "ecadbdf6ab8149c42c0ba567d3a7e56ef0e48ab9bcca5f0b9e2a99dd1bd6bc56", to: "429e7e2cd4a3d3a10cac1655b45660febc2ec79276da817d117a761222b3cb65", approval: "https://github.com/maniator/verticopolis/issues/945#issuecomment-6781559256" },
        { from: "429e7e2cd4a3d3a10cac1655b45660febc2ec79276da817d117a761222b3cb65", to: "e6e86f4380cc99c8d57a0ce6643e2c30ec2edd192a74f86693dc85bd600f7356", approval: "https://github.com/maniator/verticopolis/pull/1886#issuecomment-6787552594" },
      ],
    });
  });

  it("is not part of the key, so recording a window never moves it", () => {
    for (const files of Object.values(fuzzKeyFiles(REPO_ROOT))) expect(files).not.toContain(FREEZE_MARKER_PATH);
  });
});

describe("scripts/fuzz-freeze.ts", () => {
  const dir = mkdtempSync(join(tmpdir(), "vc-fuzz-freeze-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const run = (args: string[]): { code: number | null; out: string } => {
    const r = spawnSync(process.execPath, ["--import", "tsx", resolve(REPO_ROOT, "scripts/fuzz-freeze.ts"), ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 60_000,
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const write = (name: string, text: string): string => {
    const p = join(dir, name);
    writeFileSync(p, text);
    return p;
  };
  const key = fuzzKey(fuzzKeyParts(REPO_ROOT));

  it("passes with the repository's own closed marker", () => {
    expect(run([]).code).toBe(0);
  });

  it("fails a PR that moves the key under an open window (exit 1)", () => {
    const marker = write("moved.json", JSON.stringify(open(A)));
    const r = run(["--marker", marker, "--base", marker]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("FROZEN");
  });

  it("passes when the window is open on the current key", () => {
    const marker = write("same.json", JSON.stringify(open(key)));
    expect(run(["--marker", marker, "--base", marker]).code).toBe(0);
  });

  it("cannot decide on a missing or malformed marker (exit 3, never a pass)", () => {
    expect(run(["--marker", join(dir, "none.json")]).code).toBe(3);
    expect(run(["--marker", write("bad.json", "{")]).code).toBe(3);
    expect(run(["--marker", write("open-ok.json", JSON.stringify(open(key))), "--base", write("badbase.json", "[]")]).code).toBe(3);
  });

  it("lets a PR with a closed marker repair a damaged base marker", () => {
    expect(run(["--marker", write("closed-ok.json", JSON.stringify(closed)), "--base", write("badbase2.json", "[]")]).code).toBe(0);
  });

  it("reads an absent or empty base file as a base with no marker", () => {
    const marker = write("open-now.json", JSON.stringify(open(key)));
    expect(run(["--marker", marker, "--base", join(dir, "absent.json")]).code).toBe(0);
    expect(run(["--marker", marker, "--base", write("empty.json", "")]).code).toBe(0);
  });
});
