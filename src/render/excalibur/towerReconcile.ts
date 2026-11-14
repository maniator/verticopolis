import * as ex from "excalibur";
import { Z } from "../depthPlanes";
import { catalogFacility } from "../../catalog/catalogTypes";
import { towerCatalog } from "../../catalog/towerCatalog";
import { viewWorld } from "../../presentation/viewWorld";
import { isPresent } from "../../shared/unitState";
import type { TransportView, UnitView } from "../../simport/view";
import {
  CRANE_H,
  CRANE_MAST_ANCHOR_X,
  CRANE_MIN_ROOF_TILES,
  CRANE_W,
  craneRoof,
  AWNING_W,
  drawCrane,
  drawTransport,
  ESCAPE_W,
} from "../sprites";
import { facadeGeometry, type FloorEdge } from "../facadeGeometry";
import { setRainShelter } from "./rainShelter";
import { paintAnimatedUnit } from "../regionPaint";
import { FLOOR, TILE, TRANSPORT_BAND_FLOORS } from "../scale";
import { isVenue, venueBox, windingFlights, type VenueBox } from "../venueFlights";
export { emptyFlightPass } from "../venueFlights";
import { isDeadParking, roomSignature } from "./roomSignature";
import { reap } from "./towerCrowd";
import { dropRegionUnit, markRegionUnit } from "./towerRegions";
import { awaitsInitialBake } from "./sceneBake";
import { syncStructureTiles } from "./towerStructTiles";
import { syncScenery } from "./towerScenery";
import type { TowerEngine } from "./TowerEngine";

/**
 * Retained-scene reconciliation (rooms, structure, transports, exterior
 * facade) for {@link TowerEngine}, as friend functions taking the engine
 * instance. Extracted from `TowerEngine.ts`; the class keeps thin delegations.
 * Static construction, baking and the sim-swap / teardown lifecycle live in
 * `towerScene`. Pure code move: no reconciliation or scene-graph logic changed.
 */

// Settled rooms draw through the region compositor (towerRegions.ts, spec
// CAP-2): repaint-in-place at region granularity keeps the old RoomRec law
// (stable textures, no canvas churn: churn once built enough sustained
// memory pressure that phones killed the tab) while the texture population
// drops from one per unit to one per occupied region. Only ANIMATED rooms
// (fire, construction: cache:false, redrawn every frame) still own a private
// per-unit actor, held in engine.animatedRooms.

// ---- Retained-scene reconciliation (no full rebuild) --------------------

