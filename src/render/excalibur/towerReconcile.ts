import * as ex from "excalibur";
import { GRID, facilityFloors, hasBusinessHours, isOpenAt } from "../../engine/facilities";
import type { Transport, Unit } from "../../engine/types";
import {
  CRANE_H,
  CRANE_W,
  craneAnchorTile,
  AWNING_W,
  drawCrane,
  drawTransport,
  drawUnit,
  ESCAPE_W,
  lobbyVariant,
} from "../sprites";
import { facadeGeometry, type FloorEdge } from "../facadeGeometry";
import { FLOOR, TILE, TRANSPORT_BAND_FLOORS } from "../scale";
import { reap } from "./towerCrowd";
import type { TowerEngine } from "./TowerEngine";

/**
 * Retained-scene reconciliation (rooms, structure, transports, exterior
 * facade) for {@link TowerEngine}, as friend functions taking the engine
 * instance. Extracted from `TowerEngine.ts`; the class keeps thin delegations.
 * Static construction, baking and the sim-swap / teardown lifecycle live in
 * `towerScene`. Pure code move: no reconciliation or scene-graph logic changed.
 */

/** A retained room actor plus the mutable inputs its draw closure reads live.
 *  A signature change repaints IN PLACE (`cv.flagDirty()` re-rasterizes the
 *  same bitmap and re-uploads the same WebGL texture) instead of allocating a
 *  fresh canvas + texture. At top speed a big tower flips ~100 room
 *  signatures per real second (hour/lighting/occupancy churn), and the
 *  old kill-and-recreate path let dead canvases and GPU textures pile up
 *  faster than Excalibur's 60s texture GC could drain them, enough sustained
 *  memory pressure that phones killed (and auto-reloaded) the tab. */
export interface RoomRec {
  actor: ex.Actor;
  cv: ex.Canvas;
  /** Burning/under-construction rooms animate (cache:false, redrawn every
   *  frame); a transition into or out of an animated state still rebuilds. */
  animated: boolean;
  /** Mutable inputs the draw closure reads live, currently just the "dead
   *  parking space" flag (red X overlay). A separate holder (not a field on
   *  the record) so the closure can capture it before the actor/canvas exist
   *  and the record stays fully typed with no placeholder casts. */
  live: { dead: boolean };
}

// ---- Retained-scene reconciliation (no full rebuild) --------------------

