/**
 * The Verticopolis app mark as an in-code SVG: a stepped art-deco tower with
 * lit gold windows and a setting sun, on an indigo, plum and coral "Metropolis
 * Dusk" sky. `gen-pwa-icons.mjs` rasterizes it for the web app, and the atlas
 * export ships it (with the committed PNGs) for other frontends.
 */

// "Metropolis Dusk" palette (matches the splash + wordmark).
const INDIGO = "#1b1b40";
const PLUM = "#37285a";
const CORAL = "#ef6b5e";
const GOLD = "#ffc94a"; // lit windows / sun
const CROWN = "#ffe6a0"; // antenna beacon
const TOWER = "#140f2e"; // tower silhouette

/**
 * @param {number} size    output pixel size
 * @param {boolean} maskable  keep art inside the maskable safe zone (center ~80%)
 */
export function iconSvg(size, maskable) {
  // The dusk sky bleeds to every edge; the tower stays inside the safe zone so
  // maskable crops never clip it.
  const pad = 512 * (maskable ? 0.17 : 0.06);
  const cx = 256;
  const ground = 512 - pad;
  const top = pad + (maskable ? 44 : 22);
  const H = ground - top;
  const safeW = 512 - pad * 2;

  // Stepped art-deco tiers, base (widest) → spire.
  const tiers = [
    { w: 0.42, h: 0.3, cols: 4, rows: 3 },
    { w: 0.31, h: 0.24, cols: 3, rows: 3 },
    { w: 0.2, h: 0.24, cols: 2, rows: 3 },
    { w: 0.085, h: 0.22, cols: 0, rows: 0 }, // spire
  ];

  let y = ground;
  let rects = "";
  let windows = "";
  for (const t of tiers) {
    const w = safeW * t.w;
    const h = H * t.h;
    const x = cx - w / 2;
    y -= h;
    rects += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${TOWER}"/>`;
    if (t.cols) {
      const gx = w * 0.16;
      const gy = h * 0.18;
      const cw = (w - gx * (t.cols + 1)) / t.cols;
      const chh = (h - gy * (t.rows + 1)) / t.rows;
      for (let r = 0; r < t.rows; r++) {
        for (let c = 0; c < t.cols; c++) {
          const wx = x + gx + c * (cw + gx);
          const wy = y + gy + r * (chh + gy);
          windows += `<rect x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="${cw.toFixed(1)}" height="${chh.toFixed(1)}" fill="${GOLD}"/>`;
        }
      }
    }
  }
  const spireTop = y;
  const sunR = safeW * 0.26;
  const sunY = ground - H * 0.4;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
    <defs>
      <linearGradient id="dusk" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${INDIGO}"/>
        <stop offset="0.52" stop-color="${PLUM}"/>
        <stop offset="1" stop-color="${CORAL}"/>
      </linearGradient>
    </defs>
    <rect width="512" height="512" fill="url(#dusk)"/>
    <circle cx="256" cy="${sunY.toFixed(1)}" r="${sunR.toFixed(1)}" fill="${GOLD}" opacity="0.92"/>
    <line x1="256" y1="${(spireTop - 34).toFixed(1)}" x2="256" y2="${spireTop.toFixed(1)}" stroke="${TOWER}" stroke-width="7"/>
    <circle cx="256" cy="${(spireTop - 38).toFixed(1)}" r="9" fill="${CROWN}"/>
    ${rects}
    ${windows}
  </svg>`;
}
