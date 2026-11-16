/**
 * The star-up duties the engine publishes in the catalog's `rules` block
 * (`engine-rs/src/star_duties.rs`): what each rating starts asking of the
 * tower, read by the star-up message box. `CatalogRules` in
 * `catalogTypes.ts` extends it.
 */

/** The two `CatalogRules` fields the star-up box reads. */
export interface CatalogStarDutyRules {
  /** Whether the star-up message box adds the heads-up: what the new rating
   *  starts asking of the tower (`starDuties`) and what the next rating needs.
   *  When false (Classic) it names the rating and the rooms it opens. */
  readonly announcesStarDuties: boolean;
  /** What each rating starts asking of the tower, by the rating it begins at. */
  readonly starDuties: ReadonlyArray<CatalogStarDuty>;
}

/** The ids of the duties a star rating can start (`star_duties.rs`). */
export type StarDutyId =
  | "emergencies"
  | "suiteParking"
  | "officeParking"
  | "homeParking"
  | "recycling"
  | "vipVisits"
  | "hotelGuestsUncounted"
  | "bombThreats";

/** One duty: the rating it begins at and its id. */
export interface CatalogStarDuty {
  readonly star: number;
  readonly id: StarDutyId;
}
