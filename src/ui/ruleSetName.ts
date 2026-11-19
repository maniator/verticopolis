import type { GameMode } from "../shared/types";

/**
 * The rule set's name as the UI says it (the Tower panel badge, the status bar,
 * Tower > This Tower's Rules). A lookup keyed by mode names the mode; it decides
 * no rule, so it stays out of the mode-branch ratchet. The mode-name choices the
 * UI still makes are tracked on #1621.
 */
export const RULE_SET_NAME: Readonly<Record<GameMode, string>> = { classic: "Classic", modern: "Modern" };
