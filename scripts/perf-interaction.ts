/**
 * `npm run perf:interaction`: two tooling builds side by side on a big running
 * tower, driven through scripted scrolling, zooming, dialogs, building and
 * inspecting, with frames, long tasks and slow input recorded. Not a gate.
 * See docs/performance/interaction-benchmark.md.
 *
 *   npm run perf:interaction -- --a ../dist-main --b ../dist-fix
 *   npm run perf:interaction -- --a ../dist-main --b ../dist-fix --quick
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../src/tests/perfInteraction/main";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
main(process.argv.slice(2), repo).then(
  (code) => process.exit(code),
  (e: unknown) => {
    process.stderr.write(`perf:interaction: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    process.exit(2);
  },
);