export function syncScene(engine: TowerEngine): void {
  const tower = engine.sim.tower;
  // The scenery pass rides the same sync: it no-ops unless the tower revision
  // or the sim identity moved (grass yields to the apron, plants get paved
  // over, a swapped-in tower re-derives its seed-driven skyline and greenery).
  syncScenery(engine);
  // The floor and lobby tiles draw from the layout, the lobby lighting and the
  // sim alone, so the full tile pass runs only when the layout or the sim
  // moved, and a lighting-only flip repaints just the lobby cells. Every other
  // sync (the hour, the meal overlay) skips the tiles, which make up most of a
  // big tower's units, and walks only the rooms the last full pass kept. The
  // unit list identity rides along with the revision: the view rebuilds both
  // together, and a fresh list always walks.
  const rooms = syncStructureTiles(engine);
  // Fresh flood-fill (not cached, it depends on unit state); read ONCE here
  // per sync. A parking space absent from this set is "dead" and gets a red X.
  // The dead-bit joins the room signature, so a connectivity flip triggers a
  // re-bake alongside the existing state/lighting/hour bits, it adds no
  // per-frame work of its own.
  const parkingOK = tower.functionalParkingSet();
  // Garage/waste display fractions, refreshed here (not per frame) and reusing
  // the flood-fill just done, so they're exactly as fresh as the sprite
  // re-bake below and the garage-car motion visibility that reads them.
  engine.displayParkingUse = engine.sim.parkingUsage(parkingOK.size);
  engine.displayRecycleFill = engine.sim.recyclingFill();
  engine.d.parkingUse = engine.displayParkingUse;
  engine.d.recycleFill = engine.displayRecycleFill;
  // Entrance staff read as ghosts in a tower nobody lives or works in, so they
  // are gated on the tower holding anyone (#552). `isPresent` and not a
  // population count: `totalPopulation` counts live bodies, which for a
  // commercial unit is its customer tally, so a retail-only tower would read 0
  // and lose its doorman every hour outside the meal windows. A lease keeps
  // `state` at `occupied` around the clock (`updatePresence` cycles `occupants`,
  // never `state`), so this is stable for offices, condos and shops alike.
  // Structural tiles never qualify: floors and lobbies are placed `empty` and
  // stay there, so the room loop below answers it for the whole tower.
  //
  // The rule this lands on is "somebody holds space in this building right now."
  // A shop or office keeps its lease overnight, so its tower stays staffed at
  // 4 a.m. with the shutters down. A hotel room is sold by the night, so a
  // hotel-ONLY tower does go unstaffed between the housekeeping sweep and the
  // evening check-ins. That reads inconsistent side by side, but it follows the
  // leases rather than second-guessing them, and the alternative (latching on
  // `everOccupied`) would keep staff in a tower everyone has left. Revisit if
  // the daily flip reads badly on a real hotel tower.
  // Set here rather than in the per-frame tick because it needs every room.
  let staffed = false;
  const seenR = new Set<number>();
  // The flights' look (span, cars, stops, and whether they wind beside a
  // venue, `venueFlights.ts`) moves only with the structure or the mode, so
  // the venues are gathered on this one walk of the rooms, and the flights
  // reconciled, only when that key moved since the last sync.
  const catalog = towerCatalog(engine.sim);
  const windsBesideVenues = catalog.rules.venueFlights;
  const flights = engine.flightPass;
  const flightsStale =
    flights.sim !== engine.sim ||
    flights.revision !== tower.revision ||
    flights.units !== tower.units ||
    flights.transports !== tower.transports ||
    flights.winds !== windsBesideVenues;
  const venues: VenueBox[] | null = flightsStale && windsBesideVenues ? [] : null;
  // Rebuilt fresh each sync from the one flood-fill read above; the region
  // draw closures read it live at raster time (dead spaces get the red X).
  const deadNow = new Set<number>();
  for (const u of rooms) {
    if (!staffed && isPresent(u)) staffed = true;
    if (venues !== null && isVenue(u.kind)) venues.push(venueBox(u, catalogFacility(catalog, u.kind).floors));
    seenR.add(u.id);
    const unchained = !parkingOK.has(u.id);
    // Every input the room sprite draws from, hour-dependent bits included
    // (see roomSignature), so the room re-bakes exactly when its look changes.
    const sig = roomSignature(u, {
      hour: engine.d.hour,
      lit: engine.litState,
      unchained,
      parkingUse: engine.d.parkingUse ?? 0,
      recycleFill: engine.d.recycleFill ?? 0,
    });
    if (isDeadParking(u, unchained)) deadNow.add(u.id);
    const animated = u.state === "fire" || u.state === "construction";
    const wasAnimated = engine.animatedRooms.has(u.id);
    if (animated && !wasAnimated) {
      // Settled -> animated (ignition, construction start): pull the unit
      // out of its region THIS frame so nothing stays baked under the
      // flames, and stand up the private per-frame actor.
      dropRegionUnit(engine, u.id, true);
      addRoom(engine, u);
    } else if (!animated && wasAnimated) {
      // Animated -> settled (extinguish, build done): retire the private
      // actor and bake into the region THIS frame, so there is never a
      // one-frame hole where the room existed in neither layer.
      engine.animatedRooms.get(u.id)?.kill();
      engine.animatedRooms.delete(u.id);
      markRegionUnit(engine, u, true);
    } else if (!animated && (engine.roomSig.get(u.id) !== sig || !engine.regionUnits.has(u.id))) {
      // Settled look change (or first sight): membership is idempotent and
      // the repaint rides the budgeted drain (towerRegions). A room first seen
      // after the initial bake (one an undo or redo put back) is a player
      // edit, so it bakes this frame, the way a demolition leaves below.
      const firstSight = !engine.regionUnits.has(u.id);
      const initialBake = awaitsInitialBake(engine);
      const putBack = firstSight && !initialBake;
      markRegionUnit(engine, u, putBack);
    }
    engine.roomSig.set(u.id, sig);
  }
  engine.d.staffed = staffed;
  engine.deadParking = deadNow;
  reap(engine.animatedRooms, seenR, (a, id) => {
    a.kill();
    engine.roomSig.delete(id);
  });
  // Region membership reap: a demolished settled unit leaves its regions
  // (survivors repaint via the drain; an emptied region evicts whole).
  for (const id of [...engine.regionUnits.keys()]) {
    if (!seenR.has(id)) {
      // Same-frame: a demolition is a player edit, and its baked pixels must
      // vanish with it instead of queuing behind an hour-flip drain backlog.
      dropRegionUnit(engine, id, true);
      engine.roomSig.delete(id);
    }
  }

  if (!flightsStale) return;
  syncTransports(engine, tower.transports, windingFlights(tower.transports, venues ?? NO_VENUES, flights.winding));
  flights.sim = engine.sim;
  flights.revision = tower.revision;
  flights.units = tower.units;
  flights.transports = tower.transports;
  flights.winds = windsBesideVenues;
}

