/**
 * Derive a conformance fixture from an existing save by editing a few fields
 * of the serialized game and nothing else, so a scenario can start from a
 * state no real save reaches. Usage:
 *   npx tsx scripts/derive-fixture.ts <source.vctower> <target.vctower> '<json patch>'
 * The patch is a flat object merged over the top level of the save (a key
 * set to null is deleted). Say what was edited in the scenario description.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { deflate } from "../src/storage/saveCompression";
import { decodeVctower } from "../src/storage/vctowerContainer";

const [src, dst, patchText] = process.argv.slice(2);
if (!src || !dst || !patchText) {
  console.error("usage: derive-fixture <source.vctower> <target.vctower> '<json patch>'");
  process.exit(2);
}
const save = decodeVctower(readFileSync(src, "utf8")) as Record<string, unknown>;
const patch = JSON.parse(patchText) as Record<string, unknown>;
for (const [k, v] of Object.entries(patch)) {
  if (v === null) delete save[k];
  else save[k] = v;
}
const packed = await deflate(new TextEncoder().encode(JSON.stringify(save)));
writeFileSync(dst, `VCTOWER1\n${Buffer.from(packed).toString("base64")}\n`);
console.log(`${dst}: ${Object.keys(patch).join(", ")} edited`);
