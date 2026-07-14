import { escapeHtml } from "./escape";
import { TOWER_FILE_EXT, type SlotInfo } from "../storage/SaveGame";
import type { ImportReport } from "../storage/tdtImport";
import type { ExportReport } from "../storage/tdtExport";
import type { UpdateInfo } from "../pwa";

/**
 * Pure HTML string builders for the UI dialogs and panels: the "view" layer of
 * {@link UI}. Every function is data-in / string-out with no DOM access and no
 * app state, so the UI controller (and its friend-modules) build a modal body
 * here and then own the wiring and lifecycle. Keeping the markup free of `this`
 * makes it unit-testable and gives the planned Preact migration (see the
 * engineering backlog) a single clean seam to replace.
 */

/** Compact money for the palette cost chips (e.g. 12k, 1.5M). */
export function shortMoney(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return `${n}`;
}

/** The tool-info panel body for a selected build kind. */
export function buildToolInfoHtml(
  f: { name: string; cost: number; population: number; description: string },
  isCommercial: boolean,
): string {
  return (
    `<div class="ti-name">${f.name}</div>` +
    `<div>Cost: $${f.cost.toLocaleString()}</div>` +
    // Commercial venues never hold a flat population: they add however many
    // customers are eating right now, up to the catalog value. "Capacity"
    // stays for the kinds where it is literally the head count.
    (f.population
      ? `<div>${isCommercial ? `Customers: up to ${f.population}` : `Capacity: ${f.population}`}</div>`
      : "") +
    `<p style="margin-top:6px;color:var(--muted)">${f.description}</p>`
  );
}

export const BULLDOZE_TOOL_INFO_HTML =
  "<div class='ti-name'>Bulldoze</div><p style='color:var(--muted)'>Click a room or shaft to sell it for half its cost.</p>";
export const INSPECT_TOOL_INFO_HTML =
  "<div class='ti-name'>Inspect</div><p style='color:var(--muted)'>Hover the tower to read a facility's status.</p>";

/** The tower-stats grid body. */
export function towerStatsHtml(s: {
  floors: number;
  basements: number;
  occupiedOffices: number;
  offices: number;
  soldCondos: number;
  condos: number;
  occupiedHotel: number;
  hotelRooms: number;
  dirty: number;
  shops: number;
  restaurants: number;
  transports: number;
  vacant: number;
}): string {
  return `
      <span class="k">Floors</span><span class="v">${s.floors} / B${s.basements}</span>
      <span class="k">Offices</span><span class="v">${s.occupiedOffices}/${s.offices}</span>
      <span class="k">Condos sold</span><span class="v">${s.soldCondos}/${s.condos}</span>
      <span class="k">Hotel (in use)</span><span class="v">${s.occupiedHotel}/${s.hotelRooms}</span>
      <span class="k">Rooms to clean</span><span class="v" style="color:${s.dirty ? "var(--bad)" : "inherit"}">${s.dirty}</span>
      <span class="k">Shops / Food</span><span class="v">${s.shops} / ${s.restaurants}</span>
      <span class="k">Transports</span><span class="v">${s.transports}</span>
      <span class="k">Vacancies</span><span class="v">${s.vacant}</span>`;
}

/** The Statistics modal body (caller supplies the pre-rendered inner stats). */
export function statsModalHtml(html: string): string {
  return `<h2>Tower Statistics</h2>${html}
      <div class="modal-actions"><button class="btn primary" data-act="close">Close</button></div>`;
}

