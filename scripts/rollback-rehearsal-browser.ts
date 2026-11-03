/**
 * The browser half of the #1221 rollback rehearsal. It works against any
 * origin that serves a production build: a local `npm run preview` of each
 * build for the dry run, or the real deployment for the live rehearsal. A
 * persistent profile folder keeps the origin's storage (and its service worker)
 * between the phases, which is what a player's browser does across a rollback.
 *
 * - `seed` writes candidate-written saves into the origin's local storage in
 *   the exact form the game stores them (`VCZ1:` and the base64 of the raw
 *   deflate of the stamped save), in the autosave key and the three slots.
 * - `verify` opens the origin as the build that is deployed now, reads what the
 *   title screen's tower picker shows for each stored tower, and optionally
 *   continues into the game for a while, then diffs the stored saves against
 *   the seeded ones: a field the running build dropped from a save it rewrote
 *   is a loss.
 *
 * Node only and ERASABLE (see screenshot-env.ts). The engine layer is
 * `rollback-rehearsal.ts`; the procedure is
 * `_bmad-output/planning-artifacts/release-3.0-rollback-rehearsal.md`.
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { AUTO_KEY, SLOT_KEYS, UNREADABLE_KEY, decodeStored, expectedRow, readSeeds, rowMatches, storedForm } from "../src/build/rollbackRehearsalStore.ts";
import { diffSaves, judgeDiffs, type AllowedLoss, type DiffEntry } from "../src/build/rollbackRehearsal.ts";

const BOOT_TIMEOUT_MS = 60_000;
/** The autosave timer ticks every 30 s from page load and skips ticks while the title screen is up, so a verify that plays allows two ticks. */
export const AUTOSAVE_WAIT_SECONDS = 65;
const POLL_MS = 2000;


export interface BrowserOptions {
  origin: string;
  profile: string;
  headed?: boolean;
}

async function open(opts: BrowserOptions): Promise<{ context: BrowserContext; page: Page }> {
  const executablePath = process.env.PW_CHROMIUM_PATH;
  const context = await chromium.launchPersistentContext(opts.profile, {
    headless: !opts.headed,
    locale: "en-US",
    viewport: { width: 1280, height: 720 },
    ...(executablePath ? { executablePath } : {}),
  });
  const page = context.pages()[0] ?? (await context.newPage());
  return { context, page };
}

interface BootState {
  engine?: string;
  failure?: unknown;
}

async function boot(page: Page, origin: string): Promise<{ state: BootState; build: Record<string, unknown> }> {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean((window as unknown as { __vcEngineBoot?: unknown }).__vcEngineBoot), undefined, { timeout: BOOT_TIMEOUT_MS });
  const state = await page.evaluate(() => (window as unknown as { __vcEngineBoot: BootState }).__vcEngineBoot);
  const build = await page.evaluate(async () => {
    try {
      return (await (await fetch("version.json", { cache: "no-store" })).json()) as Record<string, unknown>;
    } catch {
      return {};
    }
  });
  return { state: JSON.parse(JSON.stringify(state)) as BootState, build };
}

const SCRIPT_SRC = /<script[^>]*type="module"[^>]*src="([^"]+)"/g;

/** The module scripts the loaded page runs against the ones the origin's own index page names (fetched outside the page, so no service worker answers). */
async function shellCheck(page: Page, origin: string): Promise<{ same: boolean; loaded: string[]; served: string[] }> {
  const name = (src: string): string => src.split("/").pop() ?? src;
  const loaded = (await page.evaluate(() => [...document.querySelectorAll('script[type="module"][src]')].map((s) => s.getAttribute("src") ?? ""))).map(name).sort();
  const html = await (await fetch(origin, { cache: "no-store" })).text();
  const served = [...html.matchAll(SCRIPT_SRC)].map((m) => name(m[1] ?? "")).sort();
  return { same: loaded.length > 0 && loaded.join() === served.join(), loaded, served };
}

export interface SeedReport {
  origin: string;
  build: Record<string, unknown>;
  engine: string | undefined;
  failure: unknown;
  stored: { label: string; key: string; name: string; bytes: number }[];
}

