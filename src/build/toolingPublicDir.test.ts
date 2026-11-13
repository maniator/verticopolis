import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assembleToolingPublicDir, choosePublicDir, hasEnginePackage, toolingEngineFile } from "./toolingPublicDir";

const base = { tooling: false, serve: false, vitest: false, hasToolingPackage: true, hasPlayerPackage: true };

describe("choosePublicDir (#1057)", () => {
  it("serves the player package to every production build, with or without a tooling package", () => {
    expect(choosePublicDir(base)).toEqual({ kind: "player" });
    expect(choosePublicDir({ ...base, hasToolingPackage: false })).toEqual({ kind: "player" });
  });

  it("serves the tooling package to a VC_TOOLING=1 build and a dev serve that have one", () => {
    expect(choosePublicDir({ ...base, tooling: true })).toEqual({ kind: "tooling" });
    expect(choosePublicDir({ ...base, serve: true })).toEqual({ kind: "tooling" });
  });

  it("leaves vitest on the player folder, whatever else is set", () => {
    expect(choosePublicDir({ ...base, vitest: true, tooling: true, serve: true })).toEqual({ kind: "player" });
  });

  it("refuses a VC_TOOLING=1 build that has the player package but no tooling one", () => {
    const choice = choosePublicDir({ ...base, tooling: true, hasToolingPackage: false });
    expect(choice.kind).toBe("missing-tooling");
    expect(choice.kind === "missing-tooling" && choice.why).toContain("npm run wasm:build");
  });

  it("lets a dev serve fall back to the player package, and a build with no engine at all through", () => {
    expect(choosePublicDir({ ...base, serve: true, hasToolingPackage: false })).toEqual({ kind: "player" });
    expect(choosePublicDir({ ...base, tooling: true, hasToolingPackage: false, hasPlayerPackage: false })).toEqual({ kind: "player" });
  });
});

describe("assembleToolingPublicDir", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function tree(): { publicDir: string; tooling: string; out: string } {
    dir = mkdtempSync(join(tmpdir(), "vc-tooling-public-"));
    const publicDir = join(dir, "public");
    mkdirSync(join(publicDir, "engine"), { recursive: true });
    mkdirSync(join(publicDir, "help"), { recursive: true });
    writeFileSync(join(publicDir, "manifest.json"), "{}");
    writeFileSync(join(publicDir, "help", "page.md"), "help");
    writeFileSync(join(publicDir, "engine", "verticopolis_engine.js"), "player");
    writeFileSync(join(publicDir, "engine", "player-only.txt"), "x");
    // A file whose name starts with the engine folder's name is not the folder.
    writeFileSync(join(publicDir, "engine-notes.txt"), "kept");
    const tooling = join(dir, "pkg-web-tooling");
    mkdirSync(tooling);
    writeFileSync(join(tooling, "verticopolis_engine.js"), "tooling");
    writeFileSync(join(tooling, "BUILD.json"), "{}");
    return { publicDir, tooling, out: join(dir, "out") };
  }

  it("copies the public folder with its engine folder replaced by the tooling package", () => {
    const { publicDir, tooling, out } = tree();
    expect(assembleToolingPublicDir(publicDir, tooling, out)).toBe(out);
    expect(readFileSync(join(out, "manifest.json"), "utf8")).toBe("{}");
    expect(readFileSync(join(out, "help", "page.md"), "utf8")).toBe("help");
    expect(readFileSync(join(out, "engine-notes.txt"), "utf8")).toBe("kept");
    expect(readFileSync(join(out, "engine", "verticopolis_engine.js"), "utf8")).toBe("tooling");
    expect(existsSync(join(out, "engine", "player-only.txt"))).toBe(false);
    // The source folder is left as it was.
    expect(readFileSync(join(publicDir, "engine", "verticopolis_engine.js"), "utf8")).toBe("player");
  });

  it("rebuilds the copy from scratch, so nothing from an earlier run survives", () => {
    const { publicDir, tooling, out } = tree();
    assembleToolingPublicDir(publicDir, tooling, out);
    writeFileSync(join(out, "engine", "stale.wasm"), "old");
    writeFileSync(join(out, "stale.txt"), "old");
    assembleToolingPublicDir(publicDir, tooling, out);
    expect(existsSync(join(out, "engine", "stale.wasm"))).toBe(false);
    expect(existsSync(join(out, "stale.txt"))).toBe(false);
  });

  it("reads a folder as an engine package only when it holds BUILD.json", () => {
    const { publicDir, tooling } = tree();
    expect(hasEnginePackage(tooling)).toBe(true);
    expect(hasEnginePackage(join(publicDir, "engine"))).toBe(false);
    expect(hasEnginePackage(join(dir, "missing"))).toBe(false);
  });
});

describe("toolingEngineFile", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function pkg(): string {
    dir = mkdtempSync(join(tmpdir(), "vc-tooling-serve-"));
    const p = join(dir, "pkg-web-tooling");
    mkdirSync(join(p, "nested"), { recursive: true });
    for (const f of ["verticopolis_engine.js", "verticopolis_engine_bg.wasm", "BUILD.json"]) writeFileSync(join(p, f), f);
    writeFileSync(join(dir, "secret.json"), "{}");
    return p;
  }

  it("answers the engine's files with their content types", () => {
    const p = pkg();
    expect(toolingEngineFile("/engine/verticopolis_engine.js", "/", p)).toEqual({ file: join(p, "verticopolis_engine.js"), type: "text/javascript" });
    expect(toolingEngineFile("/engine/verticopolis_engine_bg.wasm", "/", p)).toEqual({ file: join(p, "verticopolis_engine_bg.wasm"), type: "application/wasm" });
    expect(toolingEngineFile("/app/engine/BUILD.json", "/app/", p)).toEqual({ file: join(p, "BUILD.json"), type: "application/json" });
  });

  it("leaves every other request to Vite", () => {
    const p = pkg();
    for (const path of ["/main.ts", "/engine/", "/engine/missing.js", "/engine/nested", "/engine/../secret.json", "/engine/%2e%2e%2fsecret.json", "/engine/nested/x.js", "/assets/engine/verticopolis_engine.js", "/engine/verticopolis_engine.d.ts.map", "/engine/%E0%A4%A"]) {
      expect(toolingEngineFile(path, "/", p), path).toBeNull();
    }
  });
});
