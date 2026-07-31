// TEMP scratch: compare the source .vctower against what buildTDT emits.
import { readFileSync } from "node:fs";
import { inflateSync } from "fflate";
import { buildTDT } from "./src/storage/tdtExport";
import { parseTDT } from "./src/storage/tdtParse";

function decodeVctower(path: string) {
  const trimmed = readFileSync(path, "utf8").trim();
  const magic = /^VCTOWER(\d+)/.exec(trimmed)!;
  const b64 = trimmed.slice(magic[0].length).replace(/\s+/g, "");
  return JSON.parse(new TextDecoder().decode(inflateSync(Buffer.from(b64, "base64"))));
}

const save: any = decodeVctower(process.argv[2]);
const t: any = save.tower ?? save;
console.log("=== SOURCE .vctower ===");
console.log("save keys:", Object.keys(save).join(", "));
console.log("tower keys:", Object.keys(t).join(", "));

for (const key of ["transports", "transport", "elevators", "shafts"]) {
  const arr = t[key];
  if (!Array.isArray(arr)) continue;
  console.log(`\n${key}: ${arr.length}`);
  const byKind: Record<string, number> = {};
  for (const x of arr) byKind[x.kind ?? x.type ?? "?"] = (byKind[x.kind ?? x.type ?? "?"] ?? 0) + 1;
  console.log("  by kind:", JSON.stringify(byKind));
  console.log("  sample:", JSON.stringify(arr[0]));
}

const units: any[] = t.units ?? [];
console.log(`\nunits: ${units.length}`);
const uByKind: Record<string, number> = {};
for (const u of units) uByKind[u.kind ?? u.type ?? "?"] = (uByKind[u.kind ?? u.type ?? "?"] ?? 0) + 1;
console.log("  by kind:", JSON.stringify(uByKind));
const burned = units.filter((u: any) => u.burned || u.charred || u.state === "burned" || u.fire || u.damaged);
console.log(`  burned-ish: ${burned.length}`, JSON.stringify(burned.slice(0, 4)));

console.log("\n=== buildTDT ===");
const built: any = buildTDT(save);
console.log("bytes:", built.bytes.length, "report keys:", Object.keys(built.report ?? {}).join(", "));
console.log("staysBehind:", JSON.stringify(built.report?.staysBehind ?? [], null, 1));

console.log("\n=== reparse ===");
const back: any = parseTDT(built.bytes);
console.log("parse keys:", Object.keys(back).join(", "));
const bt: any = back.save?.tower ?? back.tower ?? back.save ?? back;
console.log("back tower keys:", Object.keys(bt ?? {}).join(", "));
for (const key of ["transports", "elevators"]) {
  const arr = bt?.[key];
  if (!Array.isArray(arr)) continue;
  const byKind: Record<string, number> = {};
  for (const x of arr) byKind[x.kind ?? "?"] = (byKind[x.kind ?? "?"] ?? 0) + 1;
  console.log(`back ${key}: ${arr.length}`, JSON.stringify(byKind));
}
const bu: any[] = bt?.units ?? [];
const buKind: Record<string, number> = {};
for (const u of bu) buKind[u.kind ?? "?"] = (buKind[u.kind ?? "?"] ?? 0) + 1;
console.log("back units:", bu.length, JSON.stringify(buKind));
