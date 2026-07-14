# Pixel-art module gallery + reference draw code

Visual reference for the pixel-art overhaul (see
`../spec-pixel-art-overhaul.md`). The Figma mood board is the visual source of
truth, but `figma.com` is not reachable from CI (the egress policy blocks it),
so the board tiles are rendered here locally from the exact rectangle arrays
that built them. The output is pixel-identical to the board.

## Contents

- `page-0X-*.png` : six page overviews, every module of a page composited into
  one image.
- `tiles/*.png` : all 63 individual module tiles, one PNG each.
- `build-scripts/*.build.js` : the pixel-exact draw source per page. Each tile
  is a pure function that pushes rectangles into an array via
  `F(A, x, y, w, h, color, opacity)`; the shared `box` / `person` / texture
  helpers sit above them. These carry the finalized people geometry (seated
  occupant 15px, standing 18px, walker 24px, transport rider 17px).
- `rasterize.mjs` : a dependency-free Node renderer (a pure `zlib` PNG writer,
  no `canvas` package) that runs each build script under a mock Figma API,
  collects the rectangles, and encodes the PNGs.
- `manifest.json` : the page-to-tile map, with each tile's pixel size.

## Regenerate

```
node rasterize.mjs
```

Writes the page overviews, `tiles/`, and `manifest.json`. Deterministic: same
scripts in, same pixels out.

## Porting to the Excalibur / Canvas 2D bake

The rectangle format is a direct Canvas 2D mapping, so the follow-up render work
is a port rather than a re-derivation:

```
F(A, x, y, w, h, color, opacity)
  ->  ctx.fillStyle = color;
      ctx.globalAlpha = opacity ?? 1;   // F() defaults opacity to 1
      ctx.fillRect(x, y, w, h);
```

The build scripts draw at true in-game pixels (`TILE = 11` wide, `FLOOR = 44`
tall) and the board renders them at 3x. In the game, a tile function becomes the
per-kind draw routine under `src/render/pixelSprites/**` or `src/render/sprites/**`,
scaled to the screen rect it is given and reading only inputs already in the
bake signature (`src/render/excalibur/TowerEngine.ts`). Coordinates stay integer.
