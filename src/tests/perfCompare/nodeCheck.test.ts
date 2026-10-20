import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { glueFileUrl } from "./nodeCheck";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("the glue's file URL", () => {
  it("turns a Windows drive path into a file: URL, not a scheme-looking path", () => {
    // Node reads the `c:` of a raw `C:\...` path as a URL scheme and rejects it
    // (ERR_UNSUPPORTED_ESM_URL_SCHEME), which stopped perf:compare on Windows.
    expect(glueFileUrl("C:\\Users\\me\\vc perf\\dist\\engine", true)).toBe("file:///C:/Users/me/vc%20perf/dist/engine/verticopolis_engine.js");
    expect(glueFileUrl("c:\\repo\\dist\\engine\\", true)).toBe("file:///c:/repo/dist/engine/verticopolis_engine.js");
  });

  it("escapes characters that mean something in a URL", () => {
    expect(glueFileUrl("/tmp/a b#c%d/engine", false)).toBe("file:///tmp/a%20b%23c%25d/engine/verticopolis_engine.js");
  });

  it("is a URL that import() loads, from a folder with a space and a hash", () => {
    const root = mkdtempSync(join(tmpdir(), "vc glue #"));
    dirs.push(root);
    mkdirSync(join(root, "engine"));
    writeFileSync(join(root, "engine", "verticopolis_engine.js"), "export const answer = 42;\n");
    // A plain Node process, as the harness runs it (vitest's own loader would
    // not tell us what Node accepts).
    const url = glueFileUrl(join(root, "engine"));
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", `console.log((await import(${JSON.stringify(url)})).answer)`], { encoding: "utf8" });
    expect(out.trim()).toBe("42");
  });
});