/** The Saved Towers modal body: auto-save + numbered slots, plus export/import. */
export function savesHtml(slots: SlotInfo[]): string {
  const fmtWhen = (ms?: number) =>
    ms ? new Date(ms).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "";
  const row = (s: SlotInfo): string => {
    const name = s.slot === "auto" ? "Auto-save" : `Slot ${s.slot}`;
    // The rule-set chip reuses the New Tower dialog's badge language (muted
    // Classic, green Modern). SlotInfo's mode is already coerced, so the
    // chip text is one of two literals, never raw file content.
    const modeChip =
      s.mode === "modern"
        ? '<span class="nt-badge alt">Modern</span>'
        : '<span class="nt-badge">Classic</span>';
    // Plain integer, no locale grouping: the day is an ordinal, and the
    // finiteness guard keeps any non-numeric SlotInfo producer from ever
    // reaching the template raw (storage already bounds the value).
    const when = [Number.isFinite(s.day) ? `Day ${Math.floor(s.day!)}` : "", fmtWhen(s.savedAt)]
      .filter(Boolean)
      .join(" · ");
    const detail = s.exists
      ? `<div class="slot-detail">${escapeHtml(s.towerName ?? "Tower")} ${modeChip} · ${s.star === 6 ? "TOWER" : (s.star ?? 1) + "★"} · pop ${(s.population ?? 0).toLocaleString()} · $${Math.round(s.funds ?? 0).toLocaleString()}<br><span class="slot-when">${when}</span></div>`
      : `<div class="slot-detail slot-empty">empty</div>`;
    const saveBtn =
      s.slot === "auto" ? "" : `<button class="btn" data-save="${s.slot}">Save</button>`;
    const loadBtn = s.exists ? `<button class="btn" data-load="${s.slot}">Load</button>` : "";
    const delBtn =
      s.exists && s.slot !== "auto"
        ? `<button class="btn danger" data-del="${s.slot}" aria-label="Delete save slot ${s.slot}">✕</button>`
        : "";
    return `<div class="slot"><div class="slot-head"><b>${name}</b>${detail}</div><div class="slot-actions">${saveBtn}${loadBtn}${delBtn}</div></div>`;
  };
  return `
      <h2>Saved Towers</h2>
      <div class="slots well">${slots.map(row).join("")}</div>
      <div class="modal-actions">
        <button class="btn" data-act="export">Export to file</button>
        <button class="btn" data-act="import">Import from file</button>
        <button class="btn primary" data-act="close">Close</button>
      </div>`;
}

/** The per-floor elevator stops modal body. */
export function stopsHtml(
  title: string,
  floors: { floor: number; stop: boolean; lobby: boolean }[],
): string {
  const rowsHtml = floors
    .map((fl) => {
      const label = fl.floor > 0 ? `Floor ${fl.floor}` : `B${-fl.floor}`;
      const tag = fl.lobby ? ' <span class="stop-lobby">lobby</span>' : "";
      return `<label class="stop-row"><input type="checkbox" data-floor="${fl.floor}" ${fl.stop ? "checked" : ""}/> <span>${label}${tag}</span></label>`;
    })
    .join("");
  return `
      <h2>${escapeHtml(title)}: Stops</h2>
      <p style="color:var(--muted);font-size:12px">Untick a floor to make the car skip it (express service). The top and bottom stay connected.</p>
      <div class="stop-list well">${rowsHtml}</div>
      <div class="modal-actions"><button class="btn primary" data-act="close">Done</button></div>`;
}

/** The batch-pricing modal body. */
export function batchPricingHtml(
  noun: string,
  priceWord: string,
  band: { default: number; min: number; max: number; step: number },
): string {
  const money = (n: number) => `$${n.toLocaleString()}`;
  return `
      <h2>Set all ${noun}</h2>
      <div class="batch-modes">
        <label><input type="radio" name="bp-mode" value="set" checked /> Set ${priceWord} to</label>
        <span class="bp-amount"><button type="button" class="btn" data-bp="dec" aria-label="decrease">–</button>
          <input id="bp-price" class="field" type="number" inputmode="numeric" value="${band.default}" min="${band.min}" max="${band.max}" step="${band.step}" />
          <button type="button" class="btn" data-bp="inc" aria-label="increase">+</button></span>
        <div class="bp-band">Range ${money(band.min)}–${money(band.max)}</div>
        <label><input type="radio" name="bp-mode" value="default" /> Reset to default (${money(band.default)})</label>
      </div>
      <label class="bp-only"><input id="bp-only" type="checkbox" /> Only ${noun} still on the default price</label>
      <p id="bp-preview" class="bp-preview" aria-live="polite"></p>
      <div class="modal-actions">
        <button class="btn primary" id="bp-apply" data-act="apply">Apply</button>
        <button class="btn" data-act="close">Cancel</button>
      </div>`;
}

/** The generic confirm modal body. */
export function confirmHtml(title: string, body: string, yesLabel: string): string {
  return `<h2>${title}</h2><p>${body}</p>
       <div class="modal-actions"><button class="btn" data-act="no">Cancel</button><button class="btn primary" data-act="yes">${yesLabel}</button></div>`;
}

