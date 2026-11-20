/**
 * Where each problem the game names has its answer in the manual (#2036).
 * The room card's problem lines (src/game/portUnitDiagnostics.ts) and the
 * Tower Statistics problem rows (src/ui/templates/stats.ts) each carry a small
 * Help link to one of these pages, and a press opens it the way the Help menu
 * does (src/ui/uiHelp.ts openHelpTopic): a new tab, with the tower paused
 * until the player is back.
 *
 * Each path is a manual page as the game writes it (/help/..., turned into
 * this build's address by helpUrl), with the section's heading id where one
 * section answers it. src/ui/helpTopics.test.ts holds every page and heading
 * to the help site's own Markdown.
 */

/** A problem's page in the manual, keyed by the code the link carries (and
 *  analytics reports: `help_topic_open`). */
export const HELP_TOPIC_PATH = {
  rent: "/help/tower/ratings/#what-wears-a-rating-down",
  noise: "/help/tower/ratings/#what-wears-a-rating-down",
  elevatorWaits: "/help/building/elevators/#keeping-the-waits-short",
  walkwayWaits: "/help/building/stairs-and-escalators/#how-far-will-people-walk",
  shops: "/help/rooms/food-and-shops/#when-there-arent-enough-shops",
  recycling: "/help/rooms/services/#recycling-center",
  parking: "/help/rooms/services/#parking",
  access: "/help/tower/people/#how-people-get-around",
  farWalk: "/help/building/stairs-and-escalators/#how-far-will-people-walk",
  lobby: "/help/building/floors-and-lobbies/#sky-lobbies",
  wontLease: "/help/tower/ratings/#finding-the-trouble",
  notice: "/help/tower/ratings/#moving-out",
  housekeeping: "/help/rooms/hotels/#housekeeping",
  cockroaches: "/help/rooms/hotels/#cockroaches",
  nextStar: "/help/tower/stars/#when-you-earn-a-star",
} as const;

export type HelpTopic = keyof typeof HELP_TOPIC_PATH;

/** What a Help link says to a screen reader, so a card with three of them
 *  reads which is which. */
export const HELP_TOPIC_LABEL: Readonly<Record<HelpTopic, string>> = {
  rent: "Help on rent",
  noise: "Help on noise",
  elevatorWaits: "Help on elevator waits",
  walkwayWaits: "Help on stairs and escalators",
  shops: "Help on shops",
  recycling: "Help on recycling",
  parking: "Help on parking",
  access: "Help on getting people there",
  farWalk: "Help on long walks",
  lobby: "Help on sky lobbies",
  wontLease: "Help on rooms that won't lease",
  notice: "Help on tenants giving notice",
  housekeeping: "Help on housekeeping",
  cockroaches: "Help on cockroaches",
  nextStar: "Help on earning a star",
};

/** True when `code` names a topic (an own key, so "constructor" never does). */
export function isHelpTopic(code: string | undefined): code is HelpTopic {
  return code !== undefined && Object.prototype.hasOwnProperty.call(HELP_TOPIC_PATH, code);
}

/**
 * The topic for a gripe the engine named (`cause`, a vacate reason) and, for
 * a traffic gripe, what jammed (`binding`). Undefined for a cause the manual
 * has no single page for.
 */
export function gripeTopic(cause: string, binding?: string): HelpTopic | undefined {
  switch (cause) {
    case "rent":
      return "rent";
    case "noise":
      return "noise";
    case "congestion":
      return binding === "walkways" || binding === "stairs" || binding === "escalator"
        ? "walkwayWaits"
        : "elevatorWaits";
    case "unmetDemand":
      return "shops";
    case "trash":
      return "recycling";
    case "parking":
    case "homeParking":
      return "parking";
    default:
      return undefined;
  }
}
