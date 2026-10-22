/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from "@playwright/test";
import { WASM_ONLY_PROJECT, expectEngineHosted } from "./helpers";
import { INSTANCE_METHODS, STATIC_METHODS } from "../src/dualrun/binding";

/**
 * The wasm-only build (`VC_ENGINE=wasm`; src/build/engineBundle.ts) in a real
 * browser. The Rust/WASM engine is the only engine: no URL or stored choice
 * reaches the TypeScript engine, a package that cannot start stops the game
 * with a message instead of falling back, and the TypeScript step loop is not
 * in the bundle at all. The rest of the suite runs on this build too, on the
 * same project (see playwright.config.ts, `PW_WASM_ONLY=1`).
 */
test.beforeEach(({}, info) => test.skip(info.project.name !== WASM_ONLY_PROJECT, "runs against the wasm-only build (PW_WASM_ONLY=1)"));
test.setTimeout(90_000);

interface BootState {
  build: string;
  engine: string;
  failure: { stage: string; message: string } | null;
}

const bootState = (page: Page) => page.evaluate(() => (window as any).__vcEngineBoot as BootState | undefined);

async function hostedGame(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as any).__vcEngine?.status.hosted && !!(window as any).game, undefined, { timeout: 30_000 });
  await page.evaluate(() => document.getElementById("splash")?.remove());
}

function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}

test.describe("starts on the WASM engine", () => {
  test.afterEach(async ({ page }) => expectEngineHosted(page));

  test("boots on the WASM engine whatever the URL or storage asks for", async ({ page }) => {
    const errors = pageErrors(page);
    // Both of the switchable build's ways to pick the TypeScript engine.
    await page.addInitScript(() => localStorage.setItem("vc.engine", "ts"));
    await page.goto("/?engine=ts");
    await page.waitForFunction(() => !!(window as any).__vcEngine?.status.hosted && !!(window as any).game, undefined, { timeout: 30_000 });
    expect(await bootState(page)).toMatchObject({ build: "wasm-only", engine: "wasm", failure: null });
    await expect(page.locator(".splash-version")).toContainText("Rust engine");
    await page.evaluate(() => document.getElementById("splash")?.remove());
    await page.evaluate(() => (window as any).game.setSpeed(1));
    const before = await page.evaluate(() => (window as any).game.sim.clock.minutes as number);
    await page.waitForFunction((b) => (window as any).game.sim.clock.minutes > b + 5, before, { timeout: 30_000 });
    expect(errors).toEqual([]);
  });

  test("ships no TypeScript step loop: only the engine can advance a tower", async ({ page }) => {
    await page.goto("/");
    await hostedGame(page);
    const result = await page.evaluate(() => {
      const sim = (window as any).game.sim;
      (window as any).game.setSpeed(0);
      const proto = Object.getPrototypeOf(sim);
      const tries: Record<string, string> = {};
      for (const step of ["tick", "advanceStep", "onHour", "onDay", "finishConstruction"]) {
        try {
          proto[step].call(sim, 1);
          tries[step] = "ran";
        } catch (e) {
          tries[step] = (e as Error).name;
        }
      }
      // The hosted instance's own `tick` is the engine's: it still advances.
      const before = sim.clock.minutes;
      sim.tick(30);
      return { tries, advanced: sim.clock.minutes - before };
    });
    for (const step of Object.keys(result.tries)) expect(result.tries[step], step).toBe("StepLoopAbsentError");
    expect(result.advanced).toBe(30);
  });

  test("saves, reloads and replays the same tower deterministically on the engine", async ({ page }) => {
    await page.goto("/");
    await hostedGame(page);
    const setup = await page.evaluate(() => {
      const g = (window as any).game;
      g.setSpeed(0);
      g.sim.money = 1e9;
      const built = [] as boolean[];
      for (let x = 150; x < 175; x++) built.push(g.sim.build("lobby", 1, x).ok);
      for (let f = 2; f <= 3; f++) for (let x = 150; x < 175; x++) built.push(g.sim.build("floor", f, x).ok);
      built.push(g.sim.build("office", 2, 152).ok, g.sim.build("office", 3, 152).ok);
      built.push(g.sim.buildTransport("elevatorStandard", 168, 1, 3).ok);
      g.saveToSlot(1);
      return { built: built.every(Boolean), digest: (window as any).__vcEngine.current().engine.stateDigest() as string };
    });
    expect(setup.built, "the setup tower built").toBe(true);

    // Two runs of the same two days from the same save land on the same state.
    const run = () =>
      page.evaluate(() => {
        const g = (window as any).game;
        g.loadFromSlot(1);
        const engine = () => (window as any).__vcEngine.current().engine;
        const start = engine().stateDigest() as string;
        for (let i = 0; i < 96; i++) g.sim.tick(30);
        return { start, end: engine().stateDigest() as string, minutes: g.sim.clock.minutes as number };
      });
    const first = await run();
    const second = await run();
    expect(first.start).toBe(setup.digest);
    expect(second).toEqual(first);
    expect(first.end).not.toBe(first.start);

    // The save outlives the page: a reload boots the engine again and the slot
    // loads the same state.
    await page.reload();
    await hostedGame(page);
    const reloaded = await page.evaluate(() => {
      const g = (window as any).game;
      g.setSpeed(0);
      g.loadFromSlot(1);
      return (window as any).__vcEngine.current().engine.stateDigest() as string;
    });
    expect(reloaded).toBe(setup.digest);
  });
});

