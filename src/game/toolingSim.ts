import type { EnginePort } from "../simport/enginePort";
import type { PortRenderSim } from "../simport/portRenderSim";
import { newRenderSim } from "./portAccess";
import type { ViewReader } from "../simport/viewReader";
import type { HudSource } from "../ui/uiStatus";
import { ToolingTower, type ToolingEngine } from "./toolingTower";

/**
 * `game.sim` for the tooling harnesses (the screenshot scenes and the e2e
 * specs, which build and inspect towers by hand): a {@link ToolingTower} over
 * the app's Rust engine (#1875 step 4). The tower stays the same object for
 * the app's life and reads the engine the app holds now, so a reference a
 * harness keeps never reads an old tower.
 *
 * A bare edit or a field write reaches the engine as a load of the tower's
 * own save, which the app follows as an edit in place (see
 * {@link followToolingEdit}): when the harness's task ends, before a command
 * or a tick, or at once through {@link syncToolingSim}. A command (`build`,
 * `buildTransport`, `evaluateStar`), a tick and a `money` write run on the
 * engine itself and leave the crowd alone.
 *
 * Dev serves and tooling builds only: production has no harness tower, and
 * its `game.sim` is undefined (`toolingSimAbsent.ts`).
 */

interface ToolingApp {
  readonly enginePort: EnginePort;
  readonly reader: HudSource["reader"] & { update(): void };
  readonly portCodes: HudSource["codes"];
  readonly ui: { lastLogSeq: number; resetLog(src: HudSource): void; update(src: HudSource): void };
  followSwap(follow?: "swap" | "restore"): void;
  /** Draw the engine again after a hand edit reached it as a load
   *  ({@link followToolingEdit}). */
  followEdit(): void;
}

const towers = new WeakMap<ToolingApp, ToolingTower>();

/** The bulletin lines the app's tower logged before its last load, which
 *  numbered the engine's log from nothing (see {@link adoptToolingSim}). */
const earlier = new WeakMap<ToolingApp, LogLine[]>();

/** The app's engine as the tower drives it: the Rust binding, whose tooling
 *  members the port does not declare. */
const engineOf = (app: ToolingApp): ToolingEngine => app.enginePort as unknown as ToolingEngine;

/** The tower the harness reads and edits (see the module doc). */
export function toolingSim(app: ToolingApp): ToolingTower | undefined {
  if (!(import.meta.env.DEV || __TOOLING_BUILD__)) return undefined;
  let tower = towers.get(app);
  if (!tower) {
    tower = new ToolingTower(() => engineOf(app), {
      // The bulletin reads the engine's new lines first: a load numbers the
      // log from nothing, so the next read would skip them.
      beforeLoad: () => {
        app.reader.update();
        app.ui.update({ reader: app.reader, codes: app.portCodes, port: app.enginePort });
        earlier.set(app, [...(earlier.get(app) ?? []), ...linesOf(app.enginePort)]);
      },
      afterLoad: () => app.followEdit(),
      afterCommand: () => app.reader.update(),
    });
    towers.set(app, tower);
  }
  return tower;
}

/** Hand the tower's pending edits to the engine now. */
export function syncToolingSim(app: ToolingApp): void {
  towers.get(app)?.settle();
}

/** Swap in a tower a harness built by hand: the engine loads its save, with
 *  its elevator telemetry and pass memos. `game.sim` itself is loaded again
 *  (a settle point). `keepCamera` follows it as a restore, which keeps the
 *  camera where the player is looking. Either way the engine forgets its undo
 *  steps: they belong to the tower it replaced. */
export function adoptToolingSim(app: ToolingApp, built: ToolingTower, keepCamera: boolean): void {
  if (!(import.meta.env.DEV || __TOOLING_BUILD__)) throw new Error("adoptSim is for tooling builds only");
  if (!(built instanceof ToolingTower)) throw new Error("adoptSim takes a tower from game.sim, game.sim.constructor.newGame or game.sim.constructor.deserialize");
  const port = engineOf(app);
  const from = built.port;
  const live = towers.get(app);
  // The bulletin shows the lines the tower logged since it was made, as the
  // TypeScript tower's did. They are read before any load, which numbers an
  // engine's log from nothing: the engine the harness built the tower on
  // holds them until then. The app's own tower also logged the lines its
  // earlier loads dropped from the engine.
  const lines = [...(built === live ? (earlier.get(app) ?? []) : []), ...linesOf(from as unknown as EnginePort)];
  if (built !== live) {
    // A tower from off the app keeps its edits: its own engine takes them
    // first, so it reads the same after the swap. What the app's tower still
    // had pending belongs to the tower the swap replaces.
    built.settle();
    live?.discard();
  }
  built.loadInto(port, built.saveText(), from);
  app.followSwap(keepCamera ? "restore" : "swap");
  // The app's tower is now the adopted one, and these are its lines so far.
  earlier.set(app, lines);
  app.ui.resetLog({ reader: app.reader, codes: app.portCodes, port: logOf(lines) });
  app.ui.lastLogSeq = app.reader.header.logSeq;
}

/** One bulletin line as the engine's log records it: its fields after the
 *  sequence number, and its text. */
interface LogLine {
  readonly fields: readonly [number, number];
  readonly text: string | undefined;
}

/** The lines an engine has logged, held as they are now. */
function linesOf(port: EnginePort): LogLine[] {
  const rec = port.logAfter(0);
  const lines: LogLine[] = [];
  for (let i = 0; i + 2 < rec.length; i += 3) lines.push({ fields: [rec[i + 1], rec[i + 2]], text: port.logText(rec[i]) });
  return lines;
}

/** Held lines as a log the bulletin reads after a load has numbered the
 *  engine's log from nothing. They are numbered again from 1, in order. */
function logOf(lines: readonly LogLine[]): HudSource["port"] {
  const rec = Float64Array.from(lines.flatMap((line, i) => [i + 1, ...line.fields]));
  // resetLog reads only these two members.
  return { logAfter: () => rec, logText: (seq: number) => lines[seq - 1]?.text } as unknown as HudSource["port"];
}

/** The app after a hand edit reached the Rust engine as a load: the renderer
 *  draws the engine's tower again with the camera kept, and the rest stays as
 *  an edit in place leaves it (the selection, the latches). The load forgets
 *  the engine's undo steps, as every adopted tower does, so the undo trail
 *  starts again after a hand edit. A load numbers the engine's log from
 *  nothing, so the bulletin keeps the lines it shows and its cursor moves to
 *  the engine's count, from which the next line is read. */
export function followToolingEdit(app: {
  readonly enginePort: EnginePort;
  readonly reader: ViewReader;
  renderSim: PortRenderSim;
  readonly engine: { setSim(sim: PortRenderSim, opts?: { keepCamera?: boolean }): void };
  readonly ui: { lastLogSeq: number };
}): void {
  app.reader.update();
  app.renderSim = newRenderSim(app.enginePort, app.reader);
  app.engine.setSim(app.renderSim, { keepCamera: true });
  app.ui.lastLogSeq = app.reader.header.logSeq;
}
