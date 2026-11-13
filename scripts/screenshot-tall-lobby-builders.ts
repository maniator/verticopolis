/**
 * ⚠ BROWSER-INJECTED CODE (same contract as screenshot-tower-builders.ts). The
 * function here is shipped into the page via Playwright `page.evaluate(fn)`,
 * which serializes it with `.toString()`, so it MUST be fully self-contained: no
 * imports, no references to module-scope values or sibling helpers, only its own
 * arguments and browser globals (window, document).
 *
 * Tall lobbies (#308) for the Help site's "Tall lobbies" section
 * (`scripts/scenes/tallLobbies.ts`). It founds the tower through the real
 * New Tower path and builds on the hosted engine with the same calls the build
 * tools make (`setLobbyHeight`, then `buildAt`), so the stills show what a
 * player gets.
 *
 * Keep this file ERASABLE (no enums / namespaces / parameter properties).
 */

/** A tower with a tall ground lobby, bare floors over it, and in Modern a
 *  tall sky lobby. No rooms: a room just placed is still under construction,
 *  which would hide the hall's ceiling. Options come from `window.__vcShotTallLobby`:
 *  `{ mode: "classic" | "modern", ground: 2 | 3, sky?: 2 | 3, flights?: true }`;
 *  `flights` adds a stairway and an escalator out of the ground hall (a
 *  3-star tower, so escalators are unlocked). Fails closed when a lobby does
 *  not rise to the height asked or a flight is refused. */
export function buildTallLobbyTower(): void {
  const w = window as unknown as { game: any; __vcShotTallLobby?: any };
  const g = w.game;
  const opts = w.__vcShotTallLobby ?? {};
  const mode: string = opts.mode ?? "classic";
  const groundHeight: number = opts.ground ?? 3;
  g.saveLoad.newGame(mode);
  const port = g.enginePort;
  if (opts.flights) {
    const save = JSON.parse(port.serialize());
    save.star = 3;
    port.restore(JSON.stringify(save));
  }
  port.setMoney(50_000_000);
  const kind = (k: string): number => g.portCodes.kind(k);
  const W = g.grid.width;
  const cx = Math.floor(W / 2);
  const left = cx - 20;
  const right = cx + 19;
  const row = (k: string, floor: number, lo: number, hi: number): number => {
    let built = 0;
    for (let x = lo; x <= hi; x++) if (port.buildAt(kind(k), floor, x)[0] === 1) built++;
    return built;
  };
  // The founding lot differs by mode, so lay the lobby outward from the
  // center: every later tile connects by touching the first.
  port.setLobbyHeight(groundHeight);
  row("lobby", 1, cx, right);
  for (let x = cx - 1; x >= left; x--) port.buildAt(kind("lobby"), 1, x);
  port.setLobbyHeight(1);
  const top = 1 + groundHeight;
  const lobbyInterval: number = g.getCatalog().world.lobbyInterval;
  const sky: number = opts.sky ?? 0;
  // Floors up to the sky lobby, the sky lobby, then a few floors over it.
  // Each story must sit on the one below, so they go up in order.
  const below = sky ? lobbyInterval - 1 : top + 4;
  for (let f = top; f <= below; f++) row("floor", f, left + 4, right - 4);
  if (sky) {
    port.setLobbyHeight(sky);
    row("lobby", lobbyInterval, left + 4, right - 4);
    port.setLobbyHeight(1);
    for (let f = lobbyInterval + sky; f < lobbyInterval + sky + 3; f++) row("floor", f, left + 4, right - 4);
  }
  if (opts.flights) {
    // A stairway and an escalator from the hall's floor to the story over it.
    for (const [k, x] of [["stairs", cx - 14], ["escalator", cx + 4]] as const) {
      if (port.buildShaft(kind(k), x, 1, 2)[0] !== 1) throw new Error(`the ${k} was refused: ${port.lastReason?.() ?? ""}`);
    }
  }
  g.syncSim?.();
  const heights: number[] = Array.from(port.lobbyHeights());
  const heightOf = (floor: number): number => {
    for (let i = 0; i + 1 < heights.length; i += 2) if (heights[i] === floor) return heights[i + 1];
    return 1;
  };
  if (heightOf(1) !== groundHeight) throw new Error(`the ground lobby rose ${heightOf(1)} stories, not ${groundHeight}`);
  if (sky && heightOf(lobbyInterval) !== sky) throw new Error(`the sky lobby rose ${heightOf(lobbyInterval)} stories, not ${sky}`);
  (window as unknown as { __vcShotTallLobbyAt?: unknown }).__vcShotTallLobbyAt = { cx, sky: sky ? lobbyInterval : 0 };
  g.engine.setCamera(cx, 2, 1.6);
}
