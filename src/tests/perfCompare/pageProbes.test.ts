import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { publishBootState, typescriptBoot } from "../../wasmhost/engineBoot";
import { installEngineBootProbe, installProbes } from "./page";

type ProbedWindow = { __perfMarks: Record<string, number>; __vcEngineBoot?: unknown };

describe("installEngineBootProbe", () => {
  it("leaves the shared probes as they were, so perf:worker pages get no engine-boot accessor", () => {
    installProbes();
    expect(Object.getOwnPropertyDescriptor(window, "__vcEngineBoot")).toBeUndefined();
  });

  it("stamps the first time boot publishes its engine state and keeps the state readable (#1254)", () => {
    installProbes();
    installEngineBootProbe();
    const w = window as unknown as ProbedWindow;
    expect(w.__perfMarks.engineLoaded).toBeUndefined();
    const first = typescriptBoot().state;
    publishBootState(first);
    const at = w.__perfMarks.engineLoaded;
    expect(typeof at).toBe("number");
    expect(w.__vcEngineBoot).toBe(first);
    // A later publish (a fallback, a latched writer) replaces the state and keeps the mark.
    const later = { ...first, writerLatched: true as const };
    publishBootState(later);
    expect(w.__vcEngineBoot).toBe(later);
    expect(w.__perfMarks.engineLoaded).toBe(at);
  });
});

describe("the boot point the engine-loaded mark stamps (#1254)", () => {
  // The split rows read as the package load and as the app's creation plus
  // the host attach only while boot's first publish sits after the engine
  // load and before the app is created. A change to that order (an early
  // package entry, an overlapped app creation) fails here, so the rows are
  // re-read before a BEFORE/AFTER pair spans it.
  const read = (path: string) => readFileSync(join(__dirname, "../..", path), "utf8").replace(/\r\n/g, "\n");

  it("is the first publish in bootstrap.ts, after the engine package loads and before the app is created", () => {
    const src = read("bootstrap.ts");
    const load = src.indexOf("await loadBootEngine(");
    const publish = src.indexOf("publishBootState(");
    const create = src.indexOf("create(tower)");
    expect(load).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(load);
    expect(create).toBeGreaterThan(publish);
  });

  it("is written only by publishBootState, which only bootstrap.ts calls", () => {
    const files = (readdirSync(join(__dirname, "../.."), { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.split(/[\\/]/).includes("tests"));
    const writers = files.filter((f) => /__vcEngineBoot\s*=[^=]/.test(read(f)));
    const callers = files.filter((f) => read(f).includes("publishBootState("));
    expect(writers.map((f) => f.replace(/\\/g, "/"))).toEqual(["wasmhost/engineBoot.ts"]);
    expect(callers.map((f) => f.replace(/\\/g, "/")).sort()).toEqual(["bootstrap.ts", "wasmhost/engineBoot.ts"]);
  });
});
