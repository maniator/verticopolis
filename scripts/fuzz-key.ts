/** Prints the differential's window key; see src/tests/conformance/fuzzKey.ts. */
import { fuzzKey, fuzzKeyParts } from "../src/tests/conformance/fuzzKey.ts";

const parts = fuzzKeyParts();
const key = fuzzKey(parts);
console.log(process.argv.includes("--parts") ? JSON.stringify({ key, parts }, null, 2) : key);