export async function seedProfile(opts: BrowserOptions & { savesDir: string; appVersion: string }): Promise<SeedReport> {
  const seeds = readSeeds(opts.savesDir);
  if (seeds.length === 0) throw new Error(`${opts.savesDir} holds no .json saves; run the engine step first`);
  const { context, page } = await open(opts);
  try {
    const first = await boot(page, opts.origin);
    const now = Date.now();
    const entries = Object.fromEntries(seeds.map((s) => [s.key, storedForm(s.save, opts.appVersion, now)]));
    await page.evaluate((e) => {
      for (const [k, v] of Object.entries(e)) localStorage.setItem(k, v);
    }, entries);
    // A leftover unreadable-save record from an earlier run would make the next verify fail for the wrong reason.
    await page.evaluate((k) => localStorage.removeItem(k), UNREADABLE_KEY);
    // Let the service worker finish installing so the profile looks like a returning visitor's; never wait forever for one.
    await page.evaluate(() => Promise.race([navigator.serviceWorker?.ready.then(() => undefined).catch(() => undefined), new Promise<void>((done) => setTimeout(done, 10_000))]));
    return {
      origin: opts.origin,
      build: first.build,
      engine: first.state.engine,
      failure: first.state.failure,
      stored: seeds.map((s) => ({ label: s.label, key: s.key, name: s.name, bytes: entries[s.key]!.length })),
    };
  } finally {
    await context.close();
  }
}

export interface VerifyRow {
  label: string;
  expected: { name: string; funds: string; day: string };
  shown: string | undefined;
  ok: boolean;
}

export interface VerifyReport {
  ok: boolean;
  origin: string;
  build: Record<string, unknown>;
  engine: string | undefined;
  failure: unknown;
  rows: VerifyRow[];
  unreadableKept: boolean;
  /** The saves whose save stamp moved, so the running build rewrote them (empty when the verify only read). */
  rewrittenLabels: string[];
  /** Top-level fields the running build dropped from a stored save it rewrote (empty when it wrote nothing): a loss, and a failure unless accepted. */
  rewritten: { label: string; unexplained: DiffEntry[]; explained: { entry: DiffEntry; allowed: AllowedLoss }[] }[];
  /**
   * Nested fields that vanished and lists that came back shorter after the rewrite. Play alone causes these (the engine leaves default and
   * empty fields out of a save), so they are for a person to read, not a failure; the engine layer is the field-by-field check.
   */
  toReview: { label: string; entries: DiffEntry[] }[];
  problems: string[];
}

/** A top-level key of the save, as opposed to a path inside a list or an object. */
const isTopLevel = (d: DiffEntry): boolean => !d.path.includes(".") && !d.path.includes("[");

/** A list that came back shorter is a loss too (`diffSaves` words it as a change at the list's path). */
const shrank = (d: DiffEntry): boolean => {
  const lengths = /: (\d+) -> (\d+)$/.exec(d.example);
  return d.kind === "changed" && d.path.endsWith("[] length") && lengths !== null && Number(lengths[2]) < Number(lengths[1]);
};

/** Paths that play always moves, so they are never a loss. */
const PLAY_PATHS = new Set(["minutes", "savedAt", "appVersion"]);

