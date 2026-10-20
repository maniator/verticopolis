import { createHash, webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { EnginePackageAborted, EnginePackageError } from "./enginePackageCheck";
import { ENGINE_BUILD_RECORD, ENGINE_GLUE, ENGINE_WASM } from "./enginePackageNames";
import { engineBuildRecord, expectedOf } from "./enginePackageRecord";
import { enginePackageUrls, loadEngineModule, type EngineGlue, type LoadEngineOptions } from "./loadEngineModule";

const sha = (d: Uint8Array | string) => createHash("sha256").update(d).digest("hex");
const enc = (s: string) => new TextEncoder().encode(s);
const ORIGIN = "https://game.example";
const GLUE_URL = `${ORIGIN}/engine/${ENGINE_GLUE}`;

const glue = enc("export default async function init() {}\n");
const wasm = new Uint8Array(2048).map((_, i) => (i * 5) & 255);
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

describe("loadEngineModule", () => {
  it("imports the verified glue from a blob and starts it on the verified binary", async () => {
    const h = harness();
    const s = served();
    const loaded = await loadEngineModule(GLUE_URL, opts(h, s));
    expect(loaded.verified).toBe(true);
    expect(loaded.mod).toBe(h.mod);
    // The import is of the blob, never of the served URL again.
    expect(h.imported).toEqual(["blob:test/1"]);
    expect(new Uint8Array(await h.blobs[0].arrayBuffer())).toEqual(glue);
    expect(h.blobs[0].type).toBe("text/javascript");
    expect(h.revoked).toEqual(["blob:test/1"]);
    const arg = h.init.mock.calls[0][0] as { module_or_path: Uint8Array };
    expect(arg.module_or_path).toEqual(wasm);
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

  describe("a development serve", () => {
    it("loads the served glue without the check (the unit tests run as a dev serve)", async () => {
      const h = harness();
      const s = served();
      const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
      try {
        const loaded = await loadEngineModule(GLUE_URL, opts(h, s, { checkInDev: false }));
        expect(loaded.verified).toBe(false);
        expect(h.imported).toEqual([GLUE_URL]);
        expect(h.init).toHaveBeenCalledWith();
        expect(s.calls).toEqual([]);
        expect(info).toHaveBeenCalledWith(expect.stringContaining("development serve"));
      } finally {
        info.mockRestore();
      }
    });
  });
});
