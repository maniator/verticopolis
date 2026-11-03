import type { LedgerCat } from "../engine/Ledger";

/**
 * The words the Statistics window prints for two things the engine reports by
 * key: the income ledger's categories and the optional milestones. The engine
 * answers which categories exist, their per-day averages and which milestones
 * are done; the labels and descriptions stay here, as the engine's progress
 * panel says. `statsCopy.test.ts` holds this copy to the keys the engine's
 * own tables carry until those tables are deleted.
 */

/** The income categories in display order. */
export const LEDGER_CATS: readonly LedgerCat[] = ["offices", "condos", "hotels", "retail", "food", "entertainment", "upkeep"];

/** The income categories' names in the readout. */
export const LEDGER_LABELS: Readonly<Record<LedgerCat, string>> = {
  offices: "Offices",
  condos: "Condos",
  hotels: "Hotels",
  retail: "Retail",
  food: "Food",
  entertainment: "Entertainment",
  upkeep: "Upkeep",
};

/** A milestone's title and what earns it. */
export interface MilestoneCopy {
  label: string;
  desc: string;
}

/** Each milestone's copy, keyed by the id the stats report answers. */
export const MILESTONE_COPY: ReadonlyMap<string, MilestoneCopy> = new Map<string, MilestoneCopy>([
  ["pop-500", { label: "Getting Started", desc: "Reach 500 population." }],
  ["pop-2500", { label: "Rising", desc: "Reach 2,500 population." }],
  ["pop-7500", { label: "Metropolis", desc: "Reach 7,500 population." }],
  ["pop-12000", { label: "Almost There", desc: "Reach 12,000 population." }],
  ["star-4", { label: "Four Stars", desc: "Earn a 4-star rating." }],
  ["star-5", { label: "Five Stars", desc: "Earn a 5-star rating." }],
  ["cinema", { label: "Showtime", desc: "Run an operational cinema." }],
  ["metro", { label: "On the Map", desc: "Connect an operational Metro Station." }],
  ["skyline", { label: "Touch the Sky", desc: "Build up to the 100th floor." }],
  ["well-served", { label: "Smooth Operator", desc: "Reach 5,000 population with every occupied, tenant-bearing floor reachable." }],
  ["full-house", { label: "No Vacancy", desc: "Reach 2,000 population with no vacant offices, condos, or hotel rooms." }],
]);
