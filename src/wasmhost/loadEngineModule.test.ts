import { createHash, webcrypto } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { EnginePackageAborted, EnginePackageError } from "./enginePackageCheck";
import { ENGINE_BUILD_RECORD, ENGINE_GLUE, ENGINE_WASM } from "./enginePackageNames";
import { engineBuildRecord, expectedOf } from "./enginePackageRecord";
import { EngineBootError } from "./engineBoot";
import type { BuildMetadataResult } from "./buildSection";
import { compileEngineBytes } from "./engineLoad";
import { loadWasmEngine } from "./rustEngine";
import { enginePackageUrls, loadEngineModule, type EngineGlue, type LoadEngineOptions } from "./loadEngineModule";

const sha = (d: Uint8Array | string) => createHash("sha256").update(d).digest("hex");
const enc = (s: string) => new TextEncoder().encode(s);
const ORIGIN = "https://game.example";
const GLUE_URL = `${ORIGIN}/engine/${ENGINE_GLUE}`;

const glue = enc("export default async function init() {}\n");
/** A module that compiles: the header and one custom section of padding. */
function customModule(payload: Uint8Array): Uint8Array {
  const name = enc("pad");
  const leb = (n: number) => (n < 128 ? [n] : [(n & 127) | 128, n >> 7]);
  const body = [...leb(name.length), ...name, ...payload];
  return new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 0, ...leb(body.length), ...body]);
}
const wasm = customModule(new Uint8Array(2048).map((_, i) => (i * 5) & 255));
const record = engineBuildRecord(glue, wasm, "b".repeat(64), sha);
const expected = expectedOf(record);

function served(over: Record<string, Uint8Array> = {}) {
  const bodies: Record<string, Uint8Array> = {
    [`${ORIGIN}/engine/${ENGINE_BUILD_RECORD}`]: enc(JSON.stringify(record)),
    [GLUE_URL]: glue,
    [`${ORIGIN}/engine/${ENGINE_WASM}`]: wasm,
    ...over,
  };
  const calls: string[] = [];
  const fetch = (url: string) => {
    calls.push(url);
    const body = bodies[url];
    return Promise.resolve(body ? new Response(new Blob([body as BlobPart])) : new Response("no", { status: 404 }));
  };
  return { fetch, calls };
}

/** A glue module whose init is a spy, and the blob bookkeeping around it. */
function harness() {
  const init = vi.fn<EngineGlue["default"]>(() => Promise.resolve({}));
  const mod: EngineGlue = { default: init };
  const imported: string[] = [];
  const blobs: Blob[] = [];
  const revoked: string[] = [];
  const io = {
    initGlue: vi.fn(async (url: string, o?: { onBuild?: (b: BuildMetadataResult) => void; wasmUrl?: string | URL }) => {
      imported.push(url);
      o?.onBuild?.({ state: "missing" });
      return { mod, exports: {} };
    }),
    importModule: vi.fn((url: string) => {
      imported.push(url);
      return Promise.resolve(mod);
    }),
    objectUrls: {
      createObjectURL: (b: Blob | MediaSource) => {
        blobs.push(b as Blob);
        return `blob:test/${blobs.length}`;
      },
      revokeObjectURL: (u: string) => void revoked.push(u),
    },
  };
  return { init, mod, imported, blobs, revoked, io };
}

function opts(h: ReturnType<typeof harness>, s: ReturnType<typeof served>, over: Partial<LoadEngineOptions> = {}): LoadEngineOptions {
  return {
    expected,
    checkInDev: true,
    fetch: s.fetch as unknown as LoadEngineOptions["fetch"],
    digest: async (bytes) => new Uint8Array(await webcrypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer)),
    controlled: true,
    origin: ORIGIN,
    ...h.io,
    ...over,
  };
}

describe("enginePackageUrls", () => {
  it("names the record and the binary beside the glue", () => {
    expect(enginePackageUrls(GLUE_URL)).toEqual({ glue: GLUE_URL, wasm: `${ORIGIN}/engine/${ENGINE_WASM}`, record: `${ORIGIN}/engine/${ENGINE_BUILD_RECORD}` });
  });
});

