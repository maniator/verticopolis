/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { HELP_BAR_CHANNEL } from "../src/ui/helpBarProtocol";

/**
 * The Help bar across two hosts (#2035, docs/architecture/help-bar.md). In
 * production the manual is on help.verticopolis.com and the game on
 * verticopolis.com; the bar reaches the game's channel through a frame of the
 * game's host, which joins the game tab's own BroadcastChannel only because
 * the two hosts are the same site. This spec puts the real game on
 * game.test and a manual page on help.game.test (all mapped to the preview
 * server), and checks that a frame of the game's host inside the manual page
 * hears the game, sees its speed, and pauses that tower and no other. A
 * manual page on another site hears nothing, which shows the browser
 * really partitions, so the first test means something.
 *
 * The manual page and its frame are stand-ins served by the test: the
 * e2e build has no help site, and its bridge page answers only its own
 * origin (a production build names help.verticopolis.com). The bridge's own
 * origin checks are unit tests (src/ui/helpBar.test.ts); this spec is about
 * the browser and the real game.
 */

const PORT = 4173;
const GAME = `http://game.test:${PORT}`;
const SAME_SITE_HELP = `http://help.game.test:${PORT}`;
const OTHER_SITE_HELP = `http://help.elsewhere.test:${PORT}`;
const FRAME_URL = `${GAME}/__help-bar-frame.html`;

/**
 * A Chromium that partitions storage as a player's does. Playwright turns
 * partitioning off among its default switches, so this reads that one switch
 * from a launch and gives it back without ThirdPartyStoragePartitioning.
 */
async function partitionedBrowser(): Promise<Browser> {
  const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
  // The full Chromium, not the headless shell Playwright picks by default:
  // the shell ignores the secure-origin switch below, so the game cannot
  // check its engine and never starts.
  const channel = executablePath ? undefined : "chromium";
  const probe = await chromium.launchServer({ executablePath, channel });
  const defaults = probe.process().spawnargs.find((a) => a.startsWith("--disable-features="));
  await probe.close();
  const disabled = defaults ? [defaults.split(",").filter((f) => f !== "ThirdPartyStoragePartitioning").join(",")] : [];
  return chromium.launch({
    executablePath,
    channel,
    ignoreDefaultArgs: defaults ? [defaults] : [],
    args: [
      ...disabled,
      `--host-resolver-rules=MAP game.test 127.0.0.1, MAP help.game.test 127.0.0.1, MAP help.elsewhere.test 127.0.0.1`,
      // The game checks its engine with crypto.subtle, which needs a secure
      // context; plain http to a name other than localhost is not one.
      `--unsafely-treat-insecure-origin-as-secure=${GAME}`,
    ],
  });
}

/** The stand-in bridge: the game's host, framed by a manual page; it passes
 *  the page's requests to the channel and the game's answers back. */
const FRAME = `<!doctype html><script>
  const channel = new BroadcastChannel(${JSON.stringify(HELP_BAR_CHANNEL)});
  addEventListener("message", (ev) => { if (ev.source === parent) channel.postMessage(ev.data); });
  channel.onmessage = (ev) => { if (ev.data && ev.data.game === "status") parent.postMessage(ev.data, "*"); };
  parent.postMessage("ready", "*");
</script>`;

/** The stand-in manual page: it frames the game's host and keeps what the
 *  game says. */
const MANUAL = `<!doctype html><title>Manual</title><script>
  window.heard = [];
  window.ready = new Promise((resolve) => addEventListener("message", (ev) => {
    if (ev.origin !== ${JSON.stringify(GAME)}) return;
    if (ev.data === "ready") resolve();
    else window.heard.push(ev.data);
  }));
  const frame = document.createElement("iframe");
  frame.src = ${JSON.stringify(FRAME_URL)};
  document.documentElement.append(frame);
  window.send = (message) => frame.contentWindow.postMessage(message, ${JSON.stringify(GAME)});
</script>`;

let browser: Browser;
let context: BrowserContext;

test.beforeEach(async () => {
  browser = await partitionedBrowser();
  context = await browser.newContext({ serviceWorkers: "block" });
  await context.route(FRAME_URL, (route) => route.fulfill({ contentType: "text/html", body: FRAME }));
  for (const help of [SAME_SITE_HELP, OTHER_SITE_HELP]) {
    await context.route(`${help}/manual.html`, (route) => route.fulfill({ contentType: "text/html", body: MANUAL }));
  }
});

test.afterEach(async () => {
  await browser.close();
});

async function bootGame(): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${GAME}/`);
  await page.waitForFunction(() => Boolean((window as any).game));
  await page.evaluate(() => document.getElementById("splash")?.remove());
  await page.evaluate(() => (window as any).game.setSpeed(2));
  return page;
}

async function openManual(help: string): Promise<Page> {
  const manual = await context.newPage();
  await manual.goto(`${help}/manual.html`);
  await manual.evaluate(() => (window as any).ready);
  await manual.evaluate(() => (window as any).send({ bar: "hello" }));
  return manual;
}

const speedOf = (page: Page) => page.evaluate(() => (window as any).game.speed as number);
const heardFrom = (manual: Page) => manual.evaluate(() => new Set((window as any).heard.map((s: any) => s.tab)).size);

test("a manual page on the help host hears the game, sees its speed, and pauses that tower alone", async () => {
  const game = await bootGame();
  const other = await bootGame();
  const manual = await openManual(SAME_SITE_HELP);

  // Both game tabs answer the first hello, each with its own tab id.
  await expect.poll(() => heardFrom(manual)).toBe(2);
  const first = await manual.evaluate(() => (window as any).heard[0]);
  expect(first).toMatchObject({ game: "status", speed: 2, heldForHelp: false });
  expect(first.tab).toMatch(/^[0-9a-f]{16}$/);

  // Which tab answered first is the browser's choice; pause that one.
  const chosen = first.tab as string;
  await manual.evaluate((tab) => (window as any).send({ bar: "pause", tab }), chosen);
  await expect
    .poll(() => manual.evaluate((tab) => (window as any).heard.filter((s: any) => s.tab === tab).at(-1), chosen))
    .toMatchObject({ speed: 0, heldForHelp: true });
  // The tab the bar named paused; the other tower still runs.
  const speeds = await Promise.all([speedOf(game), speedOf(other)]);
  expect(speeds.sort()).toEqual([0, 2]);
});

test("a manual page on another site never hears the game", async () => {
  await bootGame();
  const manual = await openManual(OTHER_SITE_HELP);
  // The same frame, the same game tab: only the site differs, and the
  // browser gives the frame a channel of its own.
  await manual.waitForTimeout(2000);
  expect(await heardFrom(manual)).toBe(0);
});
