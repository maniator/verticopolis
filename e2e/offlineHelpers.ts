/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, type Page } from "@playwright/test";
import { AUDIO_ENGINE_CHUNK, AUDIO_RUNTIME_FILES } from "../src/audio/audioAssets";

/**
 * Shared steps for the offline specs (#985): installing the service worker,
 * waiting for the engine, watching for network failures, and checking that
 * today's sounds play. offline.spec.ts runs them in one browser context;
 * offlineColdStart.spec.ts runs them across a browser restart.
 */

export const ENGINE_FILES = ["engine/verticopolis_engine.js", "engine/verticopolis_engine_bg.wasm"];

/** Wait until the page runs on the engine, then lift the title screen. */
export async function hostedGame(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const w = window as unknown as { __vcEngine?: { status: { hosted: boolean } }; game?: { sim: unknown } };
    return !!w.__vcEngine?.status.hosted && !!w.game;
  }, undefined, { timeout: 30_000 });
  await page.evaluate(() => document.getElementById("splash")?.remove());
}

/** The first online visit: it installs the service worker, which precaches
 *  the shell and the engine package. That visit is not controlled by the
 *  worker (no clients.claim, by design: updates wait for the player). */
export async function installWorker(page: Page): Promise<void> {
  await page.goto("/");
  // An install that fails (a precache entry that 404s, say) never activates;
  // say so here, with the worker's state, rather than at the test timeout.
  const ready = await page.evaluate(() =>
    Promise.race([
      navigator.serviceWorker.ready.then(() => true),
      new Promise<boolean>((done) => setTimeout(() => done(false), 25_000)),
    ]),
  );
  if (!ready) {
    const state = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      return { registered: !!r, installing: !!r?.installing, waiting: !!r?.waiting, active: !!r?.active };
    });
    throw new Error(`the service worker never activated: ${JSON.stringify(state)}`);
  }
}

/** Wait for the worker to control the page, and check the engine glue and
 *  binary are in its precache. */
export async function expectControlledWithEngine(page: Page): Promise<void> {
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, { timeout: 30_000 });
  const cached = await page.evaluate(async (files) => {
    const hits = await Promise.all(files.map((f) => caches.match(new URL(f, document.baseURI).href, { ignoreSearch: true })));
    return hits.map((r) => r?.ok ?? false);
  }, ENGINE_FILES);
  expect(cached, "the engine glue and binary are in the service worker's precache").toEqual([true, true]);
}

/** Collect page errors and every request that fails, from now on. Offline,
 *  gameplay must need no network at all (no telemetry, no engine fetch). */
export function watch(page: Page): { errors: string[]; failed: string[] } {
  const seen = { errors: [] as string[], failed: [] as string[] };
  page.on("pageerror", (e) => seen.errors.push(e.message));
  // A request the reload itself cancels (ERR_ABORTED) is the old page going
  // away; anything else that fails offline is a real network dependency.
  page.on("requestfailed", (r) => {
    if (r.failure()?.errorText !== "net::ERR_ABORTED") seen.failed.push(`${r.url()} (${r.failure()?.errorText})`);
  });
  return seen;
}

/** Whether the engine's own save holds a lobby at floor 1, column `x`. */
export function lobbyAt(page: Page, x: number): Promise<boolean> {
  return page.evaluate(
    (at) => (JSON.parse((window as any).__vcEngine.port.serialize()).units as { kind: string; x: number }[]).some((u) => u.kind === "lobby" && u.x === at),
    x,
  );
}

/** Run the clock at speed 1 until the engine's clock moves past where it is
 *  now, then pause. Returns the clock it paused at. */
export async function advanceClock(page: Page): Promise<number> {
  await page.evaluate(() => (window as any).game.setSpeed(1));
  const before = await page.evaluate(() => (window as any).game.sim.clock.minutes as number);
  await page.waitForFunction((b) => (window as any).game.sim.clock.minutes > b + 5, before, { timeout: 30_000 });
  return page.evaluate(() => {
    const g = (window as any).game;
    g.setSpeed(0);
    return g.sim.clock.minutes as number;
  });
}

type AudioResponse = { file: string; ok: boolean; fromSW: boolean };

/** Record every audio fetch from now on: the Tone chunk and the recordings. */
export function recordAudio(page: Page): AudioResponse[] {
  const responses: AudioResponse[] = [];
  page.on("response", (r) => {
    const path = new URL(r.url()).pathname;
    const file = AUDIO_ENGINE_CHUNK.test(path) ? "audio engine chunk" : AUDIO_RUNTIME_FILES.find((f) => path.endsWith(`/${f}`));
    if (file) responses.push({ file, ok: r.ok(), fromSW: r.fromServiceWorker() });
  });
  return responses;
}

