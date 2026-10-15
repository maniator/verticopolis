/**
 * The catalog lock: the TypeScript engine's catalog for each mode
 * (`src/engine/catalog.ts`), hashed the conformance way into
 * `conformance/catalog-digests.json`, which the Rust engine checks its own
 * catalog against (`engine-rs/src/catalog.rs` and the referee binary), and
 * the WASM binding's `catalog(mode)` is checked against in
 * `conformanceWasm.integration.test.ts`. A moved digest is a change to a
 * price, a size or a build rule some frontend shows: regenerate it on purpose
 * only, in the same pull request, with
 * `VC_CONFORMANCE_UPDATE=1 npx vitest run --project integration catalog`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { catalogFor } from "../../engine/catalog";
import { ALL_KINDS } from "../../engine/facilities";
import type { GameMode } from "../../engine/types";
import { digest } from "../conformance/canonical";
import { CONFORMANCE_DIR } from "../conformance/scenario";

const LOCK = resolve(CONFORMANCE_DIR, "catalog-digests.json");
const UPDATE = process.env.VC_CONFORMANCE_UPDATE === "1";
if (UPDATE && process.env.CI) throw new Error("VC_CONFORMANCE_UPDATE is a local regeneration switch and never runs in CI");

const MODES: readonly GameMode[] = ["classic", "modern"];

describe("catalog lock", () => {
  it("pins each mode's catalog in conformance/catalog-digests.json", () => {
    const got = Object.fromEntries(MODES.map((mode) => [mode, digest(catalogFor(mode))]));
    if (UPDATE) {
      writeFileSync(LOCK, `${JSON.stringify({ catalogs: got }, null, 2)}\n`);
      return;
    }
    const lock = JSON.parse(readFileSync(LOCK, "utf8")) as { catalogs: Record<string, string> };
    expect(got).toEqual(lock.catalogs);
  });

  // The Rust side serializes every field, `null` included, so a value the
  // TypeScript leaves `undefined` would hash differently on the two sides.
  it("holds no undefined value at any depth", () => {
    const walk = (v: unknown, path: string): void => {
      expect(v, path).not.toBeUndefined();
      if (v !== null && typeof v === "object") for (const [k, child] of Object.entries(v)) walk(child, `${path}.${k}`);
    };
    for (const mode of MODES) walk(catalogFor(mode), mode);
  });

  it("lists every facility kind once, in catalog order", () => {
    for (const mode of MODES) expect(catalogFor(mode).facilities.map((f) => f.key)).toEqual(ALL_KINDS);
  });
});
