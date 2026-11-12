/**
 * Creates or updates every label in `.github/labels.yml` (the Sync labels
 * workflow, or by hand with `gh` signed in). It never deletes a label that is
 * not listed. The reader is `src/build/labelList.ts`.
 *
 *   node scripts/sync-labels.ts [--dry-run]
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { labelSyncArgs, parseLabelList } from "../src/build/labelList.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");
const labels = parseLabelList(readFileSync(resolve(root, ".github/labels.yml"), "utf8"));
for (const label of labels) {
  const args = labelSyncArgs(label);
  if (dryRun) console.log(`gh ${args.map((a) => JSON.stringify(a)).join(" ")}`);
  else execFileSync("gh", args, { stdio: "inherit" });
}
console.log(`${dryRun ? "Would sync" : "Synced"} ${labels.length} labels.`);
