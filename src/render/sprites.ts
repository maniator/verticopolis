import { FACILITIES } from "../engine/facilities";
import type { FacilityKind, Unit } from "../engine/types";
import { drawRoom } from "./pixelSprites";
import type { DrawCtx } from "./sprites/common";
import {
  drawHousekeeping,
  drawMedical,
  drawMetro,
  drawParking,
  drawParkingRamp,
  drawPartyHall,
  drawRecycling,
  drawSecurity,
  drawWeddingHall,
} from "./sprites/facilities";
import { drawBurntShell, drawConstruction, drawFlames, drawFloor, drawLobby } from "./sprites/structure";

export type { DrawCtx } from "./sprites/common";
export {
  AWNING_W,
  CRANE_H,
  CRANE_W,
  craneAnchorTile,
  drawAwning,
  drawCrane,
  drawEscapeStairs,
  drawLobbyEntrance,
  ENTRANCE_GRAND_LEFT,
  ENTRANCE_GRAND_RIGHT,
  ENTRANCE_GRAND_SOLO,
  ENTRANCE_SERVICE,
  type EntranceKind,
  ESCAPE_W,
  LOBBY_VARIANTS,
  lobbyVariant,
} from "./sprites/structure";
export { drawGarbageTruck, drawMetroTrain, drawStreetCar } from "./sprites/facilities";
export { drawCar, drawTransport } from "./sprites/transport";

/** Facility kinds rendered by the faithful pixel-art room module. */
const ROOM_KINDS = new Set<FacilityKind>([
  "office",
  "condo",
  "hotelSingle",
  "hotelDouble",
  "hotelSuite",
  "fastFood",
  "restaurant",
  "foodHall",
  "amusements",
  "boutiqueBay",
  "fitnessClub",
  "clinic",
  "shop",
  "cinema",
]);

/**
 * Procedural sprite drawing. Rather than ship external image assets, every
 * facility is drawn from layered shapes — walls, floors, furniture, windows
 * and signage — to evoke the chunky, detailed pixel look of the 1994 original.
 * Per-unit color variation (seeded by the unit id) keeps rows of identical
 * facilities from reading as one flat color block. All drawing is in screen
 * space.
 */

/** Draw a placed room/structure unit into the given screen rectangle. */
export function drawUnit(d: DrawCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const { ctx } = d;

  if (u.kind === "floor") return drawFloor(ctx, x, y, w, h);
  if (u.kind === "lobby") return drawLobby(d, u, x, y, w, h);
  if (u.state === "construction") return drawConstruction(d, x, y, w, h);

  // A unit ablaze: draw its gutted shell, then flames over the top.
  if (u.state === "fire") {
    drawBurntShell(ctx, x, y, w, h);
    drawFlames(d, x, y, w, h);
    return;
  }
  // A burned-out room after the fire: the shell, no flames — a scar to rebuild.
  if (u.state === "gutted") return drawBurntShell(ctx, x, y, w, h);

  // Faithful pixel-art rooms own all of their states (empty / closed / asleep…),
  // including their own "for lease"/"for sale" signage when vacant.
  if (ROOM_KINDS.has(u.kind)) return drawRoom(d, u, x, y, w, h);

  // Service / special facilities (security, housekeeping, medical, metro…) are
  // staffed amenities, not leased tenants — they're never "for lease", so always
  // draw their interior regardless of the internal empty/idle state.
  drawInterior(d, u, x, y, w, h);
}

/** Dispatch to the per-facility interior drawing (services & special only). */
function drawInterior(d: DrawCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const ctx = d.ctx;
  switch (u.kind) {
    case "partyHall":
      return drawPartyHall(d, u, x, y, w, h);
    case "parking":
      return drawParking(d, u, x, y, w, h);
    case "parkingRamp":
      return drawParkingRamp(ctx, u, x, y, w, h);
    case "security":
      return drawSecurity(d, x, y, w, h);
    case "medical":
      return drawMedical(d, x, y, w, h);
    case "housekeeping":
      return drawHousekeeping(d, x, y, w, h);
    case "recycling":
      return drawRecycling(d, u, x, y, w, h);
    case "metro":
      return drawMetro(d, x, y, w, h);
    case "weddingHall":
      return drawWeddingHall(ctx, x, y, w, h);
    default:
      ctx.fillStyle = FACILITIES[u.kind].color;
      ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  }
}