/** The New Tower rule-set picker modal body. */
export function newTowerHtml(hasSave: boolean): string {
  const abandon = hasSave
    ? `<p class="nt-abandon">⚠️ This abandons your current tower (it is not auto-saved).</p>`
    : "";
  return `<h2>Found a New Tower</h2>
       <p class="nt-lede">Choose your rule-set. This is set once and <b>cannot be changed</b> for this tower. Start another to play the other way.</p>
       <div class="nt-modes">
         <label class="nt-mode">
           <input type="radio" name="nt-mode" value="classic" checked />
           <span class="nt-mode-body">
             <span class="nt-mode-name">Classic <span class="nt-badge">1994</span></span>
             <span class="nt-mode-desc">Pixel-faithful SimTower. Every condo houses a family of 3 and sells at 2×–2.5× its build cost; lose an owner to neglect and you buy the condo back at full price. The 1994 economy runs untouched, so a mature tower's money gets comfortable, just like the original.</span>
           </span>
         </label>
         <label class="nt-mode">
           <input type="radio" name="nt-mode" value="modern" />
           <span class="nt-mode-body">
             <span class="nt-mode-name">Modern <span class="nt-badge alt">new</span></span>
             <span class="nt-mode-desc">Everything in Classic, plus features the original couldn't do:</span>
             <span class="nt-feature"><b>Variant households</b>: a condo draws a 2–5 person family. Bigger families pay more but lean harder on your elevators, so each sale is a real bet.</span>
             <span class="nt-feature"><b>Households come and go</b>: a sold condo's family can move out on its own (a life event, not a complaint), more often for a bigger family. You buy the condo back and resell it, so even a settled tower keeps turning over.</span>
             <span class="nt-feature"><b>A deeper economy</b>: held space carries a monthly overhead, unsold condos are taxed, and a noisy office neighbor can wear a tenant down to a move-out. Late-game money stays a real decision.</span>
           </span>
         </label>
       </div>
       <div class="nt-calendar">
         <span class="nt-mode-name">Calendar <span class="nt-badge alt">Modern</span></span>
         <span class="nt-mode-desc">Classic always runs the authentic compressed 1994 calendar. For Modern, pick the pace:</span>
         <label class="nt-cal-opt"><input type="radio" name="nt-cal" value="realWorld" checked /> <b>Real-world length</b>: a 7-day week, 90-day quarter and 360-day year, the friendlier pace.</label>
         <label class="nt-cal-opt"><input type="radio" name="nt-cal" value="canon" /> <b>Short (1994)</b>: a 3-day week, 3-day quarter and 12-day year, the authentic SimTower rhythm.</label>
       </div>
       ${abandon}
       <div class="modal-actions">
         <button class="btn" data-act="cancel">Cancel</button>
         <button class="btn primary" data-act="found">Found Tower</button>
       </div>`;
}

/** The export-choice modal body (.vctower primary, 1994 .TDT secondary). */
export function exportConfirmHtml(isModern: boolean): string {
  const legacyLine = isModern
    ? `Saving for the original 1994 game (<b>.TDT</b>) is <b>Classic towers only</b>: the 1994 rule set cannot hold Modern mechanics.`
    : `You can also save it for the original 1994 game (<b>.TDT</b>); a summary of what carries over shows first. <b>Still experimental</b>: verified to load in the real game for smaller Classic towers.`;
  return `
      <h2>Export tower?</h2>
      <p>Your tower will be packed into a <b>${TOWER_FILE_EXT}</b> file and downloaded.</p>
      <p style="color:var(--muted);font-size:12px">${legacyLine}</p>
      <div class="modal-actions">
        <button class="btn" data-act="close">Cancel</button>
        <button class="btn" data-act="legacy"${isModern ? ' disabled title="Classic towers only"' : ""}>For SimTower (1994)…</button>
        <button class="btn primary" data-act="export" autofocus>Export</button>
      </div>`;
}

