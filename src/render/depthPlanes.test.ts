import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("draw planes", () => {
  it("every scene actor takes its z from the shared table", () => {
    const dir = join(__dirname, "excalibur");
    const literal: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
      readFileSync(join(dir, f), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/\bz: *-?\d|\.z *= *-?\d|, *-?\d[\d.]*, *(cv|gfx)\)/.test(line)) literal.push(`${f}:${i + 1}`);
        });
    }
    expect(literal).toEqual([]);
  });
});
