// The Modern catalog (every kind, Modern's own included) as a file beside the
// pages, for the room pictures (src/scripts/sprites.ts): the game's painters
// size and style each room from it, as the game does. Written at build time
// from the same engine package, so the pictures cannot disagree with the game.
import { catalogs } from "../lib/catalog";

export async function GET(): Promise<Response> {
  const { modern } = await catalogs();
  return new Response(JSON.stringify(modern), { headers: { "content-type": "application/json" } });
}