const NO_VENUES: readonly VenueBox[] = [];

/** Reconcile the shaft and flight actors to `transports`. Whether a flight
 *  winds (`winding`) joins its signature, so building, bulldozing, undoing or
 *  redoing a venue beside it restyles it in the same sync. Runs only when the
 *  structure or the mode moved (`FlightPass`): every input here is structural,
 *  and every transport edit bumps the tower revision. */
function syncTransports(engine: TowerEngine, transports: ReadonlyArray<TransportView>, winding: ReadonlySet<number>): void {
  const seenT = new Set<number>();
  for (const t of transports) {
    seenT.add(t.id);
    const winds = winding.has(t.id);
    const sig = `${t.bottom}:${t.top}:${t.cars}:${t.kind}:${(t.skipFloors ?? []).join(",")}${winds ? ":winds" : ""}`;
    const a = engine.transportActors.get(t.id);
    if (!a) {
      addTransport(engine, t, winds);
      engine.transportSig.set(t.id, sig);
    } else if (engine.transportSig.get(t.id) !== sig) {
      a.kill();
      engine.transportActors.delete(t.id);
      addTransport(engine, t, winds);
      engine.transportSig.set(t.id, sig);
    }
  }
  reap(engine.transportActors, seenT, (a, id) => {
    a.kill();
    engine.transportSig.delete(id);
  });
}

/**
 * Reconcile the building's exterior dressing, escape stairs and the roof
 * crane, to the tower silhouette, and record it as the rain's shelter. Runs
 * only on structural changes (like
 * syncMotion): the silhouette can't move on an hour tick or a lighting flip.
 */
export function syncFacade(engine: TowerEngine): void {
  // Above-ground silhouette + top-row tiles in ONE pass over the units:
  // escape stairs read the per-floor edges, the crane reads the top row's
  // built columns. (Every story of a multi-floor room counts, so a two-story
  // cinema at the edge still gets stairs on its upper row, and so does every
  // raised story of a tall lobby hall.)
  const tower = engine.sim.tower;
  const hi = tower.highestFloor;
  const { runs, topFloor, topTiles } = facadeGeometry(tower.units, hi, towerCatalog(engine.sim), tower.tallLobbies());
  syncEscapes(engine, runs);
  syncCrane(engine, topFloor, topTiles);
  setRainShelter(engine, runs);
}

/** Reconcile the exterior facade segments hung off both sides of each run of
 *  an above-ground floor (one run per tower when towers stand apart on the
 *  lot): fire-escape stairs on floors 2 and up, and the ground-floor entrance
 *  awnings that stand in for them on floor 1. One left + one right actor per
 *  run, slid in place when the run's edges move. */