export function syncScene(engine: TowerEngine): void {
  const tower = engine.sim.tower;
  // Refresh the floor-1 entrance map BEFORE the unit loop that will call
  // addStruct / lobbyTileGfx: those consumers need to see a map as fresh as
  // the tiles they're about to bake, so a newly-placed leftmost tile picks
  // up the grand-entrance graphic on the same frame it's added.
  refreshFloor1EntranceMap(engine);
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
  const seenS = new Set<number>();
  const seenR = new Set<number>();
  for (const u of tower.units) {
    if (u.kind === "floor" || u.kind === "lobby") {
      seenS.add(u.id);
      const cell = engine.structTiles.get(u.id);
      if (!cell) addStruct(engine, u);
      else if (u.kind === "lobby") {
        // Lobby tiles swap their shared graphic when the evening lights come
        // on (chandeliers/sconces glow). Guarded: clearing and re-adding a
        // cell graphic dirties the TileMap's cached geometry, so skip when
        // the cell already shows the right canvas.
        const gfx = lobbyTileGfx(engine, u);
        if (cell.getGraphics()[0] !== gfx) {
          cell.clearGraphics();
          cell.addGraphic(gfx);
        }
      }
    } else {
      seenR.add(u.id);
      // The signature must capture every input the room sprite draws from, so
      // it re-bakes exactly when its look changes. Crucially that includes the
      // hour-dependent bits, a commercial unit's open/closed shutter and a
      // condo's late-night "asleep" look, otherwise a shop baked closed at
      // dawn would wrongly stay shuttered all day until the next lighting flip.
      const open = hasBusinessHours(u.kind) ? (isOpenAt(u.kind, engine.d.hour) ? "o" : "c") : "";
      const lateNight = u.kind === "condo" && (engine.d.hour >= 23 || engine.d.hour < 6) ? "s" : "";
      // Only mark a SETTLED space dead, a mid-build (or burning) space is
      // excluded from the set for other reasons and isn't a connectivity fault.
      const dead =
        u.kind === "parking" && u.state !== "construction" && u.state !== "fire" && !parkingOK.has(u.id) ? "x" : "";
      // Hour-bucketed live-display bits: how full the garage is (cars) and how
      // full the recycling centers are (garbage pile). syncScene already runs
      // on the hour, so these advance the same cadence as open/lateNight.
      const liveBits =
        u.kind === "parking"
          ? `:p${Math.round((engine.d.parkingUse ?? 0) * 6)}`
          : u.kind === "recycling"
            ? `:r${Math.round((engine.d.recycleFill ?? 0) * 8)}`
            : "";
      // Include `outForMeal` in the cache key: pixelSprites reads visible
      // occupants via `u.occupants - (u.outForMeal ?? 0)`, so the sprite must
      // re-raster when the visible dip changes even though canonical
      // `u.occupants` did not. Without this, an office bakes at t=0 with six
      // workers and would keep rendering six through the whole meal peak.
      // `subtype` is in the key because retail variants draw differently and
      // the inspector's "Change variety" action swaps it at runtime; without
      // it the reroll would not repaint until another signature bit flips.
      const sig = `${u.state}:${engine.litState ? 1 : 0}:${u.width}:${u.occupants}:${u.outForMeal ?? 0}:${u.subtype ?? ""}:${open}${lateNight}${dead}${liveBits}`;
      const isDead = dead === "x";
      const rec = engine.roomActors.get(u.id);
      const animated = u.state === "fire" || u.state === "construction";
      if (!rec) {
        addRoom(engine, u, isDead, animated);
        engine.roomSig.set(u.id, sig);
      } else if (engine.roomSig.get(u.id) !== sig) {
        if (animated === rec.animated && rec.cv.width === u.width * TILE) {
          // Repaint in place: the draw closure reads the unit's live state, so
          // flagging the canvas dirty re-bakes the SAME bitmap into the SAME
          // GPU texture. No actor churn, no new allocations, see RoomRec.
          rec.live.dead = isDead;
          rec.cv.flagDirty();
        } else {
          // Rebuild (rare): animated↔static flips the canvas cache mode, which
          // is fixed at construction (fire ignition/extinguish, build done);
          // the width guard is belt-and-braces, the sig treats width as a
          // repaint trigger, but only a rebuild can re-derive the bitmap size,
          // actor footprint and collider (no engine path resizes a unit today).
          rec.actor.kill();
          engine.roomActors.delete(u.id);
          addRoom(engine, u, isDead, animated);
        }
        engine.roomSig.set(u.id, sig);
      }
    }
  }
  reap(engine.structTiles, seenS, (cell) => {
    // A dead unit's cell may have been re-claimed IN THIS SAME PASS by its
    // replacement (building a lobby over bare floor removes the floor unit
    // and adds the lobby at the same coordinates in one revision). The add
    // ran above, so blindly clearing here would wipe the replacement's
    // just-set graphic; only clear when no live floor/lobby unit owns the
    // cell anymore. Cell coords map back to the grid: row 0 is the top floor.
    const live = tower.unitAt(GRID.maxFloor - cell.y, cell.x);
    if (!live || (live.kind !== "floor" && live.kind !== "lobby")) cell.clearGraphics();
  });
  reap(engine.roomActors, seenR, (rec, id) => {
    rec.actor.kill();
    engine.roomSig.delete(id);
  });

  const seenT = new Set<number>();
  for (const t of tower.transports) {
    seenT.add(t.id);
    const sig = `${t.bottom}:${t.top}:${t.cars}:${t.kind}:${(t.skipFloors ?? []).join(",")}`;
    const a = engine.transportActors.get(t.id);
    if (!a) {
      addTransport(engine, t);
      engine.transportSig.set(t.id, sig);
    } else if (engine.transportSig.get(t.id) !== sig) {
      a.kill();
      engine.transportActors.delete(t.id);
      addTransport(engine, t);
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
 * crane, to the tower silhouette. Runs only on structural changes (like
 * syncMotion): the silhouette can't move on an hour tick or a lighting flip.
 */
export function syncFacade(engine: TowerEngine): void {
  // Above-ground silhouette + top-row tiles in ONE pass over the units:
  // escape stairs read the per-floor edges, the crane reads the top row's
  // built columns. (Every story of a multi-floor room counts, so a two-story
  // cinema at the edge still gets stairs on its upper row.)
  const hi = engine.sim.tower.highestFloor;
  const { edges, topTiles } = facadeGeometry(engine.sim.tower.units, hi);
  syncEscapes(engine, edges);
  syncCrane(engine, hi, topTiles);
}

/** Reconcile the exterior facade segments hung off each above-ground floor's
 *  left and right edges: fire-escape stairs on floors 2 and up, and the
 *  ground-floor entrance awnings that stand in for them on floor 1. One left +
 *  one right actor per row, slid in place when the row's edge moves. */
function syncEscapes(engine: TowerEngine, edges: Map<number, FloorEdge>): void {
  for (const [floor, e] of edges) {
    // Floor 1 wears awnings over its frontage instead of the fire escape;
    // they are wider than an escape segment, so the outer offset differs.
    const ground = floor === 1;
    const segW = ground ? AWNING_W : ESCAPE_W;
    const sig = `${e.min}:${e.max}`;
    const y = engine.worldYTop(floor);
    const lx = e.min * TILE - segW;
    const rx = e.max * TILE;
    const rec = engine.escapeActors.get(floor);
    if (rec) {
      // Same graphic (parity/style is fixed per floor), just follow the edge.
      if (rec.sig !== sig) {
        rec.l.pos = ex.vec(lx, y);
        rec.r.pos = ex.vec(rx, y);
        rec.sig = sig;
      }
      continue;
    }
    const parity = (floor % 2) as 0 | 1;
    const hang = (x: number, side: "left" | "right"): ex.Actor => {
      const a = new ex.Actor({ pos: ex.vec(x, y), width: segW, height: FLOOR, anchor: ex.vec(0, 0), z: -2 });
      a.graphics.use(ground ? engine.awningGfx[side] : engine.escGfx[side][parity]);
      engine.engine.add(a);
      return a;
    };
    engine.escapeActors.set(floor, { l: hang(lx, "left"), r: hang(rx, "right"), sig });
  }
  reap(engine.escapeActors, new Set(edges.keys()), (rec) => {
    rec.l.kill();
    rec.r.kill();
  });
}

/** Keep the rooftop crane perched over the highest built floor's run. It
 *  comes down once the tower tops out at the 100th floor (and stays away
 *  unless the top is demolished back below it, the crane is derived state,
 *  not a latch). No above-ground floors → no crane (empty/basement lots). */
function syncCrane(engine: TowerEngine, hi: number, topTiles: Set<number>): void {
  // No above-ground structure on the top row (basement-only/empty lot) or the
  // tower has topped out at the cap → no crane.
  if (hi >= GRID.maxFloor || topTiles.size === 0) {
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
  const pos = ex.vec(craneAnchorTile(topTiles) * TILE, engine.worldYTop(hi));
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
      anchor: ex.vec(0.5, 1),
      z: -2,
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
  a.collider.set(ex.Shape.Box(w, h, ex.vec(0, 0)));
  engine.engine.add(a);
  return a;
}

function addStruct(engine: TowerEngine, u: Unit): void {
  // Floor/lobby units are one tile wide in the sim (and the old per-unit
  // actor drew exactly one tile regardless), so a unit maps to one cell.
  const cell = engine.structTileMap.getTile(u.x, GRID.maxFloor - u.floor);
  if (!cell) return; // outside the grid; the sim never places there
  const gfx = u.kind === "lobby" ? lobbyTileGfx(engine, u) : engine.floorGfx;
  cell.clearGraphics();
  cell.addGraphic(gfx);
  engine.structTiles.set(u.id, cell);
}

/** The shared lobby tile graphic for this unit's lighting, style and slot.
 *  For floor-1 lobby tiles the frontage-edge predicate can override the
 *  variant to a wide-storefront grand slice, a compact grand fallback, or
 *  a service entrance; see {@link floor1EntranceKind}. */
function lobbyTileGfx(engine: TowerEngine, u: Unit): ex.Canvas {
  const lit = engine.litState ? 1 : 0;
  if (u.floor === 1) {
    const kind = floor1EntranceKind(engine, u.x);
    switch (kind) {
      case "grand-left": return engine.entranceGrandLeftGfx[lit];
      case "grand-right": return engine.entranceGrandRightGfx[lit];
      case "grand-solo": return engine.entranceGrandSoloGfx[lit];
      case "service": return engine.entranceServiceGfx[lit];
    }
    return engine.lobbyGfx[lit][1][lobbyVariant(u.x)];
  }
  return engine.lobbyGfx[lit][0][lobbyVariant(u.x)];
}

/** Which entrance (if any) the floor-1 lobby tile at grid `x` should render
 *  as. A plain lookup in the per-tile map computed by
 *  {@link refreshFloor1EntranceMap} at the top of every syncScene. */
function floor1EntranceKind(engine: TowerEngine, x: number): "grand-left" | "grand-right" | "grand-solo" | "service" | "none" {
  return engine.floor1EntranceMap.get(x) ?? "none";
}

/** Walk the tower's floor-1 lobby tiles, group them into contiguous runs,
 *  and stamp the grand entrance onto the LEFTMOST run and the service door
 *  onto the RIGHTMOST run. Populating a per-tile map (rather than checking
 *  global min/max) keeps every entrance sprite anchored to real neighboring
 *  tiles, so a gap in the middle of the lobby (mid-remodel bulldoze) cannot
 *  produce an orphan grand-left half-facade with nothing next to it.
 *
 *  Rules:
 *    - Leftmost run of width ≥ 2: `runStart` -> grand-left, `runStart+1` -> grand-right.
 *    - Leftmost run of width 1 (toy tower): `runStart` -> grand-solo.
 *    - Rightmost run's rightmost tile -> service, IFF that tile is not
 *      already claimed by the grand entrance AND there is room past the
 *      grand span. When the rightmost run is the SAME as the leftmost run,
 *      "room past the grand span" means the run has more tiles than the
 *      grand takes (so 1/2-tile lobbies are all grand, no service). When
 *      the rightmost run is DIFFERENT from the leftmost run, it always has
 *      room by construction, so any distinct rightmost run gets service on
 *      its rightmost tile (even width 1). */
function refreshFloor1EntranceMap(engine: TowerEngine): void {
  engine.floor1EntranceMap.clear();
  // Collect every floor-1 lobby tile position (lobby units are always
  // width 1 in the sim, but reading u.width for defense costs nothing).
  const tiles: number[] = [];
  for (const u of engine.sim.tower.units) {
    if (u.kind === "lobby" && u.floor === 1) {
      for (let dx = 0; dx < u.width; dx++) tiles.push(u.x + dx);
    }
  }
  if (tiles.length === 0) return;
  tiles.sort((a, b) => a - b);
  // Find the leftmost and rightmost contiguous runs. Both come from the same
  // sorted list; a single pass locates the first run's end and the last
  // run's start.
  let firstRunEnd = 0;
  while (firstRunEnd + 1 < tiles.length && tiles[firstRunEnd + 1] === tiles[firstRunEnd] + 1) {
    firstRunEnd++;
  }
  let lastRunStart = tiles.length - 1;
  while (lastRunStart > 0 && tiles[lastRunStart - 1] === tiles[lastRunStart] - 1) {
    lastRunStart--;
  }
  const firstStart = tiles[0];
  const firstEnd = tiles[firstRunEnd] + 1; // exclusive
  const firstWidth = firstEnd - firstStart;
  // Grand entrance on the leftmost run.
  if (firstWidth >= 2) {
    engine.floor1EntranceMap.set(firstStart, "grand-left");
    engine.floor1EntranceMap.set(firstStart + 1, "grand-right");
  } else {
    engine.floor1EntranceMap.set(firstStart, "grand-solo");
  }
  // Service door on the rightmost run's rightmost tile, but only if that
  // tile isn't already claimed by the grand entrance.
  const lastRightX = tiles[tiles.length - 1];
  const grandSpan = firstWidth >= 2 ? 2 : 1;
  const sameRunAsFirst = lastRunStart <= firstRunEnd;
  const roomPastGrand = sameRunAsFirst ? firstWidth > grandSpan : true;
  if (roomPastGrand && !engine.floor1EntranceMap.has(lastRightX)) {
    engine.floor1EntranceMap.set(lastRightX, "service");
  }
}

/** Build and retain a room actor. `animated` (burning / under construction:
 *  redraws every frame; the rest bake once and re-bake in place, see
 *  RoomRec) is computed by syncScene, the only caller with a unit in hand,
 *  so the repaint-vs-rebuild gate and the canvas cache mode can never drift
 *  apart on two copies of the predicate. */
function addRoom(engine: TowerEngine, u: Unit, deadParking: boolean, animated: boolean): void {
  const hgt = facilityFloors(u.kind);
  const w = u.width * TILE;
  const h = hgt * FLOOR;
  // The draw closure reads `u` and `live.dead` LIVE, so a later signature
  // change repaints by flagging the canvas dirty instead of rebuilding it.
  const live = { dead: deadParking };
  const cv = new ex.Canvas({
    width: w,
    height: h,
    cache: !animated,
    draw: (ctx) => {
      engine.d.ctx = ctx;
      // Set per-unit: a dead (unchained) parking space draws no cars. Every
      // room bake writes it, so one unit's flag can't leak into the next.
      engine.d.parkingDead = live.dead;
      drawUnit(engine.d, u, 0, 0, w, h);
      // Canon "red X" on a parking space that isn't chained to a ramp (dead , 
      // no relief). Baked into the sprite; the dead-bit participates in the room
      // signature, so this re-bakes when the signature changes (state/lighting/
      // hour or the dead-bit). live.dead is refreshed on each sync from the
      // caller's single functionalParkingSet() read, no per-unit recompute.
      if (live.dead) {
        // Dark under-stroke so the X reads as a SHAPE independent of hue
        // (color-blind cue), then the red X on top.
        for (const [style, wd] of [["#111", 4] as const, ["#C24A3A", 2] as const]) {
          ctx.strokeStyle = style;
          ctx.lineWidth = wd;
          ctx.beginPath();
          ctx.moveTo(2, 2);
          ctx.lineTo(w - 2, h - 2);
          ctx.moveTo(w - 2, 2);
          ctx.lineTo(2, h - 2);
          ctx.stroke();
        }
      }
    },
  });
  const a = addBoxActor(engine, ex.vec(engine.worldX(u.x), engine.worldYTop(u.floor, hgt)), w, h, 0, cv);
  engine.roomActors.set(u.id, { actor: a, cv, animated, live });
}

function addTransport(engine: TowerEngine, t: Transport): void {
  const w = t.width * TILE;
  const totalFloors = t.top - t.bottom + 1;
  const h = totalFloors * FLOOR;
  const gfx = transportGraphic(engine, t, w, totalFloors);
  engine.transportActors.set(t.id, addBoxActor(engine, ex.vec(engine.worldX(t.x), engine.worldYTop(t.top)), w, h, 1, gfx));
}

/**
 * Build a shaft graphic whose backing bitmap can't exceed the GPU texture
 * limit. A tall shaft is `floors * FLOOR` px high, which on a mobile GPU
 * (MAX_TEXTURE_SIZE often 4096, sometimes 2048) can fail to upload and render
 * as a black rectangle. A tall shaft is therefore split into stacked bands,
 * each its own small cached Canvas, composed onto one GraphicsGroup, a single
 * actor, so the rest of the engine (sync, removal, collider) is unchanged.
 */
function transportGraphic(engine: TowerEngine, t: Transport, w: number, totalFloors: number): ex.Graphic {
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
        drawTransport(ctx, t, 0, -fromTop * FLOOR, w, FLOOR);
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
