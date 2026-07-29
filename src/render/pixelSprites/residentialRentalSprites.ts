import type { Unit } from "../../engine/types";
import type { RoomCtx } from "./common";
import { condo } from "./residential";
import { APARTMENT_WALLS, RENTAL_PICTURES, STUDIO_WALLS } from "./residential.looks";

/**
 * Modern rental-living sprites (Studio & Apartment), in their own module so
 * `residential.ts` stays under the size ceiling. Both reuse the condo dollhouse
 * draw with their own wall/picture look tables (the "variants like office and
 * condo" requirement: geoVariant already varies the walls, layout, and pictures
 * per unit) and a "LEASE" vacancy shell (they rent, they are not sold).
 */

export function rentalStudio(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  condo(d, u, x, y, w, h, STUDIO_WALLS, RENTAL_PICTURES, "LEASE");
}

export function rentalApartment(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  condo(d, u, x, y, w, h, APARTMENT_WALLS, RENTAL_PICTURES, "LEASE");
}