function syncEscapes(engine: TowerEngine, runs: Map<number, FloorEdge[]>): void {
  const kept = new Set<string>();
  for (const [floor, row] of runs) row.forEach((e, i) => {
    const key = `${floor}:${i}`;
    kept.add(key);
    // Floor 1 wears awnings over its frontage instead of the fire escape;
    // they are wider than an escape segment, so the outer offset differs.
    const ground = floor === 1;
    const segW = ground ? AWNING_W : ESCAPE_W;
    const sig = `${e.min}:${e.max}`;
    const y = engine.worldYTop(floor);
    const lx = e.min * TILE - segW;
    const rx = e.max * TILE;
    const rec = engine.escapeActors.get(key);
    if (rec) {
      // Same graphic (parity/style is fixed per floor), just follow the edge.
      if (rec.sig !== sig) {
        rec.l.pos = ex.vec(lx, y);
        rec.r.pos = ex.vec(rx, y);
        rec.sig = sig;
      }
      return;
    }
    const parity = (floor % 2) as 0 | 1;
    const hang = (x: number, side: "left" | "right"): ex.Actor => {
      const a = new ex.Actor({ pos: ex.vec(x, y), width: segW, height: FLOOR, anchor: ex.vec(0, 0), z: Z.hang });
      a.graphics.use(ground ? engine.awningGfx[side] : engine.escGfx[side][parity]);
      engine.engine.add(a);
      return a;
    };
    engine.escapeActors.set(key, { l: hang(lx, "left"), r: hang(rx, "right"), sig });
  });
  reap(engine.escapeActors, kept, (rec) => {
    rec.l.kill();
    rec.r.kill();
  });
}

/** Keep the rooftop crane perched over the highest built floor's run. It
 *  comes down once the tower tops out at the 100th floor (and stays away
 *  unless the top is demolished back below it, the crane is derived state,
 *  not a latch). No above-ground floors → no crane (empty/basement lots). */
function syncCrane(engine: TowerEngine, hi: number, topTiles: Set<number>): void {
  // No above-ground structure on the top row (basement-only/empty lot), the
  // tower has topped out at the cap, or the top is too narrow for the
  // crane's roof pad (a spire) → no crane.
  const roof = topTiles.size > 0 ? craneRoof(topTiles) : null;
  if (hi >= viewWorld().maxFloor || !roof || roof.width < CRANE_MIN_ROOF_TILES) {
    if (engine.craneActor) {
      engine.craneActor.kill();
      engine.craneActor = null;
      engine.craneGfx = null;
    }
    return;
  }
  // Center over the widest CONTIGUOUS built run on the top floor, not the
  // (min,max) midpoint: a top row built in disjoint sections, a setback, or
  // a partly-leased office row, leaves the midpoint hovering in the gap
  // between blocks, floating the crane over open sky. For a fully-built row
  // the widest run IS the whole span, so this matches the old midpoint.
  // The mast, not the middle of the drawing, stands over the run's center:
  // the jib reaches right, so the drawing's middle is right of the mast.
  const pos = ex.vec(roof.center * TILE, engine.worldYTop(hi));
  if (!engine.craneActor) {
    // cache:true + flagDirty from tick(): the crane re-rasterizes only while
    // the decorative clock advances, so pause/reduced-motion stops the
    // per-frame canvas repaint AND the GPU re-upload, not just the motion.
    engine.craneGfx = new ex.Canvas({
      width: CRANE_W,
      height: CRANE_H,
      cache: true,
      draw: (ctx) => drawCrane(ctx, engine.d.anim, engine.d.lit),
    });
    engine.craneActor = new ex.Actor({
      pos,
      width: CRANE_W,
      height: CRANE_H,
      anchor: ex.vec(CRANE_MAST_ANCHOR_X, 1),
      z: Z.hang,
    });
    engine.craneActor.graphics.use(engine.craneGfx);
    engine.engine.add(engine.craneActor);
  } else {
    engine.craneActor.pos = pos;
  }
}

/** The shared retained-actor ritual: top-left anchored, box collider the
 *  size of the graphic, added to the engine. Callers keep their own maps. */
