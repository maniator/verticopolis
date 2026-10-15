import type { BakeResult, Renderer } from "./bake";
import type { StillJob } from "./catalog";
import { compareImages, composeFrame, composeLayered } from "./compose";
import { LayerError, diffLayer, type Image } from "./pixels";
import type { AddedStore, ImageRef } from "./store";

/**
 * The bake's handling of data added to frames that already shipped: a frame's
 * cycles (the cinema's marquee and screen) and the check that they compose.
 * Their images go to the {@link AddedStore}, which the archive packs after
 * every older page.
 */

export type BakedCycles = Record<string, { rate: number; steps: (ImageRef | null)[] }>;

/** The frame's cycles (`StillJob.cycles`): step `k` of each is what changes
 *  from the frame's own paint to that cycle's picture `k`. A cycle whose
 *  pictures all equal the frame (a closed or gutted cinema) is left out, and
 *  so is the field when none is left. */
export function bakeCycles(job: StillJob, base: Image, r: Renderer, added: AddedStore): BakedCycles | undefined {
  let out: BakedCycles | undefined;
  for (const [key, cycle] of Object.entries(job.cycles ?? {})) {
    const steps: (ImageRef | null)[] = [null];
    for (let k = 1; k < cycle.steps.length; k++) {
      const cur = r.render(cycle.steps[k], job.w, job.h);
      steps.push(added.piece(diffLayer(base, cur), cur));
    }
    if (steps.some((s) => s !== null)) (out ??= {})[key] = { rate: cycle.rate, steps };
  }
  return out;
}

/** Recompose every frame that kept cycles at each of its checks
 *  (`StillJob.cycleChecks`), flat and through its depth layers, and require
 *  the frame's own paint at that moment. Throws a LayerError naming the first
 *  that differs. Runs on the finished bake, once every id is final. */
export function checkCycles(result: BakeResult, r: Renderer, jobs: readonly StillJob[]): void {
  const byName = new Map(result.frames.map((f) => [f.name, f]));
  for (const job of jobs) {
    const rec = byName.get(job.name);
    if (!rec?.cycles) continue;
    for (const check of job.cycleChecks ?? []) {
      const want = r.render(check.paint, job.w, job.h);
      const pictures = [composeFrame(result, rec, check.chains, [], check.at)];
      if (rec.layers) pictures.push(composeLayered(result, rec, check.chains, [], false, check.at));
      for (const p of pictures) {
        const cmp = compareImages(want, p);
        if (cmp.mismatches > 0) throw new LayerError(`${job.name}: cycles ${JSON.stringify(check.at)} with chains ${JSON.stringify(check.chains)} miss ${cmp.mismatches} pixels`);
      }
    }
  }
}
