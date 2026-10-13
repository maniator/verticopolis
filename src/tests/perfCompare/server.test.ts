// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cacheControlFor, compressible, pickEncoding, startServer, type PerfServer } from "./server";

describe("server rules", () => {
  it("follows vercel.json's Cache-Control", () => {
    expect(cacheControlFor("/assets/main-A.js")).toBe("public, max-age=31536000, immutable");
    expect(cacheControlFor("/version.json")).toBe("no-store");
    expect(cacheControlFor("/engine/verticopolis_engine_bg.wasm")).toBe("public, max-age=0, must-revalidate");
  });
  it("prefers Brotli, then gzip, and never compresses media", () => {
    expect(pickEncoding("gzip, deflate, br, zstd", ".js")).toBe("br");
    expect(pickEncoding("gzip;q=1.0", ".wasm")).toBe("gzip");
    expect(pickEncoding("identity", ".css")).toBe("identity");
    expect(pickEncoding(undefined, ".js")).toBe("identity");
    expect(pickEncoding("br", ".png")).toBe("identity");
    expect(compressible(".mp3")).toBe(false);
  });
});

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

function get(url: string, headers: Record<string, string> = {}, method = "GET"): Promise<Reply> {
  return new Promise((ok, fail) => {
    const req = request(url, { headers, method }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => ok({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", fail);
    req.end();
  });
}

describe("startServer", () => {
  let dir = "";
  let server: PerfServer;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "vc-serve-"));
    mkdirSync(join(dir, "engine"));
    writeFileSync(join(dir, "index.html"), "<html>".repeat(100));
    writeFileSync(join(dir, "engine/e.wasm"), Buffer.alloc(4096, 7));
    writeFileSync(join(dir, "sw.js"), "self;");
    server = await startServer(dir);
  });
  afterAll(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves Brotli with isolation and cache headers, and tallies the bytes sent", async () => {
    server.take();
    const r = await get(`${server.url}/`, { "accept-encoding": "br" });
    expect(r.status).toBe(200);
    expect(r.headers["content-encoding"]).toBe("br");
    expect(r.headers["cross-origin-embedder-policy"]).toBe("require-corp");
    expect(r.headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(r.headers["cache-control"]).toBe("public, max-age=0, must-revalidate");
    expect(brotliDecompressSync(r.body).toString()).toBe("<html>".repeat(100));
    const wasm = await get(`${server.url}/engine/e.wasm`, { "accept-encoding": "gzip" });
    expect(wasm.headers["content-type"]).toBe("application/wasm");
    expect(wasm.headers["content-encoding"]).toBe("gzip");
    expect(server.take()).toEqual([
      { path: "/index.html", status: 200, bytes: r.body.length, encoding: "br" },
      { path: "/engine/e.wasm", status: 200, bytes: wasm.body.length, encoding: "gzip" },
    ]);
    expect(server.take()).toEqual([]);
  });

  it("answers a matching ETag with 304 and no body", async () => {
    const first = await get(`${server.url}/sw.js`);
    expect(first.headers["service-worker-allowed"]).toBe("/");
    const again = await get(`${server.url}/sw.js`, { "if-none-match": String(first.headers.etag) });
    expect(again.status).toBe(304);
    expect(again.body.length).toBe(0);
    expect(server.take().pop()).toEqual({ path: "/sw.js", status: 304, bytes: 0, encoding: "identity" });
  });

  it("returns 404 for a missing file and for a path outside the root, and HEAD sends no body", async () => {
    expect((await get(`${server.url}/nope.js`)).status).toBe(404);
    expect((await get(`${server.url}/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
    expect((await get(`${server.url}/engine`)).status).toBe(404);
    // A malformed escape is a 400, never a crash of the run.
    expect((await get(`${server.url}/%E0%A4%A`)).status).toBe(400);
    expect((await get(`${server.url}/`)).status).toBe(200);
    const head = await get(`${server.url}/index.html`, {}, "HEAD");
    expect(head.status).toBe(200);
    expect(server.take().pop()).toMatchObject({ path: "/index.html", bytes: 0, encoding: "identity" });
  });

  it("serves the same root spelled with a trailing separator", async () => {
    const other = await startServer(`${dir}/`);
    try {
      expect((await get(`${other.url}/sw.js`)).status).toBe(200);
    } finally {
      await other.close();
    }
  });

  it("refuses a directory with no build", async () => {
    await expect(startServer(join(dir, "engine"))).rejects.toThrow(/index.html missing/);
  });
});
