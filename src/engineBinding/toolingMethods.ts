/**
 * The binding's tier 3 ops (`exportTiers.ts`): only the tooling build
 * (`--features tooling`, #1057) exports them, for the test suites and the
 * tooling tower the screenshot and e2e harnesses drive. The player build the
 * game ships leaves them out. `bindingExportTiers.guard.test.ts` keeps this
 * list equal to tier 3, `binding.ts` types it against the declaration, and
 * `scripts/verify-engine-bundle.ts` checks each build's glue against it.
 *
 * Keep this file ERASABLE with no imports: the build scripts import it under
 * plain `node`.
 */
export const TOOLING_METHODS = [
  "setMoney", "setCars", "resizeTransport", "removeUnit", "removeTransport", "startFire",
  "bombThreat", "evaluateStar", "setClock", "setUnitState", "setCustomersIn", "setWeather",
  "clearRetailTallies", "startFireAt", "vacateUnit", "setUnitRent", "advanceClock",
  "seedLoopMemos", "seedElevatorTelemetry", "placeBare", "placeTransportBare",
] as const;
