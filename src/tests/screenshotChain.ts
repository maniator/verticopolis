/**
 * Run a screenshot scene's shots in order (scripts/screenshots.ts). A chained
 * scene's shots build on one another (`milestones` grows the tower rank by
 * rank), so once one fails the rest would render from whatever state the
 * failure left and, on a pinned-image run, overwrite the committed files with
 * those pictures (#931). After a failure in a chained scene, every later shot
 * is recorded as failed, naming the shot that failed first, and is never
 * taken. An unchained scene keeps going, since its shots stand alone.
 *
 * Lives under src/tests so the unit tier can pin it, and stays ERASABLE (type
 * annotations only) so node runs it directly, like screenshotOnlyFilter.ts.
 */
export async function runSceneShots<S extends { name: string }>(
  shots: readonly S[],
  chained: boolean,
  take: (shot: S) => Promise<void>,
  fail: (shot: S, message: string) => void,
): Promise<void> {
  let firstFailed: string | null = null;
  for (const shot of shots) {
    if (firstFailed !== null) {
      fail(shot, `skipped: this scene's shots build on one another and "${firstFailed}" failed first`);
      continue;
    }
    try {
      await take(shot);
    } catch (e) {
      fail(shot, e instanceof Error ? e.message : String(e));
      if (chained) firstFailed = shot.name;
    }
  }
}
