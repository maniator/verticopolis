import type { EnginePortCommands, PortRecord } from "./simport/enginePort";

/**
 * The shared engagement detector (#1090, the analytics packet's section 3,
 * approved 2026-10-29): a page life is engaged the first time either of two
 * things happens, and never again after that.
 *
 * - `command`: the running engine accepts a player's gameplay command. A
 *   refused command does not count.
 * - `play`: 30 seconds of foreground time with the splash and every dialog
 *   closed, in each of which the game clock moved (so a paused game never
 *   counts).
 *
 * It sits above the host and reads only what every engine already answers
 * through the port (a command's done slot, the game clock), so the TypeScript
 * and the Rust engine are judged by the same code at the same points. Page
 * loads, background tabs and zero-second visits never engage.
 */

export const ENGAGED_BY = ["command", "play"] as const;
export type EngagedBy = (typeof ENGAGED_BY)[number];

/** Counted seconds of play before the `play` branch engages. */
export const PLAY_SECONDS = 30;

/** The port commands that count as a player's gameplay: building, transport,
 *  demolishing or selling, rent, cars, schedules, no-rate, an emergency answer
 *  and the exterminator. Naming, the camera, the log and the auto-bridge
 *  preference are not gameplay. */
export const GAMEPLAY_COMMANDS = [
  "buildAt",
  "paintTiles",
  "buildShaft",
  "demolish",
  "demolishTile",
  "changeCars",
  "extendShaft",
  "markStop",
  "expressStops",
  "dropStops",
  "scheduleShaft",
  "stepRent",
  "setRent",
  "rentBatch",
  "noRate",
  "answerChoice",
  "bookExterminator",
] as const satisfies readonly (keyof EnginePortCommands)[];

/** What one second of play is judged on, read at each sample. */
export interface PlaySample {
  /** The tab is in the foreground. */
  visible: boolean;
  /** The splash or a dialog is up. */
  blocked: boolean;
  /** The game clock in minutes since the start. */
  clock: number;
}

export interface EngagementDetector {
  /** A gameplay command's record came back; `done` is its status slot. */
  commandAnswered(done: boolean): void;
  /** One second passed; judge it. */
  sample(s: PlaySample): void;
  readonly engaged: EngagedBy | null;
}

export function createEngagementDetector(onEngaged: (by: EngagedBy) => void): EngagementDetector {
  let engaged: EngagedBy | null = null;
  let counted = 0;
  let lastClock: number | null = null;
  const engage = (by: EngagedBy) => {
    engaged = by;
    onEngaged(by);
  };
  return {
    commandAnswered(done) {
      if (engaged === null && done) engage("command");
    },
    sample({ visible, blocked, clock }) {
      if (engaged !== null) return;
      const clockMoved = lastClock !== null && clock > lastClock;
      lastClock = clock;
      if (visible && !blocked && clockMoved && ++counted >= PLAY_SECONDS) engage("play");
    },
    get engaged() {
      return engaged;
    },
  };
}

/** A command record's status slot, and its value when the engine did it. */
const STATUS_SLOT = 0;
const DONE = 1;

/** Route every gameplay command on `port` past the detector. The port keeps
 *  its identity, so every caller and every later tower swap goes through the
 *  wrapped members; the record is returned untouched. */
export function watchGameplayCommands(port: EnginePortCommands, detector: Pick<EngagementDetector, "commandAnswered">): void {
  const members = port as unknown as Record<string, (...args: unknown[]) => PortRecord>;
  for (const name of GAMEPLAY_COMMANDS) {
    // A port without the member (a test double) has nothing to watch there.
    if (typeof members[name] !== "function") continue;
    const original = members[name].bind(port);
    members[name] = (...args) => {
      const rec = original(...args);
      // The analytics never cost the player a command.
      try {
        detector.commandAnswered(rec[STATUS_SLOT] === DONE);
      } catch (e) {
        console.error("[engagement] could not read a command's answer:", e);
      }
      return rec;
    };
  }
}
