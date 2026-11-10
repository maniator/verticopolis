import type * as tooling from "./toolingSim";

/**
 * The stand-in for `toolingSim.ts` in a production build (`vite.config.ts`
 * swaps it in for every build but a `VC_TOOLING=1` one; a dev serve and
 * Vitest keep the real module). The tooling harnesses' hand-built tower is a
 * TypeScript `Simulation`, so the real module carries the TypeScript engine;
 * swapping it out keeps the engine out of the shipped bundle (#921), which
 * `scripts/verify-engine-bundle.ts` proves. A production build publishes no
 * `window.game` (bootstrap.ts), so nothing asks for the tower: it reads as
 * absent, and a swap or an edit follow-up throws. Same exports as the real
 * module, checked by `toolingSimAbsent.test.ts`.
 */
export const toolingSim: typeof tooling.toolingSim = () => undefined;

export const syncToolingSim: typeof tooling.syncToolingSim = () => {};

export const adoptToolingSim: typeof tooling.adoptToolingSim = () => {
  throw new Error("adoptSim is for tooling builds only");
};

export const followToolingEdit: typeof tooling.followToolingEdit = () => {
  throw new Error("followEdit is for tooling builds only");
};
