// TEMP scratch: how is a burned room represented in our save, and what do we export?
import { readFileSync } from "node:fs";
import { inflateSync } from "fflate";

const t = readFileSync(process.argv[2], "utf8").trim();
const m = /^VCTOWER(\d+)/.exec(t)!;
const j: any = JSON.parse(new TextDecoder().decode(inflateSync(Buffer.from(t.slice(m[0].length).replace(/\s+/g, ""), "base64"))));

const units: any[] = j.units;
const keys = new Set<string>();
for (const u of units) for (const k of Object.keys(u)) keys.add(k);
console.log("all unit keys:", [...keys].join(", "));
console.log("office sample:", JSON.stringify(units.find((u) => u.kind === "office")));

const burned = units.filter((u) => /burn|char|fire|ruin/i.test(JSON.stringify(u)));
console.log(`\nburned-matching units: ${burned.length}`);
for (const u of burned.slice(0, 8)) console.log("  ", JSON.stringify(u));

// Whatever flags exist, show the distinct value sets for non-geometry keys.
const vals: Record<string, Set<string>> = {};
for (const u of units)
  for (const [k, v] of Object.entries(u)) {
    if (["id", "x", "y", "width", "floor", "name", "kind"].includes(k)) continue;
    (vals[k] ??= new Set()).add(JSON.stringify(v));
  }
for (const [k, s] of Object.entries(vals)) console.log(`  ${k}: ${[...s].slice(0, 8).join(" | ")}${s.size > 8 ? ` (+${s.size - 8})` : ""}`);
console.log("\nevents:", JSON.stringify(j.events).slice(0, 600));
