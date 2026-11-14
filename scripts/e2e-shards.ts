/**
 * Splits the general browser suite across the e2e-general shards by measured
 * time (test.yml). The rules are in `src/tests/ci/e2eShards.ts`.
 *
 *   node scripts/e2e-shards.ts plan <list.json> <shard> <total> <test-list>
 *     <list.json> is Playwright's JSON report of a `--list` run with the
 *     shard's project and filters. Writes this shard's spec files to
 *     <test-list> for `playwright test --test-list`, and prints every shard.
 *
 *   node scripts/e2e-shards.ts measure <log>...
 *     Prints the seconds each spec file took in the given `list` reporter
 *     logs, as JSON. Give it the logs of every shard of one run to refresh
 *     src/tests/ci/e2eShardSeconds.json (rounded to whole seconds).
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  listedFiles,
  measuredSeconds,
  planShards,
} from "../src/tests/ci/e2eShards.ts";

const [command, ...args] = process.argv.slice(2);

function usage(): never {
  console.error(
    "usage: node scripts/e2e-shards.ts plan <list.json> <shard> <total> <test-list>",
  );
  console.error("       node scripts/e2e-shards.ts measure <log>...");
  process.exit(2);
}

if (command === "plan") {
  const [listFile, shardArg, totalArg, outFile] = args;
  if (!listFile || !shardArg || !totalArg || !outFile) usage();
  const shard = Number(shardArg);
  const total = Number(totalArg);
  if (!Number.isInteger(shard) || shard < 1 || shard > total) {
    console.error(
      `the shard must be a whole number from 1 to ${totalArg}, not ${shardArg}`,
    );
    process.exit(2);
  }
  const secondsFile = join(
    dirname(fileURLToPath(import.meta.url)),
    "../src/tests/ci/e2eShardSeconds.json",
  );
  const measured = JSON.parse(readFileSync(secondsFile, "utf8")) as Record<
    string,
    number
  >;
  const files = listedFiles(JSON.parse(readFileSync(listFile, "utf8")));
  const shards = planShards(files, total, measured);
  shards.forEach((planned, index) => {
    const marker = index + 1 === shard ? " (this shard)" : "";
    console.log(
      `shard ${index + 1} of ${total}${marker}: about ${Math.round(planned.seconds)} s, ${planned.files.join(" ")}`,
    );
  });
  const unmeasured = files
    .filter(({ file }) => !(file in measured))
    .map(({ file }) => file);
  if (unmeasured.length > 0) {
    console.log(
      `::notice::no measured time for ${unmeasured.join(", ")}; refresh src/tests/ci/e2eShardSeconds.json`,
    );
  }
  writeFileSync(outFile, `${shards[shard - 1].files.join("\n")}\n`);
} else if (command === "measure") {
  if (args.length === 0) usage();
  const seconds = measuredSeconds(
    args.map((file) => readFileSync(file, "utf8")),
  );
  const rounded = Object.fromEntries(
    Object.entries(seconds)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([file, value]) => [file, Math.round(value)]),
  );
  console.log(JSON.stringify(rounded, null, 2));
} else {
  usage();
}
