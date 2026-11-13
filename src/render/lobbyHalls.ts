/**
 * Lobby halls (#308, #2068): the engine's `lobbyHeights()` quads as the
 * renderer reads them. A hall is a row of lobby tiles of one height on one
 * floor. Each tall hall is one `[floor, x0, x1, height]` run, `x1` its last
 * column; a one-story hall is in none. In Modern two halls of different
 * heights can sit side by side, and the wall between them carries a
 * revolving door, at the column where the right-hand hall starts.
 */

/** One lobby hall taller than one story: `x1` is its last column. */
export interface HallRun {
  readonly floor: number;
  readonly x0: number;
  readonly x1: number;
  readonly height: number;
}

/** Where two lobby halls of different heights meet on a floor. */
export interface HallDoor {
  readonly floor: number;
  /** The first column of the right-hand hall: the wall stands on its left edge. */
  readonly x: number;
  /** The taller hall's height, which the wall rises to. */
  readonly tall: number;
  /** The shorter hall's height, where its ceiling meets the wall. */
  readonly short: number;
  /** Whether the taller hall is the left-hand one. */
  readonly tallOnLeft: boolean;
}

/** The lobby halls taller than one story, read once per structure pass. */
export interface LobbyHalls {
  readonly runs: readonly HallRun[];
  /** The height in stories of the lobby laid on `floor` at column `x`, or 1
   *  where no tall hall covers it. */
  heightAt(floor: number, x: number): number;
}

/** No tall hall anywhere. */
export const NO_TALL_HALLS: LobbyHalls = { runs: [], heightAt: () => 1 };

/** The port's flat `[floor, x0, x1, height, ...]` quads as halls. A floor
 *  holds a few runs at most, so `heightAt` walks that floor's list. */
export function lobbyHalls(quads: ArrayLike<number>): LobbyHalls {
  const runs: HallRun[] = [];
  const byFloor = new Map<number, HallRun[]>();
  for (let i = 0; i + 3 < quads.length; i += 4) {
    const run = { floor: quads[i], x0: quads[i + 1], x1: quads[i + 2], height: quads[i + 3] };
    runs.push(run);
    const list = byFloor.get(run.floor);
    if (list) list.push(run);
    else byFloor.set(run.floor, [run]);
  }
  if (runs.length === 0) return NO_TALL_HALLS;
  return {
    runs,
    heightAt(floor, x) {
      const list = byFloor.get(floor);
      if (!list) return 1;
      for (const r of list) if (r.x0 <= x && x <= r.x1) return r.height;
      return 1;
    },
  };
}

/** Every wall between two lobby halls of different heights, given the
 *  floors' lobby columns (`lobbyAt`) and the halls. Only a tall hall's ends
 *  can meet a hall of another height, so this looks at each run's two ends
 *  alone. Sorted by floor and column, each wall once. */
export function hallDoors(halls: LobbyHalls, lobbyAt: (floor: number, x: number) => boolean): HallDoor[] {
  const doors = new Map<string, HallDoor>();
  const meet = (floor: number, left: number) => {
    const right = left + 1;
    if (!lobbyAt(floor, left) || !lobbyAt(floor, right)) return;
    const a = halls.heightAt(floor, left);
    const b = halls.heightAt(floor, right);
    if (a !== b) doors.set(`${floor}:${right}`, { floor, x: right, tall: Math.max(a, b), short: Math.min(a, b), tallOnLeft: a > b });
  };
  for (const r of halls.runs) {
    meet(r.floor, r.x0 - 1);
    meet(r.floor, r.x1);
  }
  return [...doors.values()].sort((p, q) => p.floor - q.floor || p.x - q.x);
}