function addBoxActor(engine: TowerEngine, pos: ex.Vector, w: number, h: number, z: number, gfx: ex.Graphic): ex.Actor {
  const a = new ex.Actor({ pos, width: w, height: h, anchor: ex.vec(0, 0), z });
  a.graphics.use(gfx);
  a.collider.use(ex.Colliders.Box(w, h, ex.vec(0, 0)));
  engine.engine.add(a);
  return a;
}

/** Build and retain the private actor for an ANIMATED room (fire, under
 *  construction): cache:false, so the flames and crane flicker redraw every
 *  frame. Settled rooms never come through here (towerRegions composes
 *  them); the dead-parking X never applies to an animated state, so no dead
 *  flag rides along. z 0.45 keeps the flames deterministically over the
 *  region canvas (z 0) and under every crowd sprite: walkers sit at 0.4 or
 *  lower, garage commute cars at exactly 0.5, so 0.45 avoids the insertion-
 *  order tie a 0.5 room would have with the cars driving past the flames. */
function addRoom(engine: TowerEngine, u: UnitView): void {
  const hgt = catalogFacility(towerCatalog(engine.sim), u.kind).floors;
  const w = u.width * TILE;
  const h = hgt * FLOOR;
  const cv = new ex.Canvas({
    width: w,
    height: h,
    cache: false,
    draw: (ctx) => {
      engine.d.ctx = ctx;
      // Read the room live by id, as the region draws do: an undo or redo step
      // keeps this actor while the view hands every room over as a new object.
      paintAnimatedUnit(engine.d, engine.sim.tower.getUnit(u.id) ?? u, w, h);
    },
  });
  const a = addBoxActor(engine, ex.vec(engine.worldX(u.x), engine.worldYTop(u.floor, hgt)), w, h, Z.animatedRoom, cv);
  engine.animatedRooms.set(u.id, a);
}

function addTransport(engine: TowerEngine, t: TransportView, winds: boolean): void {
  const w = t.width * TILE;
  const totalFloors = t.top - t.bottom + 1;
  const h = totalFloors * FLOOR;
  const gfx = transportGraphic(engine, t, w, totalFloors, winds);
  engine.transportActors.set(t.id, addBoxActor(engine, ex.vec(engine.worldX(t.x), engine.worldYTop(t.top)), w, h, Z.transport, gfx));
}

/**
 * Build a shaft graphic whose backing bitmap can't exceed the GPU texture
 * limit. A tall shaft is `floors * FLOOR` px high, which on a mobile GPU
 * (MAX_TEXTURE_SIZE often 4096, sometimes 2048) can fail to upload and render
 * as a black rectangle. A tall shaft is therefore split into stacked bands,
 * each its own small cached Canvas, composed onto one GraphicsGroup, a single
 * actor, so the rest of the engine (sync, removal, collider) is unchanged.
 */
function transportGraphic(engine: TowerEngine, t: TransportView, w: number, totalFloors: number, winds: boolean): ex.Graphic {
  const band = (fromTop: number, floors: number): ex.Canvas =>
    new ex.Canvas({
      width: w,
      height: floors * FLOOR,
      cache: true,
      quality: 1, // background structure — keep the bitmap at its logical size
      draw: (ctx) => {
        engine.d.ctx = ctx;
        // Draw the whole shaft shifted up so only this band lands in-bounds; the
        // rest is clipped. Bands abut seamlessly (each draws the full shaft).
        // `winds` is the style the signature was built from, so a re-raster
        // (a lost GL context) always matches the signature.
        drawTransport(ctx, t, 0, -fromTop * FLOOR, w, FLOOR, winds);
      },
    });
  if (totalFloors <= TRANSPORT_BAND_FLOORS) return band(0, totalFloors);
  const members: { graphic: ex.Graphic; offset: ex.Vector }[] = [];
  for (let from = 0; from < totalFloors; from += TRANSPORT_BAND_FLOORS) {
    const floors = Math.min(TRANSPORT_BAND_FLOORS, totalFloors - from);
    members.push({ graphic: band(from, floors), offset: ex.vec(0, from * FLOOR) });
  }
  return new ex.GraphicsGroup({ members, useAnchor: false });
}
