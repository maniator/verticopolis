import type { Simulation, LogEntry } from "../engine/Simulation";
import { FACILITIES } from "../engine/facilities";
import type { FacilityKind } from "../engine/types";
import type { UI } from "./UI";
import { render } from "lit-html";
import { towerStatsTemplate } from "./templates/towerStats";

/**
 * Status-bar, palette-lock, tower-stats and bulletin-log rendering for
 * {@link UI}, as friend functions taking the UI instance. This is the per-frame
 * pump ({@link update}) plus the toast rail and log baseline helpers. Extracted
 * from `UI.ts`; the class keeps thin delegations.
 */

/** Hard ceiling on rendered bulletin lines. The DOM node count is held CONSTANT
 *  at this, append the newest, prune the oldest, so scrollback is generous yet
 *  a long session can never grow the log big enough to jank a slow phone. */
const LOG_DOM_CAP = 300;

/** Most toasts kept on screen at once, and the most fired in a single render.
 *  A catch-up tick can flush a big batch; only the newest few pop. */
const TOAST_MAX = 5;

/** Refresh status bar, palette locks, tower stats and the bulletin log. */
export function update(ui: UI, sim: Simulation): void {
  ui.el.money.textContent = `$${Math.round(sim.money).toLocaleString()}`;
  ui.el.money.style.color = sim.money < 0 ? "var(--bad)" : "var(--money)";
  ui.el.pop.textContent = sim.population.toLocaleString();
  ui.el.star.textContent = sim.star >= 6 ? "TOWER" : "★".repeat(sim.star) + "☆".repeat(5 - sim.star);
  ui.el.time.textContent = sim.clock.format();
  ui.el.date.textContent = sim.clock.formatRetroDate();

  // Dirty-gate the palette lock/afford scan (E5-S3): its DOM pass depends only
  // on the star (isUnlocked is star-vs-minStar) and on which kinds the current
  // funds can afford, so it reruns only when the star or an affordability
  // boundary crossed since the last scan. Money moves every pump; the bitmask
  // below changes only at a crossing, so the ~6 Hz pump skips the two
  // querySelectorAll walks and the class writes almost always. The key is a
  // cheap string over engine data (no DOM reads).
  let scanKey = String(sim.star);
  for (const kind in FACILITIES) scanKey += sim.money >= FACILITIES[kind as FacilityKind].cost ? "1" : "0";
  if (scanKey !== ui.paletteScanKey) {
    ui.paletteScanKey = scanKey;
    // Palette unlock state. Parity with the original: a locked facility is HIDDEN
    // (`.locked` -> display:none, out of layout and tab order), not shown dimmed ,
    // the palette grows as stars are earned. Only affordability dims
    // (`.unaffordable`); an unlocked-but-unaffordable tool stays visible. We note
    // which groups have at least one unlocked member in the same pass so a group
    // header can be hidden when everything beneath it is still locked (e.g.
    // Leisure/Services/Special at 1★), no dangling section titles.
    const groupsWithUnlocked = new Set<string>();
    ui.el.palette.querySelectorAll<HTMLElement>(".pal-item[data-kind]").forEach((item) => {
      const kind = item.dataset.kind as FacilityKind;
      const locked = !sim.isUnlocked(kind);
      const affordable = sim.money >= FACILITIES[kind].cost;
      item.classList.toggle("locked", locked);
      item.classList.toggle("unaffordable", !locked && !affordable);
      if (!locked && item.dataset.group) groupsWithUnlocked.add(item.dataset.group);
    });
    ui.el.palette.querySelectorAll<HTMLElement>(".pal-group-title[data-group]").forEach((title) => {
      title.hidden = !groupsWithUnlocked.has(title.dataset.group ?? "");
    });
    // If the active build tool just became locked, loading, founding, or undoing
    // into a lower-star tower while a higher-star tool was selected, its palette
    // button is now hidden, leaving no visible active tool while canvas clicks
    // still attempt the locked facility. Fall back to Inspect so the selection
    // matches what the palette shows. (Fires once: the tool is Inspect afterward.)
    // Gated with the scan: the tool can only BECOME locked when the star drops,
    // which is always a key change.
    if (ui.tool.type === "build" && !sim.isUnlocked(ui.tool.kind)) {
      ui.selectTool({ type: "inspect" });
    }
  }

  ui.setTowerName(sim.tower.towerName);

  // lit render, not innerHTML: patches the changed text in place each pump, so
  // the grid's nodes keep their identity (E5-S0 gate) instead of a full reparse.
  // #tower-stats is lit's container exclusively (one container, one renderer).
  render(towerStatsTemplate(sim.stats()), ui.el.towerStats);

  renderLog(ui, sim.log, sim.logSeq);
}