/** The legacy (.TDT) import fidelity report modal body. */
export function importReportHtml(report: ImportReport): string {
  const li = (lines: string[]) => lines.map((s) => `<li>${escapeHtml(s)}</li>`).join("");
  const stars = report.star >= 6 ? "TOWER" : `${report.star}★`;
  // Minus before the dollar sign, same as the stats panel (legacy imports
  // can legitimately arrive in the red).
  const money = Math.round(report.money);
  const funds = `${money < 0 ? "-" : ""}$${Math.abs(money).toLocaleString()}`;
  return `
      <h2>Import from SimTower (1994)</h2>
      <div class="import-facts well">
        <b>${escapeHtml(report.towerName)}</b> · ${stars} · ${funds}
        · ${report.floors} floor${report.floors === 1 ? "" : "s"}${report.basements ? ` / B${report.basements}` : ""}
        · ${report.unitsImported.toLocaleString()} rooms
      </div>
      <h3>Brought over</h3>
      <ul class="import-list">${li(report.broughtOver)}</ul>
      <h3>Couldn't bring over</h3>
      <ul class="import-list">${li(report.couldNotBring)}</ul>
      <p style="color:var(--muted);font-size:12px">Nothing is adopted until you open it. Your current tower is kept in its autosave, and the import is copied to a free save slot when one is available.</p>
      <div class="modal-actions">
        <button class="btn" data-act="close">Cancel</button>
        <button class="btn primary" data-act="open" autofocus>Open tower</button>
      </div>`;
}

/** The reverse-fidelity legacy (.TDT) export report modal body. */
export function exportReportHtml(report: ExportReport): string {
  const li = (lines: string[]) => lines.map((s) => `<li>${escapeHtml(s)}</li>`).join("");
  const stars = report.star >= 6 ? "TOWER" : `${report.star}★`;
  const funds = `${report.money < 0 ? "-" : ""}$${Math.abs(report.money).toLocaleString()}`;
  return `
      <h2>Export for SimTower (1994)</h2>
      <p style="color:var(--muted);font-size:12px"><b>Work in progress.</b> Exporting to the original 1994 format is still experimental. It has been verified to load and play in the real game for smaller Classic towers; a large or complex tower may not load correctly yet. Your tower here is never changed.</p>
      <div class="import-facts well">
        <b>${escapeHtml(report.towerName)}</b> · ${stars} · ${funds}
        · ${report.floors} floor${report.floors === 1 ? "" : "s"}${report.basements ? ` / B${report.basements}` : ""}
        · ${report.roomsExported.toLocaleString()} rooms
      </div>
      <h3>Comes along</h3>
      <ul class="import-list">${li(report.comesAlong)}</ul>
      <h3>Stays behind</h3>
      <ul class="import-list">${li(report.staysBehind)}</ul>
      <p style="color:var(--muted);font-size:12px">Downloads as <b>${escapeHtml(report.filename)}</b>. Your tower here is untouched.</p>
      <div class="modal-actions">
        <button class="btn" data-act="close">Cancel</button>
        <button class="btn primary" data-act="download" autofocus>Download .TDT</button>
      </div>`;
}