/** Every audio file was fetched, each one answered by the service worker. */
export function expectAudioFromWorker(responses: AudioResponse[]): void {
  expect(new Set(responses.map((r) => r.file))).toEqual(new Set(["audio engine chunk", ...AUDIO_RUNTIME_FILES]));
  expect(responses.filter((r) => !r.ok || !r.fromSW), "every audio file is served by the service worker").toEqual([]);
}

/**
 * Today's sounds after the first gesture (#985, criterion 3). The audio is the
 * existing Tone engine: one lazy chunk synthesizes the music and every cue,
 * and the crowd plays the recorded files in src/audio/audioAssets.ts. This
 * reads the engine's own objects through the tooling build's
 * `window.game.audio` (its loaded engine, `impl`) to see that the context
 * runs, the recordings decode, the composed program plays notes and a build
 * at floor 1, column 160 plays its cue. The page must be on a fresh tower with
 * no lobby there yet.
 */
export async function expectSoundsAfterGesture(page: Page): Promise<void> {
  const before = await page.evaluate(() => ({ started: (window as any).game.audio.started, muted: (window as any).game.audio.muted }));
  expect(before, "the game starts no audio before a gesture, and is not muted").toEqual({ started: false, muted: false });

  // The first gesture starts the audio (src/game/inputKeys.ts's kick). A
  // click is a real user activation; a modifier-only key press is not.
  const box = await page.locator("canvas").first().boundingBox();
  expect(box, "the tower canvas is on screen").not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.waitForFunction(() => !!(window as any).game.audio.impl?.started, undefined, { timeout: 30_000 });
  const absentAtStart = await page.evaluate(() => {
    const impl = (window as any).game.audio.impl;
    const probes: Record<string, unknown> = {
      "master.context": impl.master?.context,
      "crowd.voices": impl.crowd?.voices,
      sfx: typeof impl.sfx === "function" ? impl.sfx : undefined,
    };
    return Object.keys(probes).filter((k) => probes[k] === undefined);
  });
  expect(absentAtStart, "the engine objects this test observes exist (renamed in ToneAudioEngine.ts or toneCrowd.ts?)").toEqual([]);
  await page.waitForFunction(() => (window as any).game.audio.impl.master.context.state === "running", undefined, { timeout: 30_000 });
  // The crowd's recordings decode from the cache (the layer stays tone-only,
  // and silent about it, if they never arrive, so wait for them explicitly).
  // `ready` means the talk seed decoded and was masked.
  await page.waitForFunction(() => {
    const voices = (window as any).game.audio.impl.crowd?.voices;
    return !!voices?.ready && !!voices.laughs?.loaded;
  }, undefined, { timeout: 30_000 });

  // Count what the engine plays from here on: the cues it is asked for, and
  // the notes its voices actually trigger (the composed program's voices and
  // the bloop the build cue sounds on).
  const missing = await page.evaluate(() => {
    const impl = (window as any).game.audio.impl;
    const counts = { music: 0, bloop: 0, cues: [] as string[] };
    const absent: string[] = [];
    const spy = (voice: any, name: string, key: "music" | "bloop") => {
      if (typeof voice?.triggerAttackRelease !== "function") return absent.push(name);
      const play = voice.triggerAttackRelease.bind(voice);
      voice.triggerAttackRelease = (...args: unknown[]) => {
        counts[key]++;
        return play(...args);
      };
    };
    spy(impl.arp, "arp", "music");
    spy(impl.bassVoice, "bassVoice", "music");
    spy(impl.hook, "hook", "music");
    spy(impl.sfxVoices?.bloop, "sfxVoices.bloop", "bloop");
    const sfx = impl.sfx.bind(impl);
    impl.sfx = (name: string) => {
      counts.cues.push(name);
      return sfx(name);
    };
    (window as any).__audioCounts = counts;
    return absent;
  });
  expect(missing, "the engine objects this test observes exist (renamed in ToneAudioEngine.ts?)").toEqual([]);
  await page.waitForFunction(() => (window as any).__audioCounts.music > 0, undefined, { timeout: 30_000 });

  expect(await lobbyAt(page, 160), "no lobby at the build spot yet").toBe(false);
  await page.evaluate(async () => {
    const g = (window as any).game;
    // Count only what the build itself plays.
    Object.assign((window as any).__audioCounts, { bloop: 0, cues: [] });
    g.sim.money = 1e9;
    await g.build.tryBuild("lobby", 1, 160); // settles once the cue has played
    (window as any).game.syncSim();
  });
  expect(await lobbyAt(page, 160), "the lobby was built").toBe(true);
  const cue = await page.evaluate(() => ({ ...(window as any).__audioCounts }));
  expect(cue.cues, "the build played its cue").toContain("build");
  expect(cue.cues, "no error cue").not.toContain("error");
  expect(cue.bloop, "the build cue sounded").toBeGreaterThan(0);
}