test.describe("never falls back to the TypeScript engine", () => {
  /** The page stopped behind the engine-failure message, with no game and no
   *  host: nothing runs on TypeScript. */
  async function expectStopped(page: Page, stage: string): Promise<string> {
    const failure = page.locator("#engine-failure");
    await expect(failure).toBeVisible({ timeout: 30_000 });
    await expect(failure).toHaveAttribute("data-stage", stage);
    await expect(page.locator("#boot-fallback button:not([data-act])")).toHaveText("Reload");
    const state = await bootState(page);
    expect(state).toMatchObject({ build: "wasm-only", engine: "none", failure: { stage } });
    expect(await page.evaluate(() => ({ game: !!(window as any).game, host: !!(window as any).__vcEngine }))).toEqual({ game: false, host: false });
    return (await failure.textContent()) ?? "";
  }

  test("a missing engine binary stops boot with recovery steps", async ({ page }) => {
    await page.route("**/engine/verticopolis_engine_bg.wasm", (r) => r.fulfill({ status: 404, body: "" }));
    await page.goto("/");
    const text = await expectStopped(page, "load");
    expect(text).toContain("could not start");
    expect(text).toContain("Reload the page to try again");
    // Help cannot open here, so the stop screen carries Copy diagnostics (#963).
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t: string) => ((window as any).__copied = t) }, configurable: true });
    });
    await page.locator('#boot-fallback button[data-act="copy-diagnostics"]').click();
    await expect(page.locator(".engine-failure-copy-status")).toHaveText("Copied.");
    const copied = await page.evaluate(() => (window as any).__copied as string);
    expect(copied).toContain("Failed at: load");
    expect(copied).toContain("Engine in use: none");
    expect(copied).toContain("Build: wasm-only");
  });

  test("a corrupted engine binary stops boot", async ({ page }) => {
    await page.route("**/engine/verticopolis_engine_bg.wasm", (r) =>
      r.fulfill({ status: 200, contentType: "application/wasm", body: Buffer.from("\0asm\x01\0\0\0not a module at all") }),
    );
    await page.goto("/");
    await expectStopped(page, "load");
  });

  test("an engine glue from another build stops boot, refused by the byte check", async ({ page }) => {
    // A glue that would load but lacks the binding's surface, as a glue from a
    // mismatched build would. The shell was built for other bytes, so the
    // package check refuses it before anything is imported.
    await page.route("**/engine/verticopolis_engine.js", (r) =>
      r.fulfill({ status: 200, contentType: "text/javascript", body: "export default async function init() {}\nexport class Engine {}\n" }),
    );
    await page.goto("/");
    const text = await expectStopped(page, "load");
    expect(text).toContain("The engine files do not match this version of the game. The engine was not started.");
    expect(await bootState(page)).toMatchObject({ failure: { reason: "package-mismatch", package: { kind: "mismatch", file: "glue" } } });
  });

  test("an engine that loads but cannot host the first tower stops the game at start", async ({ page }) => {
    // A glue with the whole binding surface (so it passes the binding check)
    // but no catalog, which the host reads before it builds an engine. The
    // byte check would refuse such a file, so it is swapped in after the
    // check, in the Blob the loader imports.
    const methods = INSTANCE_METHODS.map((m) => `Engine.prototype.${m} = function () { throw new Error("stub"); };`).join("\n");
    const statics = STATIC_METHODS.map((m) => `Engine.${m} = function () { throw new Error("stub"); };`).join("\n");
    const glue = `export default async function init() {}\nexport function encodeVctower() { return ""; }\nexport class Engine {}\n${methods}\n${statics}\n`;
    await page.addInitScript((stub) => {
      const create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (obj: Blob | MediaSource) => (obj instanceof Blob && obj.type === "text/javascript" ? create(new Blob([stub], { type: "text/javascript" })) : create(obj));
    }, glue);
    await page.goto("/");
    const failure = page.locator("#engine-failure");
    await expect(failure).toBeVisible({ timeout: 30_000 });
    await expect(failure).toHaveAttribute("data-stage", "start");
    await expect(failure).toContainText("could not start");
    expect(await bootState(page)).toMatchObject({ build: "wasm-only", engine: "none", failure: { stage: "start" } });
    // The app exists (the host refused its tower), but nothing advances it.
    expect(await page.evaluate(() => ({ hosted: !!(window as any).__vcEngine?.status.hosted, speed: (window as any).game?.speed }))).toEqual({ hosted: false, speed: 0 });
  });

  test("a tower the host refuses mid-game stops the game instead of running it on TypeScript", async ({ page }) => {
    await page.goto("/");
    await hostedGame(page);
    await page.evaluate(() => {
      const g = (window as any).game;
      g.setSpeed(1);
      // The host starts a tower from its save, which carries no crowd, so it
      // refuses one that already has people.
      const crowded = g.sim.constructor.newGame(6, "classic");
      crowded.crowd.people.push({ id: 1, seed: 1, state: "toDest", floor: 1, fy: 0, x: 170, floors: [], originFloor: 1, shafts: [], leg: 0, shaftId: null, carIndex: null, destX: 170, wait: 0, tripWait: 0, age: 0, linger: 0 });
      g.adoptSim(crowded);
    });
    const failure = page.locator("#engine-failure");
    await expect(failure).toBeVisible();
    await expect(failure).toHaveAttribute("data-stage", "host");
    await expect(failure).toContainText("continue from your last save");
    expect(await bootState(page)).toMatchObject({ build: "wasm-only", engine: "none", failure: { stage: "host" } });
    const after = await page.evaluate(() => ({ hosted: !!(window as any).__vcEngine?.status.hosted, speed: (window as any).game.speed, minutes: (window as any).game.sim.clock.minutes as number }));
    expect(after).toMatchObject({ hosted: false, speed: 0 });
    // The refused tower never ticks on TypeScript, and the speed keys behind
    // the message cannot restart it.
    await page.keyboard.press("3");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as any).game.speed)).toBe(0);
    expect(await page.evaluate(() => (window as any).game.sim.clock.minutes)).toBe(after.minutes);
  });

  test("an engine that traps mid-game stops the game instead of running it on TypeScript (#874)", async ({ page }) => {
    const errors = pageErrors(page);
    await page.goto("/");
    await hostedGame(page);
    await page.evaluate(() => (window as any).game.setSpeed(1));
    // The real tick runs, then the call traps and every later call on the
    // engine throws, as a poisoned wasm-bindgen object does.
    await page.evaluate(() => {
      const engine = (window as any).__vcEngine.current().engine;
      const proto = Object.getPrototypeOf(engine);
      const real = engine.tick.bind(engine);
      Object.defineProperty(engine, "tick", {
        value: (dt: number) => {
          real(dt);
          for (const key of Object.getOwnPropertyNames(proto)) {
            if (key === "constructor" || typeof Object.getOwnPropertyDescriptor(proto, key)?.value !== "function") continue;
            Object.defineProperty(engine, key, {
              value: () => {
                throw new Error("recursive use of an object detected which would lead to unsafe aliasing in rust");
              },
              configurable: true,
              writable: true,
            });
          }
          throw new WebAssembly.RuntimeError("unreachable");
        },
        configurable: true,
        writable: true,
      });
    });
    const failure = page.locator("#engine-failure");
    await expect(failure).toBeVisible({ timeout: 30_000 });
    await expect(failure).toHaveAttribute("data-stage", "host");
    expect(await bootState(page)).toMatchObject({ build: "wasm-only", engine: "none", failure: { stage: "host" } });
    const after = await page.evaluate(() => {
      const w = window as any;
      const sim = w.game.sim;
      return {
        hosted: !!w.__vcEngine.status.hosted,
        reason: w.__vcEngine.status.lastFallback?.reason,
        speed: w.game.speed,
        minutes: sim.clock.minutes as number,
        // The frozen host's own save, which answers with the restore point.
        hostSave: Object.prototype.hasOwnProperty.call(sim, "serialize"),
        saved: typeof sim.serialize().minutes === "number",
      };
    });
    // Stopped on the engine's last state: a save still answers (the restore
    // point), and no TypeScript tick moves the tower.
    expect(after).toMatchObject({ hosted: false, reason: "trap-tick", speed: 0, hostSave: true, saved: true });
    await page.keyboard.press("3");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as any).game.speed)).toBe(0);
    expect(await page.evaluate(() => (window as any).game.sim.clock.minutes)).toBe(after.minutes);
    // Even a speed set directly moves nothing: the frozen host's guarded tick
    // asks the engine nothing.
    await page.evaluate(() => (window as any).game.setSpeed(3));
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as any).game.sim.clock.minutes)).toBe(after.minutes);
    // The fault is the only error the page reports: a failed fallback report
    // or a failed stop would show here.
    expect(errors.filter((e) => !/the Rust engine failed during a tick: unreachable/.test(e))).toEqual([]);
  });

  /** Install the worker and reload under it, so the engine package is in
   *  the precache, then change the cached binary with `edit`. */
  async function installThen(page: Page, edit: (url: string) => Promise<boolean>): Promise<void> {
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, { timeout: 30_000 });
    const urls = await page.evaluate(async () => {
      const out: string[] = [];
      for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) if (req.url.includes("verticopolis_engine_bg.wasm")) out.push(req.url);
      return out;
    });
    expect(urls.length, "the binary is in the precache").toBeGreaterThan(0);
    for (const url of urls) expect(await edit(url)).toBe(true);
  }

  test("an installed game whose cached engine binary is gone stops offline, never on TypeScript", async ({ page, context }) => {
    await installThen(page, (url) =>
      page.evaluate(async (u) => {
        let gone = false;
        for (const name of await caches.keys()) gone = (await (await caches.open(name)).delete(u)) || gone;
        return gone;
      }, url),
    );
    // The browser's own HTTP cache would still answer the binary; an evicted
    // install has neither. Offline emulation does not reach the service
    // worker's own fetches, so the network is cut for those by a route too.
    await (await context.newCDPSession(page)).send("Network.clearBrowserCache");
    await context.route("**/engine/verticopolis_engine_bg.wasm*", (r) => r.abort("internetdisconnected"));
    await context.setOffline(true);
    await page.reload();
    const text = await expectStopped(page, "load");
    expect(text).toContain("You appear to be offline");
  });

  test("an installed game whose cached engine binary is corrupted stops offline, never on TypeScript", async ({ page, context }) => {
    await installThen(page, (url) =>
      page.evaluate(async (u) => {
        let put = false;
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          if (!(await cache.match(u))) continue;
          await cache.put(u, new Response(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 2, 3]), { headers: { "content-type": "application/wasm" } }));
          put = true;
        }
        return put;
      }, url),
    );
    await context.setOffline(true);
    await page.reload();
    await expectStopped(page, "load");
  });
});
