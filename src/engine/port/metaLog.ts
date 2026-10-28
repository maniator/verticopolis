import { FACILITIES } from "../facilities";
import type { Tower } from "../Tower";
import type { Unit } from "../types";
import { roomSlots, roomUnits } from "../tower/rooms";

/** The most ids the log holds before it drops its older half, as the Rust
 *  engine's (`view/meta.rs`). A reader further behind gets a full listing. */
const LOG_CAP = 4096;

/** The meta revision a tower starts at. */
const FIRST = 1;

/**
 * Unit labels and subtypes for `unitMetaChanged`, the TypeScript side of the
 * Rust engine's meta log (`engine-rs/src/view/meta.rs`). The TypeScript
 * engine writes labels and subtypes in place (a new tenant's name, a reroll),
 * with no setter to log them, but every such write marks its room
 * (`markRoom`, `watchRooms` in `src/engine/tower/rooms.ts`). A pass (`sync`)
 * takes the marked rooms and compares each one's label and subtype with what
 * it last saw, in slot order, so it costs the rooms written since the last
 * pass, not every room (#1389). A change bumps the revision and logs the id,
 * as the Rust setters do. A new room logs nothing, as in Rust. The port's own
 * label and reroll commands log their edit at once (`edited`), which also
 * covers the floor and lobby tiles a pass skips.
 */
export class MetaLog {
  revision = FIRST;
  private floor = FIRST;
  private entries: [number, number][] = [];
  private tower: Tower | undefined;
  /** The rooms the log last walked, and each slot's label and subtype as
   *  it last saw them. */
  private rooms: readonly Unit[] = [];
  private labels: string[] = [];
  private subtypes: (string | undefined)[] = [];

  /** Start a pass over `tower`'s rooms, for `visit` by slot. A new tower
   *  starts the log again, as a load does in the Rust engine; a new room list
   *  (a revision move) carries what was seen by id, and a new room logs
   *  nothing, as a new unit's construction logs nothing in Rust (a reader
   *  takes a new room's text itself). A new list costs one pass over the
   *  rooms, as the list's own rebuild does. */
  private begin(tower: Tower): void {
    const rooms = roomUnits(tower);
    if (tower !== this.tower) {
      this.tower = tower;
      this.revision = FIRST;
      this.floor = FIRST;
      this.entries = [];
      this.rooms = [];
    }
    if (rooms !== this.rooms) {
      const was = new Map<number, number>();
      this.rooms.forEach((u, i) => was.set(u.id, i));
      const labels: string[] = [];
      const subtypes: (string | undefined)[] = [];
      rooms.forEach((u, i) => {
        const j = was.get(u.id);
        labels[i] = j === undefined ? u.label : this.labels[j];
        subtypes[i] = j === undefined ? u.subtype : this.subtypes[j];
      });
      this.rooms = rooms;
      this.labels = labels;
      this.subtypes = subtypes;
    }
  }

  /** Compare the room in `slot` of the last `begin` with what was seen, and
   *  log it when its label or subtype moved. */
  private visit(slot: number, u: Unit): void {
    if (u.label === this.labels[slot] && u.subtype === this.subtypes[slot]) return;
    this.labels[slot] = u.label;
    this.subtypes[slot] = u.subtype;
    this.note(u.id);
  }

  /** A pass: bring the log up to `tower`'s labels and subtypes, given the
   *  units marked since the last pass (`marked`; none for a new tower, whose
   *  baseline is its text as it stands). The changes log in slot order, as a
   *  walk over every room would log them; a marked unit that is not a room
   *  (a tile, or a unit since removed) is skipped. */
  sync(tower: Tower, marked: Iterable<Unit> = []): void {
    this.begin(tower);
    const at = roomSlots(tower);
    const slots: number[] = [];
    for (const u of marked) {
      const slot = at.get(u);
      if (slot !== undefined) slots.push(slot);
    }
    if (slots.length > 1) slots.sort((a, b) => a - b);
    for (const slot of slots) this.visit(slot, this.rooms[slot]);
  }

  /** Log a port command's edit of `u` at once, so it is seen before the next
   *  pass and on a floor or lobby tile, which the passes do not cover.
   *  `label` and `subtype` are `u`'s from before the command; an edit that
   *  changed nothing logs nothing, as in Rust. */
  edited(u: Unit, label: string, subtype: string | undefined): void {
    if (u.label === label && u.subtype === subtype) return;
    this.note(u.id);
    if (!this.tower) return;
    this.begin(this.tower);
    const slot = roomSlots(this.tower).get(u);
    if (slot !== undefined) {
      this.labels[slot] = u.label;
      this.subtypes[slot] = u.subtype;
    }
  }

  private note(id: number): void {
    if (this.entries.length >= LOG_CAP) {
      const drop = this.entries.length / 2;
      this.floor = this.entries[drop - 1][0];
      this.entries.splice(0, drop);
    }
    this.revision++;
    this.entries.push([this.revision, id]);
  }

  /** `[revision, full, ids...]` after `since`: the ids changed after it, each
   *  once, oldest change first, or with `full` 1 every room that carries a
   *  label or subtype of its own, for a `since` the log cannot answer (0, one
   *  this tower never reached, or one older than the log keeps). */
  changed(tower: Tower, since: number): Float64Array {
    const answerable = Number.isSafeInteger(since) && since > 0 && since >= this.floor && since <= this.revision;
    const ids: number[] = [];
    if (answerable) {
      const once = new Set<number>();
      for (const [rev, id] of this.entries) {
        if (rev > since && !once.has(id) && tower.getUnit(id)) {
          once.add(id);
          ids.push(id);
        }
      }
    } else {
      for (const u of tower.units) if (carries(u)) ids.push(u.id);
    }
    return Float64Array.from([this.revision, answerable ? 0 : 1, ...ids]);
  }
}

/** Whether a unit's label differs from its catalog name or it has a subtype. */
const carries = (u: { kind: keyof typeof FACILITIES; label: string; subtype?: string }): boolean =>
  u.label !== FACILITIES[u.kind].name || u.subtype !== undefined;
