/**
 * help-bridge.html: the game host's page the manual frames, out of sight,
 * so its Help bar can reach the game's channel from the manual's own host
 * (src/ui/helpBar.ts bridgeHelpBar, #2035). It hears and answers only the
 * manual's origin: help.verticopolis.com in a production build, this same
 * host in every other build.
 */
import { HELP_ORIGIN } from "./helpAddress";
import { bridgeHelpBar } from "./ui/helpBar";

bridgeHelpBar(window, HELP_ORIGIN || location.origin);
