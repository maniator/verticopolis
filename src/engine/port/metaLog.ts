import { FACILITIES } from "../facilities";
import type { Tower } from "../Tower";
import type { Unit } from "../types";
import { roomUnits } from "../tower/rooms";

/** The most ids the log holds before it drops its older half, as the Rust
 *  engine's (`view/meta.rs`). A reader further behind gets a full listing. */
const LOG_CAP = 4096;

/** The meta revision a tower starts at. */
const FIRST = 1;

/**
 * Unit labels and subtypes for `unitMetaChanged`, the TypeScript side of the
 * Rust engine's meta log (`engine-rs/src/view/meta.rs`). The TypeScript
 * engine writes labels and subtypes in place (a new tenant's name, a reroll),
 * with no setter to log them, so a pass finds the changes by comparing each
 * room's label and subtype with what it last saw. The frame encoder's own
 * walk over the rooms runs that pass (`begin` and `visit`), so a frame walks
 * the rooms once; a listing runs one itself (`sync`). A change bumps the
 * revision and logs the id, as the Rust setters do. A new room logs nothing,
 * as in Rust. The port's own label and reroll commands log their edit at
 * once (`edited`), which also covers the floor and lobby tiles the scan
 * skips.
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

  /** Start a pass over `tower`'s rooms and answer them, for `visit` by slot.
   *  A new tower starts the log again, as a load does in the Rust engine; a
   *  new room list (a revision move) carries what was seen by id, and a new
   *  room logs nothing, as a new unit's construction logs nothing in Rust (a
   *  reader takes a new room's text itself). */
  begin(tower: Tower): readonly Unit[] {
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
    return rooms;
  }

  /** Compare the room in `slot` of the last `begin` with what was seen, and
   *  log it when its label or subtype moved: two string compares, no
   *  allocation, so the frame's own walk over the rooms carries it. */
  visit(slot: number, u: Unit): void {
    if (u.label === this.labels[slot] && u.subtype === this.subtypes[slot]) return;
    this.labels[slot] = u.label;
    this.subtypes[slot] = u.subtype;
    this.note(u.id);
  }

  /** A whole pass: bring the log up to `tower`'s labels and subtypes. */
  sync(tower: Tower): void {
    const rooms = this.begin(tower);
    for (let i = 0; i < rooms.length; i++) this.visit(i, rooms[i]);
  }

  /** Log a port command's edit of `u` at once, so it is seen before the next
   *  pass and on a floor or lobby tile, which the passes do not cover.
   *  `label` and `subtype` are `u`'s from before the command; an edit that
   *  changed nothing logs nothing, as in Rust. */
  edited(u: Unit, label: string, subtype: string | undefined): void {
    if (u.label === label && u.subtype === subtype) return;
    this.note(u.id);
    const slot = this.rooms.indexOf(u);
    if (slot >= 0) {
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
