import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("draw planes", () => {
  it("every scene actor takes its z from the shared table", () => {
    const dir = join(__dirname, "excalibur");
    const literal: string[] = [];
    for (const f of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
      if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
      readFileSync(join(dir, f), "utf8")
        .split("\n")
        .forEach((line, i) => {
          // A z set from a number: `z: 3`, `z: .5`, `.z = -1`, `.z += 1`, or
          // the box-actor helper's z argument.
          if (/\bz: *-?[\d.]|\.z *[-+]?= *-?[\d.]|, *-?[\d.][\d.]*, *(cv|gfx)\)/.test(line)) literal.push(`${f}:${i + 1}`);
        });
    }
    expect(literal).toEqual([]);
  });
});
