/**
 * Structure and ground-floor sprites. This file is a barrel; the draw functions
 * live in cohesive siblings under `structure/` and are re-exported here so every
 * existing `import { … } from "./structure"` (and the `sprites.ts` barrel) keeps
 * working unchanged:
 *   - `structure/shell.ts`: the bare floor, construction scaffold, burned shell.
 *   - `structure/lobby.ts`: the lobby concourse tiles + entrance dispatch.
 *   - `structure/entrance.ts`: the grand and service entrance facades.
 *   - `structure/rooftop.ts`: the tower crane, fire escape, and awning.
 */
export { drawFloor, drawConstruction, drawBurntShell, drawFlames } from "./structure/shell";
export {
  LOBBY_VARIANTS,
  lobbyVariant,
  ENTRANCE_GRAND_LEFT,
  ENTRANCE_GRAND_RIGHT,
  ENTRANCE_GRAND_SOLO,
  ENTRANCE_SERVICE,
  drawLobbyEntrance,
  drawLobby,
} from "./structure/lobby";
export type { EntranceKind } from "./structure/lobby";
export {
  CRANE_W,
  CRANE_H,
  craneAnchorTile,
  drawCrane,
  ESCAPE_W,
  drawEscapeStairs,
  AWNING_W,
  drawAwning,
} from "./structure/rooftop";