/** The How-to-play help modal body. */
export function helpHtml(onSplash: boolean, version: string): string {
  // Replaying the intro is meaningless while the title screen is still up (the
  // handler no-ops behind #splash), so disable that button there.
  const replayAttr = onSplash
    ? ' disabled title="Start a tower first, then you can replay the intro."'
    : "";
  return `
      <h2>How to play</h2>
      <p>Build a thriving high-rise and earn your way to a coveted <b>TOWER</b> rating.</p>
      <ul>
        <li><b>Floors first.</b> Lay <b>Floor</b> tiles, then place rooms on them.</li>
        <li><b>Move people.</b> Every floor needs an <b>elevator</b> or <b>stairs</b> chain back to the ground lobby, or tenants leave.</li>
        <li><b>Make money.</b> Offices pay quarterly rent, condos sell once, hotels earn nightly, shops &amp; restaurants earn from foot traffic.</li>
        <li><b>Grow your rating.</b> 2★ at 300 pop, 3★ at 1,000 (needs Security), 4★ at 5,000 (needs Medical, enough Recycling, suites &amp; a VIP), 5★ at 10,000 (needs a Metro).</li>
        <li><b>Take out the trash.</b> One <b>Recycling Center</b> processes ~2,500 population. It visibly fills through the day and a garbage truck empties it each morning. Outgrow your centers and 4★ locks until you build more.</li>
        <li><b>Win.</b> At 5★ with a Metro station, build the <b>Wedding Hall</b> on floor 100 and pass the VIP inspection. The <b>TOWER</b> rank needs 15,000 occupants: office workers, residents, and venue customers. Hotel guests don't count at this stage, even when dining.</li>
        <li><b>Two rides, tops.</b> People take at most <b>two</b> elevator/stair rides to reach a floor. Add <b>sky lobbies</b> (every ~15 floors) so distant floors are one transfer away, or nobody comes.</li>
        <li><b>Parking</b> spaces only work when they touch a <b>Parking Ramp</b> or a connected space. Chain them off a ramp, or they sit empty. Offices want a space per ~24 workers (one per four offices) from 3★, and every hotel suite needs one of its own (the VIP drives).</li>
        <li><b>Book the films.</b> Cinemas book a film monthly. A <b>Blockbuster</b> costs twice as much but pulls a far bigger crowd (great in a busy tower, a money-loser in a quiet one). Leave it on <b>Auto</b> or set a policy on the cinema.</li>
        <li><b>Price in bulk.</b> Inspect any office, condo or hotel room and use <b>“Set all …”</b> to re-price every unit of that kind at once (or reset them to the default). No need to edit each room. A preview shows how many change before you apply.</li>
        <li><b>The clock breathes.</b> As in 1994, real time isn't spent evenly: the clock crawls through the lunch crush (watch your elevators earn their keep) and races through the small hours. A full day still takes the same real time, and the speed buttons still multiply it. Prefer an even pace? Toggle <b>Steady clock</b> in Settings.</li>
        <li><b>Rule-set (Classic vs Modern).</b> You pick this when you <b>found a tower</b>, and it's fixed for that tower's life. <b>Classic</b> is the faithful 1994 game: every condo is a family of 3, sells at 2×–2.5× its build cost, and an owner lost to neglect costs you a full-price buy-back. <b>Modern</b> adds <b>variant households</b>: a condo draws a 2–5 person family that sets its sale price and how demanding it is (a big family pays more but bails sooner if the elevators can't cope). Sold condo households also <b>move out on their own</b> now and then, a life event more likely for a bigger family, so you buy the condo back and resell as the tower turns over. It also runs a <b>deeper economy</b>: held space carries a monthly overhead, unsold condos are taxed, and a noisy office neighbor can wear a tenant down to a move-out, so late-game money stays a real decision. Modern also lets you pick the <b>calendar</b> when you found the tower: keep the friendlier real-world length (7-day week, 90-day quarter, 360-day year) or run the authentic 1994 compressed calendar (3-day week, 3-day quarter, 12-day year); Classic always runs the compressed one. Whichever you pick, your income per in-game day stays the same, only the cadence changes. Want the other rule-set? Start a new tower, and if there's a "what the original couldn't do" behavior Modern doesn't have yet, suggest it below.</li>
      </ul>
      <p style="color:var(--muted)">Mouse: drag to pan, scroll to zoom, click to build, Inspect tool to edit a room. Made a mistake? <b>Undo with Ctrl+Z</b> (or the ↩ button). Redo with Ctrl+Shift+Z. Music changes with whatever part of the tower you're viewing. Try scrolling around!</p>
      <h3>Keyboard play</h3>
      <p style="color:var(--muted)">Play entirely without a mouse. Pick a tool in the palette (Tab to it, Enter to select), then:</p>
      <ul class="help-keys">
        <li><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> (or <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>) move the build cursor. Hold <kbd>Shift</kbd> for ×10</li>
        <li><kbd>Enter</kbd> / <kbd>Space</kbd> build (or inspect) at the cursor. For an elevator or stairway, press once to anchor and again at the far end to size the shaft</li>
        <li><kbd>Delete</kbd> / <kbd>Backspace</kbd> / <kbd>X</kbd> bulldoze at the cursor · <kbd>Esc</kbd> cancel</li>
        <li><kbd>+</kbd> / <kbd>−</kbd> zoom · <kbd>C</kbd> re-center · <kbd>0</kbd>–<kbd>3</kbd> game speed · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo</li>
      </ul>
      <h3>Found a bug? Have an idea?</h3>
      <p style="color:var(--muted)">Help us improve Verticopolis. Report a bug, request a feature, or flag anything that doesn't match the 1994 original.</p>
      <p class="help-report"><a class="btn" target="_blank" rel="noopener noreferrer" href="https://github.com/maniator/verticopolis/issues/new/choose">Let us know…<span class="visually-hidden"> (opens GitHub in a new tab)</span></a></p>
      <h3>About</h3>
      <p style="color:var(--muted)">An unofficial, from-scratch homage to SimTower (1994). Original code and art; no ripped assets. Not affiliated with or endorsed by Maxis / OPeNBooK / Vivarium.<br>Verticopolis v${escapeHtml(version)}</p>
      <div class="modal-actions"><button class="btn" data-act="replay-onboard"${replayAttr}>Replay Getting Started</button><button class="btn primary" data-act="close" autofocus>Got it</button></div>
    `;
}

