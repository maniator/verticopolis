// The clock moved to `src/shared/` so the web can read dates without importing
// the TypeScript engine. The engine and its tests keep this path.
export { Clock } from "../shared/Clock";
