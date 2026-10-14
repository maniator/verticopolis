/**
 * Regenerate `src/engine/gameplayEvents.d.ts` and the runtime rules in
 * `src/engine/gameplayEventRules.ts` from the gameplay event
 * catalog, `conformance/events/catalog.json`, after checking the catalog
 * against its payload rule (closed enums and small integers only):
 *
 *   npm run gen:events
 *
 * `npm run wasm:build` runs it too, beside the binding's own declaration.
 * `src/engine/gameplayCatalog.test.ts` fails while either committed file is
 * stale, so a catalog change, its types and its rules land together.
 */
// copies-package: none
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCatalog, renderGameplayEventRules, renderGameplayEventsDts } from "../src/engine/gameplayCatalog.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = checkCatalog(JSON.parse(readFileSync(resolve(root, "conformance/events/catalog.json"), "utf8")));
writeFileSync(resolve(root, "src/engine/gameplayEvents.d.ts"), renderGameplayEventsDts(catalog));
writeFileSync(resolve(root, "src/engine/gameplayEventRules.ts"), renderGameplayEventRules(catalog));
console.log("src/engine/gameplayEvents.d.ts and gameplayEventRules.ts refreshed from conformance/events/catalog.json");