export async function verifyProfile(opts: BrowserOptions & { savesDir: string; playSeconds: number; allowed: readonly AllowedLoss[]; expectSha: string }): Promise<VerifyReport> {
  const seeds = readSeeds(opts.savesDir);
  if (seeds.length === 0) throw new Error(`${opts.savesDir} holds no .json saves; run the engine step first`);
  const problems: string[] = [];
  const { context, page } = await open(opts);
  try {
    const first = await boot(page, opts.origin);
    if (first.state.engine !== "wasm") problems.push(`the engine is ${String(first.state.engine)}, not wasm`);
    // version.json is always fetched fresh, but the shell can come from a service worker still holding the other build: compare the scripts the page loaded with the ones the origin serves now.
    const shell = await shellCheck(page, opts.origin);
    if (!shell.same) problems.push(`the page runs ${shell.loaded.join(", ") || "no module script"} but the origin now serves ${shell.served.join(", ") || "none"}: the service worker has not moved to the served build, so this run tests the wrong build and is void`);
    if (first.state.failure) problems.push(`the engine reported a failure: ${JSON.stringify(first.state.failure)}`);
    // A rollback run is void when the origin still serves another build (CDN or service worker not moved).
    const served = String(first.build.sha ?? "").toLowerCase();
    const wanted = opts.expectSha.toLowerCase();
    // Either may be the shorter form of the commit id.
    if (!(served.startsWith(wanted) || (served.length >= 7 && wanted.startsWith(served)))) problems.push(`the origin serves build ${String(first.build.sha ?? "unknown")}, not the expected ${opts.expectSha}; the run is void`);

    const rows: VerifyRow[] = [];
    // The stamp each stored save carried when this verify began; a later stamp means the running build rewrote it.
    const seedStamps = new Map<string, unknown>();
    // What each stored save holds now: the picker must show this (an earlier phase may have rewritten the autosave), while the loss check below still compares with the seed.
    const heldNow = new Map<string, Record<string, unknown>>();
    for (const s of seeds) {
      const held = decodeStored(await page.evaluate((k) => localStorage.getItem(k), s.key));
      seedStamps.set(s.key, held?.savedAt);
      if (held) heldNow.set(s.key, held);
    }
    const load = page.locator('[data-splash="load"]');
    if (await load.count()) {
      await load.click();
      await page.locator('ul[aria-label="Towers you can load"]').waitFor({ timeout: 10_000 });
      const texts = await page.locator('ul[aria-label="Towers you can load"] .slot').allInnerTexts();
      for (const s of seeds) {
        const expected = expectedRow(heldNow.get(s.key) ?? s.save);
        const shown = texts.find((t) => t.includes(s.label));
        const ok = shown !== undefined && rowMatches(shown, expected);
        rows.push({ label: s.label, expected, shown: shown?.replace(/\s+/g, " "), ok });
        if (!ok) problems.push(`${s.label}: the picker shows ${JSON.stringify(shown ?? null)}, expected ${expected.name}, ${expected.funds}, ${expected.day}`);
      }
      await page.locator('[data-picker="back"]').click().catch(() => undefined);
    } else {
      problems.push("the title screen has no Load Tower button, so the stored towers could not be read from the page");
    }

    // A void run (the wrong build is running) must not play: the wrong build would rewrite the profile's saves.
    const voidRun = problems.length > 0;
    if (opts.playSeconds > 0 && !voidRun) {
      const cont = page.locator('[data-splash="continue"]');
      if (await cont.count()) await cont.click();
      // Wait for the running build to rewrite the autosave (its clock moves), up to the limit.
      const before = decodeStored(await page.evaluate((k) => localStorage.getItem(k), AUTO_KEY))?.savedAt;
      const deadline = Date.now() + opts.playSeconds * 1000;
      while (Date.now() < deadline) {
        await page.waitForTimeout(POLL_MS);
        const raw = await page.evaluate((k) => localStorage.getItem(k), AUTO_KEY);
        if (decodeStored(raw)?.savedAt !== before) break;
      }
    }

    const stored = await page.evaluate(([keys, unreadable]) => ({ saves: Object.fromEntries((keys as string[]).map((k) => [k, localStorage.getItem(k)])), kept: localStorage.getItem(unreadable as string) !== null }), [[AUTO_KEY, ...SLOT_KEYS], UNREADABLE_KEY] as const);
    const rewritten: VerifyReport["rewritten"] = [];
    const rewrittenLabels: string[] = [];
    const toReview: VerifyReport["toReview"] = [];
    for (const s of seeds) {
      const now = decodeStored(stored.saves[s.key] ?? null);
      if (!now) {
        problems.push(`${s.label}: the stored save is no longer readable in the page's storage`);
        continue;
      }
      if (now.savedAt !== seedStamps.get(s.key)) rewrittenLabels.push(s.label);
      const all = diffSaves(s.save, now).filter((d) => (d.kind === "dropped" || shrank(d)) && !PLAY_PATHS.has(d.path));
      const nested = all.filter((d) => !(d.kind === "dropped" && isTopLevel(d)));
      if (nested.length > 0) toReview.push({ label: s.label, entries: nested });
      const judged = judgeDiffs(all.filter((d) => d.kind === "dropped" && isTopLevel(d)), opts.allowed);
      if (judged.unexplained.length + judged.explained.length > 0) rewritten.push({ label: s.label, unexplained: judged.unexplained, explained: judged.explained });
      for (const e of judged.unexplained) problems.push(`${s.label}: the running build dropped \`${e.path}\` (${e.count}), first at ${e.example}`);
    }
    if (opts.playSeconds > 0 && !voidRun && !rewrittenLabels.includes("Auto-save")) problems.push("the build played but did not rewrite the autosave, so the data-loss check did not run on it; play longer or check the autosave");
    if (stored.kept) problems.push("the page moved an autosave to the unreadable slot: the running build could not read it");
    return { ok: problems.length === 0, origin: opts.origin, build: first.build, engine: first.state.engine, failure: first.state.failure, rows, unreadableKept: stored.kept, rewrittenLabels, rewritten, toReview, problems };
  } finally {
    await context.close();
  }
}