// The served package is build output (npm run wasm:build): these checks skip
// without it, as packageHash.test.ts does, and run where the package is built.
const GLUE_FILE = resolve(import.meta.dirname, "../public/engine/verticopolis_engine.js");
describe.skipIf(!existsSync(GLUE_FILE))("the glue the loader imports from a Blob", () => {
  // A Blob URL has no folder, so anything the glue resolves against its own
  // URL would fail or, made absolute, load code nobody hashed.
  const text = existsSync(GLUE_FILE) ? readFileSync(GLUE_FILE, "utf8") : "";

  it("has no imports of its own", () => {
    expect(text).not.toMatch(/^\s*import\b/m);
    expect(text).not.toMatch(/\bimport\s*\(/);
    expect(text).not.toMatch(/^\s*export\b[^\n]*\bfrom\b/m);
  });

  it("reads its own URL only to find the binary when init is given none, which the loader always does", () => {
    const uses = text.match(/.*import\.meta.*/g) ?? [];
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) expect(line).toMatch(/new URL\(\s*['"]verticopolis_engine_bg\.wasm['"]\s*,\s*import\.meta\.url\s*\)/);
  });
});

describe("loadWasmEngine on the verified route", () => {
  it("codes a verified package that lacks what the shell calls as package-mismatch", async () => {
    const h = harness();
    const o = opts(h, served());
    const err = await loadWasmEngine(GLUE_URL, undefined, o).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineBootError);
    expect(err).toMatchObject({ reason: "package-mismatch" });
    expect(h.init).toHaveBeenCalled();
  });

  it("hands the deadline's signal to the loader", async () => {
    const h = harness();
    const ctl = new AbortController();
    ctl.abort();
    const err = await loadWasmEngine(GLUE_URL, ctl.signal, opts(h, served())).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EnginePackageAborted);
    expect(h.io.importModule).not.toHaveBeenCalled();
  });
});

describe("loadEngineModule", () => {
  it("imports the verified glue from a blob and starts it on the verified binary", async () => {
    const h = harness();
    const s = served();
    const compile = vi.fn(compileEngineBytes);
    const loaded = await loadEngineModule(GLUE_URL, opts(h, s, { compile }));
    expect(loaded.verified).toBe(true);
    expect(loaded.mod).toBe(h.mod);
    // The import is of the blob, never of the served URL again.
    expect(h.imported).toEqual(["blob:test/1"]);
    expect(new Uint8Array(await h.blobs[0].arrayBuffer())).toEqual(glue);
    expect(h.blobs[0].type).toBe("text/javascript");
    expect(h.revoked).toEqual(["blob:test/1"]);
    // The module that runs was compiled from the hashed bytes.
    expect(compile.mock.calls[0][0]).toEqual(wasm);
    const arg = h.init.mock.calls[0][0] as { module_or_path: WebAssembly.Module };
    expect(arg.module_or_path).toBe(await compile.mock.results[0].value.then((r: { module: WebAssembly.Module }) => r.module));
    // One request per file, none after the check.
    expect([...s.calls].sort()).toEqual([`${ORIGIN}/engine/${ENGINE_BUILD_RECORD}`, GLUE_URL, `${ORIGIN}/engine/${ENGINE_WASM}`].sort());
  });

  it("returns what init returned, for the linear memory", async () => {
    const h = harness();
    const memory = new WebAssembly.Memory({ initial: 1 });
    h.init.mockResolvedValueOnce({ memory });
    const loaded = await loadEngineModule(GLUE_URL, opts(h, served()));
    expect(loaded.exports?.memory).toBe(memory);
  });

  it("refuses a binary from another build and runs nothing", async () => {
    const h = harness();
    const other = new Uint8Array(wasm);
    other[other.length - 1] ^= 0xff;
    const s = served({ [`${ORIGIN}/engine/${ENGINE_WASM}`]: other });
    const err = await loadEngineModule(GLUE_URL, opts(h, s)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EnginePackageError);
    expect((err as EnginePackageError).kind).toBe("mismatch");
    expect(h.io.importModule).not.toHaveBeenCalled();
    expect(h.init).not.toHaveBeenCalled();
    expect(h.blobs).toEqual([]);
  });

  it("refuses a glue from another build", async () => {
    const h = harness();
    const s = served({ [GLUE_URL]: enc("export default async function init() { /* B */ }\n") });
    await expect(loadEngineModule(GLUE_URL, opts(h, s))).rejects.toMatchObject({ kind: "mismatch" });
    expect(h.io.importModule).not.toHaveBeenCalled();
  });

  it("refuses a build that carries no package", async () => {
    const h = harness();
    await expect(loadEngineModule(GLUE_URL, opts(h, served(), { expected: null }))).rejects.toMatchObject({ kind: "load-failed" });
    expect(h.io.importModule).not.toHaveBeenCalled();
  });

  it("refuses where the browser cannot hash", async () => {
    const h = harness();
    await expect(loadEngineModule(GLUE_URL, opts(h, served(), { digest: undefined }))).rejects.toMatchObject({ kind: "unverifiable" });
    expect(h.io.importModule).not.toHaveBeenCalled();
  });

  it("revokes the blob when the import fails, and passes the failure on", async () => {
    const h = harness();
    h.io.importModule.mockRejectedValueOnce(new SyntaxError("bad glue"));
    await expect(loadEngineModule(GLUE_URL, opts(h, served()))).rejects.toThrow("bad glue");
    expect(h.revoked).toEqual(["blob:test/1"]);
    expect(h.init).not.toHaveBeenCalled();
  });

  it("passes an init failure on", async () => {
    const h = harness();
    h.init.mockRejectedValueOnce(new WebAssembly.LinkError("import mismatch"));
    await expect(loadEngineModule(GLUE_URL, opts(h, served()))).rejects.toBeInstanceOf(WebAssembly.LinkError);
  });

  describe("the deadline", () => {
    it("drops the load when it fires during the check, before any import", async () => {
      const h = harness();
      const ctl = new AbortController();
      const s = served();
      const fetch = ((url: string) => {
        ctl.abort();
        return s.fetch(url);
      }) as unknown as LoadEngineOptions["fetch"];
      await expect(loadEngineModule(GLUE_URL, opts(h, s, { signal: ctl.signal, fetch }))).rejects.toBeInstanceOf(EnginePackageAborted);
      expect(h.io.importModule).not.toHaveBeenCalled();
      expect(h.init).not.toHaveBeenCalled();
    });

    it("drops a module whose import settles after it, without starting it, and revokes the blob", async () => {
      const h = harness();
      const ctl = new AbortController();
      let settle!: () => void;
      h.io.importModule.mockImplementationOnce(
        () =>
          new Promise<EngineGlue>((done) => {
            settle = () => done(h.mod);
          }),
      );
      const pending = loadEngineModule(GLUE_URL, opts(h, served(), { signal: ctl.signal }));
      const result = pending.catch((e: unknown) => e);
      await vi.waitFor(() => expect(h.io.importModule).toHaveBeenCalled());
      ctl.abort();
      settle();
      expect(await result).toBeInstanceOf(EnginePackageAborted);
      expect(h.init).not.toHaveBeenCalled();
      expect(h.revoked).toEqual(["blob:test/1"]);
    });

    it("drops an engine whose init settles after it", async () => {
      const h = harness();
      const ctl = new AbortController();
      let settle!: () => void;
      h.init.mockImplementationOnce(
        () =>
          new Promise((done) => {
            settle = () => done({});
          }),
      );
      const result = loadEngineModule(GLUE_URL, opts(h, served(), { signal: ctl.signal })).catch((e: unknown) => e);
      await vi.waitFor(() => expect(h.init).toHaveBeenCalled());
      ctl.abort();
      settle();
      expect(await result).toBeInstanceOf(EnginePackageAborted);
    });

    it("observes an init that rejects after it, so nothing is left unhandled", async () => {
      const h = harness();
      const ctl = new AbortController();
      let fail!: (e: Error) => void;
      h.init.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            fail = reject;
          }),
      );
      const unhandled = vi.fn();
      process.on("unhandledRejection", unhandled);
      try {
        const result = loadEngineModule(GLUE_URL, opts(h, served(), { signal: ctl.signal })).catch((e: unknown) => e);
        await vi.waitFor(() => expect(h.init).toHaveBeenCalled());
        ctl.abort();
        fail(new Error("late trap"));
        expect(await result).toMatchObject({ message: "late trap" });
        await new Promise((r) => setTimeout(r, 0));
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off("unhandledRejection", unhandled);
      }
    });
  });

  describe("the binary's build section (#963)", () => {
    it("reports it once the verified binary has compiled, before the glue is imported", async () => {
      const h = harness();
      const seen: string[] = [];
      const onBuild = vi.fn((b: BuildMetadataResult) => void seen.push(`build:${b.state}`));
      h.io.importModule.mockImplementationOnce((url: string) => {
        seen.push("import");
        h.imported.push(url);
        return Promise.resolve(h.mod);
      });
      await loadEngineModule(GLUE_URL, opts(h, served(), { onBuild }));
      expect(seen).toEqual(["build:missing", "import"]);
    });

    it("hands the glue the compiled module, not the bytes", async () => {
      const h = harness();
      await loadEngineModule(GLUE_URL, opts(h, served()));
      const arg = h.init.mock.calls[0]?.[0];
      expect(arg?.module_or_path).toBeInstanceOf(WebAssembly.Module);
    });

    it("still reports it when the glue then fails to import", async () => {
      const h = harness();
      const onBuild = vi.fn();
      h.io.importModule.mockRejectedValueOnce(new SyntaxError("bad glue"));
      await expect(loadEngineModule(GLUE_URL, opts(h, served(), { onBuild }))).rejects.toThrow("bad glue");
      expect(onBuild).toHaveBeenCalledWith({ state: "missing" });
    });

    it("does not compile a package the check refused", async () => {
      const h = harness();
      const compile = vi.fn();
      const bad = served({ [`${ORIGIN}/engine/${ENGINE_WASM}`]: customModule(new Uint8Array(2048).fill(9)) });
      await expect(loadEngineModule(GLUE_URL, opts(h, bad, { compile }))).rejects.toBeInstanceOf(EnginePackageError);
      expect(compile).not.toHaveBeenCalled();
    });
  });

  describe("a development serve", () => {
    it("loads the served glue without the check (the unit tests run as a dev serve)", async () => {
      const h = harness();
      const s = served();
      const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
      try {
        const loaded = await loadEngineModule(GLUE_URL, opts(h, s, { checkInDev: false }));
        expect(loaded.verified).toBe(false);
        expect(h.imported).toEqual([GLUE_URL]);
        expect(h.io.initGlue).toHaveBeenCalledWith(GLUE_URL, expect.objectContaining({ wasmUrl: undefined }));
        expect(s.calls).toEqual([]);
        expect(info).toHaveBeenCalledWith(expect.stringContaining("development serve"));
      } finally {
        info.mockRestore();
      }
    });
  });
});
