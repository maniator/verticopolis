import type { FacilityKind, GameMode, UnitState, WeatherKind } from "../engine/types";
import type { CalendarKind } from "../engine/calendar";
import type { PersonState } from "../engine/crowd/person";
import type { EnginePort } from "./enginePort";
import type {
  CameraView,
  CrowdView,
  HeaderView,
  PendingChoiceView,
  PersonView,
  SimView,
  StructureRunView,
  TowerView,
  TransportView,
  UnitView,
} from "./view";

/**
 * The shared view reader (facade slice 7, PR 3; contract section 5): the
 * game's `SimView` decoded from either engine's numeric arrays, so the
 * painters and the HUD read one shape whichever engine runs. `update()` reads
 * one frame; call it once per frame before drawing.
 *
 * - The structure (`viewStructure`) is decoded only when the tower revision,
 *   the room count or the engine's generation moves. Rooms keep their object
 *   across a rebuild by id, so a kept entry stays current; `rooms` and
 *   `structure` are new arrays on a rebuild, as `SimView` promises.
 * - The frame (`viewFrame`) patches the rooms whose fields changed, and
 *   rewrites the people and the cars in place: a pool of person objects by
 *   id for the engine's generation, and each shaft's arrays, so a frame
 *   allocates only the header. A `frameSeq` skip (another caller took a
 *   frame, and with it the dirty rooms) makes it take a full frame instead.
 * - Labels and subtypes come from `unitMetaChanged` when the frame's meta
 *   revision moves, and for a room new since the last rebuild from
 *   `unitLabel` and `unitSubtype` (a new unit's construction logs no change).
 * - The pending choice is read when the frame's flag rises, the camera on a
 *   new tower, the tower name per read.
 *
 * It imports no engine at runtime: the layout comes from `viewLayout()`.
 */

type Slots = Record<string, number>;
interface Layout {
  header: Slots;
  headerWidth: number;
  person: Slots;
  personWidth: number;
  unit: Slots;
  unitWidth: number;
  transport: Slots;
  transportFixed: number;
  car: Slots;
  carWidth: number;
  structure: Slots;
  structureWidth: number;
  room: Slots;
  roomWidth: number;
  run: Slots;
  runWidth: number;
  shaft: Slots;
  shaftFixed: number;
  kinds: FacilityKind[];
  names: string[];
  unitStates: UnitState[];
  personStates: PersonState[];
  weather: WeatherKind[];
  modes: GameMode[];
  calendars: CalendarKind[];
}

/** An absent counter crosses as -1. */
const counter = (v: number): number | undefined => (v < 0 ? undefined : v);

class Room implements UnitView {
  state: UnitState = "empty" as UnitState;
  occupants = 0;
  customersIn?: number;
  hotelCustomersIn?: number;
  outForMeal?: number;
  label: string;
  subtype?: string;
  constructor(
    readonly id: number,
    readonly kind: FacilityKind,
    readonly floor: number,
    readonly x: number,
    readonly width: number,
    label: string,
  ) {
    this.label = label;
  }
}

class Shaft implements TransportView {
  cars = 0;
  carPositions: number[] = [];
  carLoad: number[] = [];
  carDir: number[] = [];
  constructor(
    readonly id: number,
    readonly kind: FacilityKind,
    readonly x: number,
    readonly width: number,
    readonly bottom: number,
    readonly top: number,
    readonly skipFloors: number[] | undefined,
  ) {}
}

class Person implements PersonView {
  constructor(readonly id: number) {}
  staff?: boolean;
  seed = 0;
  state = "idle" as PersonState;
  x = 0;
  floor = 0;
  fy = 0;
  wait = 0;
}

/** A run with the frame fields its tiles had at the snapshot. */
interface Run extends StructureRunView {
  fields: number[];
}

