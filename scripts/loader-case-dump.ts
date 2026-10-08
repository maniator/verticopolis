/**
 * Print the TypeScript loader's canonical state view for one loader-table
 * case, to diff against what the Rust test writes on a miss
 * (`engine-rs/target/loader-case-<id>.rs.json`). Usage:
 *   npx tsx scripts/loader-case-dump.ts <case-id>
 */
import { readFileSync } from "node:fs";
import { Simulation } from "../src/engine/Simulation";
import type { SerializedGame } from "../src/engine/types";
import { canonicalJson } from "../src/tests/conformance/canonical";
import { stateView } from "../src/tests/conformance/scenario";

const id = process.argv[2];
const table = JSON.parse(readFileSync("conformance/loader-cases.json", "utf8")) as { cases: { id: string; input: unknown }[] };
const c = table.cases.find((x) => x.id === id);
if (!c) {
  console.error(`no case ${id}; ids: ${table.cases.map((x) => x.id).join(", ")}`);
  process.exit(2);
}
console.log(canonicalJson(stateView(Simulation.deserialize(c.input as unknown as SerializedGame))));
