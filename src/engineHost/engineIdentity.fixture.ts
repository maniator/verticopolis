/** An engine identity record for tests; the values are made up, not the engine's. */
export const IDENTITY_FIXTURE = {
  schema: 1,
  crate: { name: "example-engine", version: "9.8.7" },
  saveVersion: 7,
  oldestSaveVersion: 1,
  frameLayoutVersion: 2,
  catalogVersion: 3,
  catalogDigests: { classic: "aaaa1111aaaa1111", modern: "bbbb2222bbbb2222" },
  lockDigest: "cccc3333cccc3333",
};