/** The first index whose `key(i)` is above `v`, over `n` sorted entries. */
function upper(n: number, key: (i: number) => number, v: number): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (key(mid) <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class ViewReader implements SimView {
  private readonly l: Layout;
  private gen = NaN;
  private revision = NaN;
  private metaRevision = 0;
  private full = true;
  private choiceUp = false;
  private choice: PendingChoiceView | null = null;
  private camera: CameraView | null = null;
  private byId = new Map<number, Room>();
  private shafts: Shaft[] = [];
  private shaftById = new Map<number, Shaft>();
  private runs: Run[] = [];
  /** Rooms under every floor they cover, and runs by floor, sorted by x, for
   *  the point lookups. */
  private roomsByFloor = new Map<number, Room[]>();
  private runsByFloor = new Map<number, Run[]>();
  private floors = { high: 0, low: 0 };
  private tiles: UnitView[] | undefined;
  private readonly people: Person[] = [];
  /** Each person by id, and the frame that last named them. */
  private pool = new Map<number, { person: Person; seen: number }>();
  private seq = NaN;
  private scalars = { mode: "classic" as GameMode, calendar: "canon" as CalendarKind, sceneSeed: 0 };
  /** The header's `unlocked` bitset: bit k set for the kind with code k. */
  private unlockedKinds = 0;
  private readonly kindCodes: ReadonlyMap<FacilityKind, number>;
  rooms: Room[] = [];
  structure: StructureRunView[] = [];
  header!: HeaderView;
  readonly crowd: CrowdView = { people: this.people };
  readonly tower: TowerView;

  /**
   * @param floorsOf a facility's height in floors (the catalog's `floors`).
   *   The frame carries no heights, and `tower.unitAt` answers every story a
   *   room covers, as the tower's own index does.
   */
  constructor(
    private readonly port: EnginePort,
    private readonly floorsOf: (kind: FacilityKind) => number,
  ) {
    this.l = JSON.parse(port.viewLayout()) as Layout;
    this.kindCodes = new Map(this.l.kinds.map((k, i) => [k, i]));
    const lookups = {
      getUnit: (id: number) => this.byId.get(id),
      getTransport: (id: number) => this.shaftById.get(id),
      unitAt: (floor: number, x: number) => this.roomAt(floor, x) ?? this.tileAt(floor, x),
      hasStructure: (floor: number, x: number) => this.runAt(floor, x) !== undefined,
      structureKindAt: (floor: number, x: number) => this.runAt(floor, x)?.kind,
    };
    this.tower = Object.defineProperties(lookups, {
      units: { get: () => (this.tiles ??= this.expand()) },
      transports: { get: () => this.shafts },
      revision: { get: () => this.revision },
      mealOverlayRevision: { get: () => this.header.mealOverlayRevision },
      towerName: { get: () => port.towerName() ?? "" },
      highestFloor: { get: () => this.floors.high },
      lowestFloor: { get: () => this.floors.low },
    }) as unknown as TowerView;
    this.update();
  }

  /** Read the next frame. */
  update(): void {
    const gen = this.port.generation();
    if (gen !== this.gen) {
      this.gen = gen;
      this.revision = NaN;
      this.metaRevision = 0;
      this.full = true;
      this.choiceUp = false;
      this.byId = new Map();
      this.pool = new Map();
      const v = this.port.view();
      this.camera = v === undefined ? null : (JSON.parse(v) as CameraView);
    }
    const h = this.l.header;
    let f = this.port.viewFrame(this.full);
    if (!this.full && f[h.frameSeq] !== this.seq + 1) f = this.port.viewFrame(true);
    this.full = false;
    this.seq = f[h.frameSeq];
    // A rebuild reads the text of every room new to it, so after one that
    // found no room it knew (a new tower) the frame's meta revision is read.
    if (f[h.towerRevision] !== this.revision || f[h.rooms] !== this.rooms.length) {
      if (this.rebuild() && this.metaRevision === 0) this.metaRevision = f[h.metaRevision];
    }
    this.readFrame(f);
    if (f[h.metaRevision] !== this.metaRevision) this.readMeta();
  }

  /** Whether the tower has unlocked `kind` (its star gate, and the
   *  Modern-only kinds in a Classic tower), as of the last update. */
  unlocked(kind: FacilityKind): boolean {
    const code = this.kindCodes.get(kind);
    // The bitset is keyed by kind code and spans up to 53 bits, past what
    // the 32-bit `&` reads, so the bit is read by division.
    return code !== undefined && Math.floor(this.unlockedKinds / 2 ** code) % 2 === 1;
  }

  /** Decode the structure; true when no room was kept from the last one. */
  private rebuild(): boolean {
    const l = this.l;
    const s = this.port.viewStructure();
    const sh = l.structure;
    this.revision = s[sh.revision];
    this.floors = { high: s[sh.highestFloor], low: s[sh.lowestFloor] };
    this.scalars = { mode: l.modes[s[sh.mode]], calendar: l.calendars[s[sh.calendar]], sceneSeed: s[sh.sceneSeed] };
    const old = this.byId;
    let kept = 0;
    this.byId = new Map();
    this.rooms = [];
    this.roomsByFloor = new Map();
    let at = l.structureWidth;
    for (let i = 0; i < s[sh.rooms]; i++, at += l.roomWidth) {
      const id = s[at + l.room.id];
      const kind = l.kinds[s[at + l.room.kind]];
      const floor = s[at + l.room.floor];
      const x = s[at + l.room.x];
      let r = old.get(id);
      if (!r || r.kind !== kind || r.floor !== floor || r.x !== x) {
        r = new Room(id, kind, floor, x, s[at + l.room.width], this.port.unitLabel(id) ?? l.names[s[at + l.room.kind]]);
        r.subtype = this.port.unitSubtype(id);
      } else {
        kept++;
      }
      this.rooms.push(r);
      this.byId.set(id, r);
      // Filed under every story it covers, so a pick on a cinema's or a
      // metro's upper story finds it.
      for (let story = 0; story < this.floorsOf(kind); story++) this.listAt(this.roomsByFloor, floor + story).push(r);
    }
    for (const list of this.roomsByFloor.values()) list.sort((a, b) => a.x - b.x);
    this.runs = [];
    this.structure = [];
    this.runsByFloor = new Map();
    const r = l.run;
    for (let i = 0; i < s[sh.runs]; i++, at += l.runWidth) {
      const run: Run = {
        kind: l.kinds[s[at + r.kind]] as "floor" | "lobby",
        floor: s[at + r.floor],
        x: s[at + r.x],
        width: s[at + r.width],
        count: s[at + r.count],
        fields: [s[at + r.state], s[at + r.occupants], s[at + r.customersIn], s[at + r.hotelCustomersIn], s[at + r.outForMeal]],
      };
      this.runs.push(run);
      this.listAt(this.runsByFloor, run.floor).push(run);
      // `structure` joins runs that split only on the tiles' fields.
      const last = this.structure[this.structure.length - 1] as Run | undefined;
      if (last && last.kind === run.kind && last.floor === run.floor && last.width === run.width && run.x === last.x + last.count * last.width) {
        this.structure[this.structure.length - 1] = { ...last, count: last.count + run.count };
      } else {
        this.structure.push({ kind: run.kind, floor: run.floor, x: run.x, width: run.width, count: run.count });
      }
    }
    const oldShafts = this.shaftById;
    this.shafts = [];
    this.shaftById = new Map();
    const t = l.shaft;
    for (let i = 0; i < s[sh.shafts]; i++) {
      const id = s[at + t.id];
      const skips = s[at + t.skips];
      const skipFloors = skips > 0 ? Array.from(s.subarray(at + l.shaftFixed, at + l.shaftFixed + skips)) : undefined;
      const shaft = new Shaft(id, l.kinds[s[at + t.kind]], s[at + t.x], s[at + t.width], s[at + t.bottom], s[at + t.top], skipFloors);
      const prev = oldShafts.get(id);
      if (prev) Object.assign(shaft, { cars: prev.cars, carPositions: prev.carPositions, carLoad: prev.carLoad, carDir: prev.carDir });
      else shaft.cars = s[at + t.cars];
      this.shafts.push(shaft);
      this.shaftById.set(id, shaft);
      at += l.shaftFixed + skips;
    }
    this.tiles = undefined;
    return kept === 0;
  }

  private listAt<T>(map: Map<number, T[]>, floor: number): T[] {
    let list = map.get(floor);
    if (!list) map.set(floor, (list = []));
    return list;
  }

  private readFrame(f: Float64Array): void {
    const l = this.l;
    const h = l.header;
    const fx = {
      santaSeq: f[h.santaFxSeq],
      vipSeq: f[h.vipFxSeq],
      explosion: { floor: f[h.explosionFxFloor], x: f[h.explosionFxX], seq: f[h.explosionFxSeq] },
      thief: { caught: f[h.thiefFxCaught] === 1, floor: f[h.thiefFxFloor], seq: f[h.thiefFxSeq] },
      treasure: { floor: f[h.treasureFxFloor], x: f[h.treasureFxX], seq: f[h.treasureFxSeq] },
    };
    const up = f[h.pendingChoice] === 1;
    if (up && !this.choiceUp) {
      const text = this.port.pendingChoice();
      this.choice = text === undefined ? null : (JSON.parse(text) as PendingChoiceView);
    } else if (!up) {
      this.choice = null;
    }
    this.choiceUp = up;
    this.unlockedKinds = f[h.unlocked];
    const minutes = f[h.minutes];
    this.header = {
      money: f[h.money],
      star: f[h.star],
      population: f[h.population],
      weather: l.weather[f[h.weather]],
      logSeq: f[h.logSeq],
      pendingChoice: this.choice,
      minutes,
      minuteOfDay: ((minutes % 1440) + 1440) % 1440,
      revision: f[h.towerRevision],
      mealOverlayRevision: f[h.mealOverlayRevision],
      mode: this.scalars.mode,
      modernCalendar: this.scalars.calendar,
      sceneSeed: this.scalars.sceneSeed,
      fx,
      camera: this.camera,
    };
    let at = l.headerWidth;
    const n = f[h.people];
    const p = l.person;
    const seq = this.seq;
    this.people.length = n;
    for (let i = 0; i < n; i++, at += l.personWidth) {
      const id = f[at + p.id];
      let entry = this.pool.get(id);
      if (!entry) this.pool.set(id, (entry = { person: new Person(id), seen: seq }));
      entry.seen = seq;
      const q = (this.people[i] = entry.person);
      q.seed = f[at + p.seed];
      q.staff = f[at + p.staff] === 1 ? true : undefined;
      q.state = l.personStates[f[at + p.state]];
      q.floor = f[at + p.floor];
      q.x = f[at + p.x];
      q.fy = f[at + p.fy];
      q.wait = f[at + p.wait];
    }
    // Anyone the frame no longer names leaves the pool.
    if (this.pool.size > n) for (const [id, e] of this.pool) if (e.seen !== seq) this.pool.delete(id);
    const u = l.unit;
    for (let i = 0; i < f[h.units]; i++, at += l.unitWidth) {
      const r = this.rooms[f[at + u.slot]];
      r.state = l.unitStates[f[at + u.state]];
      r.occupants = f[at + u.occupants];
      r.customersIn = counter(f[at + u.customersIn]);
      r.hotelCustomersIn = counter(f[at + u.hotelCustomersIn]);
      r.outForMeal = counter(f[at + u.outForMeal]);
    }
    const t = l.transport;
    const c = l.car;
    for (let i = 0; i < f[h.transports]; i++) {
      const s = this.shafts[i];
      const cars = f[at + t.cars];
      at += l.transportFixed;
      s.cars = cars;
      s.carPositions.length = s.carLoad.length = s.carDir.length = cars;
      for (let k = 0; k < cars; k++, at += l.carWidth) {
        s.carPositions[k] = f[at + c.position];
        s.carLoad[k] = f[at + c.load];
        s.carDir[k] = f[at + c.direction];
      }
    }
  }

  private readMeta(): void {
    const r = this.port.unitMetaChanged(this.metaRevision);
    this.metaRevision = r[0];
    if (r[1] === 1) {
      // A full listing names only the rooms that carry their own text.
      for (const room of this.rooms) {
        room.label = this.l.names[this.l.kinds.indexOf(room.kind)];
        room.subtype = undefined;
      }
    }
    for (let i = 2; i < r.length; i++) {
      const room = this.byId.get(r[i]);
      if (!room) continue;
      room.label = this.port.unitLabel(room.id) ?? room.label;
      room.subtype = this.port.unitSubtype(room.id);
    }
  }

  private roomAt(floor: number, x: number): Room | undefined {
    const list = this.roomsByFloor.get(floor);
    if (!list) return undefined;
    const i = upper(list.length, (k) => list[k].x, x) - 1;
    const r = list[i];
    return r && x < r.x + r.width ? r : undefined;
  }

  private runAt(floor: number, x: number): Run | undefined {
    const list = this.runsByFloor.get(floor);
    if (!list) return undefined;
    const i = upper(list.length, (k) => list[k].x, x) - 1;
    const r = list[i];
    return r && x < r.x + r.count * r.width ? r : undefined;
  }

  /** A tile as a unit: tiles carry no ids in the view, so `id` is NaN. */
  private tileAt(floor: number, x: number): UnitView | undefined {
    const run = this.runAt(floor, x);
    if (!run) return undefined;
    return this.tile(run, run.x + Math.floor((x - run.x) / run.width) * run.width);
  }

  private tile(run: Run, x: number): UnitView {
    const [state, occupants, customersIn, hotelCustomersIn, outForMeal] = run.fields;
    return {
      id: NaN,
      kind: run.kind,
      floor: run.floor,
      x,
      width: run.width,
      state: this.l.unitStates[state],
      label: this.l.names[this.l.kinds.indexOf(run.kind)],
      occupants,
      customersIn: counter(customersIn),
      hotelCustomersIn: counter(hotelCustomersIn),
      outForMeal: counter(outForMeal),
    };
  }

  /** `tower.units`: the rooms, then every tile, built at most once per
   *  revision and only when read. */
  private expand(): UnitView[] {
    const out: UnitView[] = [...this.rooms];
    for (const run of this.runs) for (let i = 0; i < run.count; i++) out.push(this.tile(run, run.x + i * run.width));
    return out;
  }
}