function renderLog(ui: UI, log: LogEntry[], logSeq: number): void {
  if (logSeq === ui.lastLogSeq) return;
  // Count new entries by the monotonic logSeq, NOT log.length: the engine caps
  // the log (push+shift), so length stops changing while entries keep flowing , 
  // diffing on length froze this pump (and every toast) after the cap. Clamp to
  // what's still in the buffer: anything older was shifted out.
  const fresh = Math.min(logSeq - ui.lastLogSeq, log.length);
  ui.lastLogSeq = logSeq;
  if (fresh <= 0) return;
  // slice(length - fresh), never slice(-fresh): a fresh of 0 would make -0 → 0
  // and re-render the WHOLE buffer (the guard above already covers it, but this
  // keeps the slice honest regardless).
  const batch = log.slice(log.length - fresh);
  // Toast only the most-recent good/bad lines of the batch. A catch-up tick can
  // flush a big batch at once; toast() already keeps ≤ TOAST_MAX on screen, so
  // firing one per line would spawn hundreds of transient nodes+timers just to
  // prune them. The bulletin below still records EVERY line for scrollback.
  const toastAt = new Set(
    batch.flatMap((e, i) => (e.kind === "good" || e.kind === "bad" ? [i] : [])).slice(-TOAST_MAX),
  );
  batch.forEach((e, i) => {
    // Append the bulletin line FIRST, it's the durable record; a throwing
    // toast() must never drop it or stall the rest of the batch.
    ui.el.log.appendChild(logLine(e)); // column-reverse ⇒ newest lands on top
    if (toastAt.has(i)) {
      try {
        ui.toast(e.text, e.kind);
      } catch {
        /* a toast failure is cosmetic, never let it interrupt the pump */
      }
    }
  });
  // APPEND + PRUNE, never rebuild: the bulletin keeps accepting new lines forever
  // (it never freezes at the cap) while the DOM node count stays CONSTANT, so a
  // long session can't grow it big enough to jank a slow phone. Oldest is the
  // first child under column-reverse.
  while (ui.el.log.childElementCount > LOG_DOM_CAP) ui.el.log.firstElementChild!.remove();
}

/** One bulletin line. `textContent` auto-escapes, never interpolate engine text
 *  into innerHTML. */
function logLine(e: LogEntry): HTMLDivElement {
  const d = document.createElement("div");
  d.className = `log-line ${e.kind}`;
  d.textContent = e.text;
  return d;
}

/** Adopt a freshly-swapped tower's log baseline (load / import / new / undo /
 *  redo): take its logSeq so we neither replay its old entries as toasts nor
 *  skip its next one against a stale cursor, and rebuild the (bounded) bulletin. */
export function resetLog(ui: UI, sim: Simulation): void {
  ui.lastLogSeq = sim.logSeq;
  ui.el.log.replaceChildren(...sim.log.slice(-LOG_DOM_CAP).map((e) => logLine(e)));
}

/** A transient toast on the toast rail; self-removing, capped at TOAST_MAX. */
export function toast(ui: UI, text: string, kind: LogEntry["kind"] = "info"): void {
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.textContent = text;
  ui.el.toast.appendChild(t);
  // The toast removes itself; no id registry to keep (nothing cancels toasts).
  window.setTimeout(() => {
    t.style.transition = "opacity .3s";
    t.style.opacity = "0";
    window.setTimeout(() => t.remove(), 300);
  }, 3600);
  while (ui.el.toast.children.length > TOAST_MAX) ui.el.toast.firstElementChild?.remove();
}
