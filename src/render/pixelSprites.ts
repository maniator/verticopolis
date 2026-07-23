import type { FacilityKind, Unit, UnitState } from "../engine/types";
import { FACILITIES, hasBusinessHours, isOpenAt } from "../engine/facilities";
import { POPULATED, closedShutter, noticeBadge, type RoomCtx } from "./pixelSprites/common";
import { condo, hotel, office } from "./pixelSprites/residential";
import { cinema, fastFood, foodHall, restaurant } from "./pixelSprites/food";
import { amusements } from "./pixelSprites/amusements";
import { boutiqueBay } from "./pixelSprites/boutique";
import { fitnessClub } from "./pixelSprites/fitness";
import { clinic } from "./pixelSprites/clinic";
import { nightclub } from "./pixelSprites/nightclub";
import { spa } from "./pixelSprites/spa";
import { skyBar } from "./pixelSprites/skyBar";
import { daycare } from "./pixelSprites/daycare";
import { shop } from "./pixelSprites/shop";

/**
 * Faithful "dollhouse cross-section" room art, following the SimTower design
 * spec: a flat pale back wall, a hard floor line, 2–4 big furniture pieces on
 * that line, the upper wall mostly empty, and tiny silhouette people. No
 * flickering window grid, no corner badges — those read as a modern facade and
 * clutter, which is exactly what the original avoids.
 *
 * Drawing is resolution-independent: each routine fills the screen rect it's
 * given. Baking these into fixed-size canvases (for Excalibur sprites) just
 * means calling them once into an offscreen context.
 *
 * This file is the entry point + barrel. The palette, primitives, and per-kind
 * draw routines live in cohesive siblings under `pixelSprites/` and are
 * re-exported here so every existing `import { … } from "./pixelSprites"` keeps
 * working unchanged:
 *   - `pixelSprites/common.ts`: palette, seeded-variety helpers, person, shell.
 *   - `pixelSprites/residential.ts`: office, condo, hotel.
 *   - `pixelSprites/food.ts`: fast food, restaurant, cinema + their look tables.
 *   - `pixelSprites/shop.ts`: shop + its look table.
 */

export function drawRoom(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const { ctx } = d;
  // Commercial shows its shutter whenever it's outside business hours.
  if (
    hasBusinessHours(u.kind) &&
    u.state !== "empty" &&
    u.state !== "construction" &&
    !isOpenAt(u.kind, d.hour)
  ) {
    closedShutter(d, x, y, w, h, FACILITIES[u.kind].color);
    return;
  }
  switch (u.kind) {
    case "office":
      office(d, u, x, y, w, h);
      break;
    case "condo":
      condo(d, u, x, y, w, h);
      break;
    case "hotelSingle":
      hotel(d, u, x, y, w, h, 1);
      break;
    case "hotelDouble":
      hotel(d, u, x, y, w, h, 2);
      break;
    case "hotelSuite":
      hotel(d, u, x, y, w, h, 3);
      break;
    case "fastFood":
      fastFood(d, u, x, y, w, h);
      break;
    case "restaurant":
      restaurant(d, u, x, y, w, h);
      break;
    case "foodHall":
      // A hall of food stalls: rendered with the restaurant drawer, but each
      // stall subtype carries its own look so the stalls read as distinct.
      foodHall(d, u, x, y, w, h);
      break;
    case "amusements":
      // A Modern arcade / games hall; each attraction subtype (arcade, VR,
      // claw, mini-golf) draws its own interior under a shared neon marquee.
      amusements(d, u, x, y, w, h);
      break;
    case "boutiqueBay":
      // A Modern bay of small trades; each trade subtype (florist, barber,
      // phone repair, vintage, tattoo, records, gallery) draws its own shopfront.
      boutiqueBay(d, u, x, y, w, h);
      break;
    case "fitnessClub":
      // A Modern members' gym; each format subtype (weights, yoga, spin, boxing,
      // climbing) draws its own equipment under a shared mirror strip.
      fitnessClub(d, u, x, y, w, h);
      break;
    case "clinic":
      // A Modern health clinic; each practice subtype (dental, urgent care,
      // optometry, pharmacy, physio) draws its own room under a clinical trim band.
      clinic(d, u, x, y, w, h);
      break;
    case "nightclub":
      // A Modern nightclub: one dark room with colored beams, a DJ booth, a
      // glowing dance floor, and a crowd that fills in with occupancy.
      nightclub(d, u, x, y, w, h);
      break;
    case "spa":
      // A Modern wellness spa: one calm room with a steaming hot tub, massage
      // tables, and greenery, with guests that fill in with occupancy.
      spa(d, u, x, y, w, h);
      break;
    case "skyBar":
      // A Modern rooftop bar: a dusk lounge with a lit-skyline window, a bar of
      // glowing bottles, and patrons that fill in with occupancy.
      skyBar(d, u, x, y, w, h);
      break;
    case "daycare":
      // A Modern daycare: a bright playroom with a soft play mat, toy shelf, a
      // caregiver, and small children that fill in with occupancy.
      daycare(d, u, x, y, w, h);
      break;
    case "shop":
      shop(d, u, x, y, w, h);
      break;
    case "cinema":
      cinema(d, u, x, y, w, h);
      break;
    default:
      // Service / special facilities keep their existing iconographic look.
      ctx.fillStyle = "#3a3f4a";
      ctx.fillRect(x, y, w, h);
  }
  // Lights out at night: an empty home/workplace, or a condo whose residents
  // are asleep in the small hours.
  const lateNight = d.hour >= 23 || d.hour < 6;
  const emptyAtNight = d.lit && u.occupants <= 0 && POPULATED.has(u.kind);
  const asleepHome = u.kind === "condo" && u.occupants > 0 && lateNight;
  if ((emptyAtNight || asleepHome) && u.state !== "empty" && u.state !== "construction") {
    ctx.fillStyle = "rgba(8,10,22,0.5)";
    ctx.fillRect(x, y, w, h);
  }
  // A tenant on notice (satisfaction bottomed out) — flag it so the player can
  // spot the at-risk lease at a glance and fix the cause before they leave.
  if (u.state === "vacating") noticeBadge(ctx, x, y, w, h);
}

/** Convenience used by the preview/gallery: pick a representative state. */
export function sampleState(kind: FacilityKind): UnitState {
  if (kind === "hotelSingle" || kind === "hotelDouble" || kind === "hotelSuite") return "occupied";
  return "occupied";
}

// ---- Barrel: preserve the original public surface of this module. ----
export { PAL, SHIRTS, SKIN, person, personSeated, personStanding, type RoomCtx } from "./pixelSprites/common";
export { FASTFOOD_LOOKS, RESTAURANT_LOOKS, FOODHALL_LOOKS, type FastFoodLook, type RestaurantLook } from "./pixelSprites/food";
export { AMUSEMENTS_LOOKS, type AmusementsLook } from "./pixelSprites/amusements";
export { BOUTIQUE_LOOKS, type BoutiqueLook } from "./pixelSprites/boutique";
export { FITNESS_LOOKS, type FitnessLook } from "./pixelSprites/fitness";
export { CLINIC_LOOKS, type ClinicLook } from "./pixelSprites/clinic";
export { SHOP_LOOKS, type ShopLook } from "./pixelSprites/shop";