/** The Settings modal body (sound levels + presentation toggles). */
export function settingsHtml(): string {
  return `
      <h2>Settings</h2>
      <h3>Sound</h3>
      <p style="color:var(--muted)">Levels apply right away and are remembered on this device. The 🔊 button up top mutes everything.</p>
      <div class="vol-row"><label for="vol-music">Music</label><input id="vol-music" type="range" min="0" max="100" step="1"><span class="vol-val" data-vol-val="vol-music" aria-hidden="true"></span></div>
      <div class="vol-row"><label for="vol-sfx">Effects</label><input id="vol-sfx" type="range" min="0" max="100" step="1"><span class="vol-val" data-vol-val="vol-sfx" aria-hidden="true"></span></div>
      <h3>Motion and pace</h3>
      <div class="set-row">
        <label class="set-switch"><input type="checkbox" id="set-reduce-motion" role="switch" aria-describedby="note-reduce-motion"><span>Reduced motion</span></label>
        <p class="set-note" id="note-reduce-motion">Calms ambient motion: weather, birds, and other background animation. If your device asks for reduced motion, this stays on.</p>
      </div>
      <div class="set-row">
        <label class="set-switch"><input type="checkbox" id="set-steady-clock" role="switch" aria-describedby="note-steady-clock"><span>Steady clock</span></label>
        <p class="set-note" id="note-steady-clock">As in 1994, the clock normally runs slow through the lunch rush and fast overnight (a full day takes the same real time either way). Turn on for an even pace all day.</p>
      </div>
      <div class="modal-actions"><button class="btn primary" data-act="close" autofocus>Close</button></div>
    `;
}

/** The two-choice emergency modal body. */
export function eventChoiceHtml(message: string, costLabel: string): string {
  return `
      <h2>⚠️ Emergency</h2>
      <p>${message}</p>
      <div class="modal-actions">
        <button class="btn primary" data-act="accept">Pay ${costLabel}</button>
        <button class="btn" data-act="decline">Decline</button>
      </div>
    `;
}

/** The "update available" modal body. */
export function updatePromptHtml(info?: UpdateInfo | null): string {
  const notes = (info?.notes ?? []).slice(0, 3);
  // Wrap the heading + list so the `.win-title.sm` strip is a GRANDCHILD of
  // `.modal-box.win`, a direct child would inherit the dialog title bar's
  // full-bleed and sticky treatment and overlap the body text.
  const notesBlock = notes.length
    ? `<div class="whatsnew"><h3 class="win-title sm">What's new</h3><ul>${notes
        .map((n) => `<li>${escapeHtml(n)}</li>`)
        .join("")}</ul></div>`
    : "";
  // Keep a real sha (it anchors a bug report to an exact build) but drop the
  // "unknown" placeholder a non-git build would stamp.
  const sha = info?.sha && info.sha !== "unknown" ? info.sha : undefined;
  const idText = [info?.version, sha].filter(Boolean).map((s) => escapeHtml(s!)).join(" · ");
  const buildLine = idText ? `<p class="build-id">Build ${idText}</p>` : "";
  return `
      <h2>Update available</h2>
      <p>A newer version of Verticopolis is ready. Update now saves your tower and reloads onto it. You won't lose any progress.</p>
      <p>Or keep playing: it'll apply next time you reopen.</p>
      ${notesBlock}
      ${buildLine}
      <div class="modal-actions">
        <button class="btn" data-act="later">Later</button>
        <button class="btn primary" data-act="update">Update now</button>
      </div>
    `;
}

/** The TOWER-achieved congratulations modal body. */
export function congratsHtml(): string {
  return `
      <h2>🏆 TOWER achieved!</h2>
      <p>Your skyscraper has earned the legendary <b>TOWER</b> rating. Wedding bells ring out over the city from the hall on the 100th floor. Congratulations, master builder!</p>
      <div class="modal-actions"><button class="btn primary" data-act="close">Continue</button></div>
    `;
}
