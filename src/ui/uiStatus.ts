import type { LogEntry } from "../engine/types";
import { catalogFacility, type Catalog } from "../engine/catalogTypes";
import type { FacilityKind, GameMode } from "../engine/types";
import type { EnginePort } from "../simport/enginePort";
import type { PortCodes } from "../simport/portCodes";
import { clockOf } from "../simport/headerClock";
import type { SimView } from "../simport/view";
import type { UI } from "./UI";
import { render } from "lit-html";
import { appendMessageWithIcons } from "./icons";
import { relabelPalette, syncPaletteTabs } from "./uiPalette";
import { toolInfoFor } from "./templates/toolInfo";
import { towerStatsTemplate, type TowerStatsSnapshot } from "./templates/towerStats";
import { bindViewWorld } from "../presentation/viewWorld";
import { bindViewKinds } from "../presentation/viewKinds";

/**
 * Status-bar, palette-lock, tower-stats and bulletin-log rendering for
 * {@link UI}, as friend functions taking the UI instance. This is the per-frame
 * pump ({@link update}) plus the toast rail and log baseline helpers. Extracted
 * from `UI.ts`; the class keeps thin delegations.
 *
 * The bulletin log and the toast rail stay IMPERATIVE by decision (E7-S1 of
 * the lit migration; rationale in the implementation backlog): they are
 * append-only streams with deliberate performance structure (constant DOM
 * node count via append+prune, self-removing toasts), not markup for a
 * value diff, and their live-region announcements (`role=log` on the
 * bulletin, `role=status` on the toast rail, both `aria-live`) must never
 * be batched or throttled to fit a frame budget.
 */

/** What the HUD pump reads: the shared view reader (header and tower name),
 *  the port's strip and log members, and the codes to read them by name. The
 *  game hands out a source whose members it reads per call
 *  (`src/game/hudSource.ts`). */
export interface HudSource {
  readonly reader: Pick<SimView, "header" | "tower">;
  readonly port: Pick<EnginePort, "statsStrip" | "logAfter" | "logText">;
  readonly codes: Pick<PortCodes, "code" | "slot">;
}

type LogKind = LogEntry["kind"];
const LOG_KINDS: readonly LogKind[] = ["info", "good", "bad", "money"];

/** Log kind by port code, built once per code table. */
const kindsOf = new WeakMap<object, LogKind[]>();
function logKinds(codes: HudSource["codes"]): LogKind[] {
  let k = kindsOf.get(codes);
  if (!k) {
    k = [];
    for (const name of LOG_KINDS) k[codes.code("logKinds", name)] = name;
    kindsOf.set(codes, k);
  }
  return k;
}

/** Whether a kind can be built at this star and mode: the star gate, plus
 *  Modern-only kinds never unlock in a Classic tower. Reads the catalog, which
 *  gives the same answer as the engine's `isUnlocked`. */
function unlocked(catalog: Catalog, kind: FacilityKind, star: number, mode: GameMode): boolean {
  const f = catalogFacility(catalog, kind);
  return !(f.modernOnly && mode !== "modern") && star >= f.minStar;
}

/** Hard ceiling on rendered bulletin lines. The DOM node count is held CONSTANT
 *  at this, append the newest, prune the oldest, so scrollback is generous yet
 *  a long session can never grow the log big enough to jank a slow phone. */
const LOG_DOM_CAP = 300;

/** Most toasts kept on screen at once, and the most fired in a single render.
 *  A catch-up tick can flush a big batch; only the newest few pop. */
const TOAST_MAX = 5;

/** Pending hold/fade timer for each live toast node, so an early prune (below
 *  the TOAST_MAX cap) can cancel it. Without this a pruned toast keeps its
 *  ~3.6s hold timer, which then fires on a node already detached from the rail
 *  (issue #368) and can even outlive a headless test's DOM teardown. Keyed by
 *  the node so the entry is collected once the node is unreachable. */
const toastTimers = new WeakMap<Element, number>();

/** Refresh status bar, palette locks, tower stats and the bulletin log. */
export function update(ui: UI, src: HudSource): void {
  const { header } = src.reader;
  const { money, star, mode } = header;
  // One strip read gives the population label and the stats grid.
  const stats = readStrip(src);
  ui.el.money.textContent = `$${Math.round(money).toLocaleString()}`;
  ui.el.money.style.color = money < 0 ? "var(--bad)" : "var(--money)";
  ui.el.pop.textContent = stats.population.toLocaleString();
  ui.el.star.textContent = star >= 6 ? "TOWER" : "★".repeat(star) + "☆".repeat(5 - star);
  const clock = clockOf(header);
  ui.el.time.textContent = clock.format();
  ui.el.date.textContent = clock.formatRetroDate();

  // The palette and the build tool's card show the tower's catalog: redraw
  // them when it is no longer the one they were drawn from (a WASM host
  // attached or let go, or a tower was swapped in), so a hosted tower never
  // shows the TypeScript tables' values (#921).
  const catalog = ui.cb.getCatalog();
  if (catalog !== ui.paletteCatalog) {
    // A new catalog must state the world the view was built for.
    bindViewWorld(catalog.world);
    bindViewKinds(catalog);
    relabelPalette(ui, catalog);
    if (ui.tool.type === "build") render(toolInfoFor(catalog, ui.tool.kind), ui.el.toolInfo);
  }

  // Dirty-gate the palette lock/afford scan (E5-S3): its DOM pass depends on the
  // star and the mode (isUnlocked is star-vs-minStar, plus a Modern-only gate for
  // modernOnly kinds like the Food Hall) and on which kinds the current funds can
  // afford, so it reruns only when the star, the mode, or an affordability
  // boundary crossed since the last scan. Mode is founded-once but a New Tower
  // swap can flip it under an identical star/money, so it must be in the key.
  // Money moves every pump; the bitmask below changes only at a crossing, so the
  // ~6 Hz pump skips the two querySelectorAll walks and the class writes almost
  // always. The key is a cheap string over engine data (no DOM reads).
  let scanKey = mode + ":" + star;
  for (const f of catalog.facilities) scanKey += money >= f.cost ? "1" : "0";
  if (scanKey !== ui.paletteScanKey) {
    ui.paletteScanKey = scanKey;
    // Palette unlock state. Parity with the original: a locked facility is HIDDEN
    // (`.locked` -> display:none, out of layout and tab order), not shown dimmed ,
    // the palette grows as stars are earned. Only affordability dims
    // (`.unaffordable`); an unlocked-but-unaffordable tool stays visible.
    ui.el.palette.querySelectorAll<HTMLElement>(".pal-item[data-kind]").forEach((item) => {
      const kind = item.dataset.kind as FacilityKind;
      const locked = !unlocked(catalog, kind, star, mode);
      const affordable = money >= catalogFacility(catalog, kind).cost;
      item.classList.toggle("locked", locked);
      item.classList.toggle("unaffordable", !locked && !affordable);
    });
    // Reads the `.locked` classes just written: hides a category section and its
    // tab when everything beneath is still locked (e.g. Leisure below 3★, no
    // dangling section title), hides the Modern sub-band until a Modern venue
    // unlocks, pips a tab whose tools just grew, and keeps a valid mobile tab
    // selected.
    syncPaletteTabs(ui);
    // If the active build tool just became locked, loading, founding, or undoing
    // into a lower-star tower while a higher-star tool was selected, its palette
    // button is now hidden, leaving no visible active tool while canvas clicks
    // still attempt the locked facility. Fall back to Inspect so the selection
    // matches what the palette shows. (Fires once: the tool is Inspect afterward.)
    // Gated with the scan: the tool can only BECOME locked when the star drops,
    // which is always a key change.
    if (ui.tool.type === "build" && !unlocked(catalog, ui.tool.kind, star, mode)) {
      ui.selectTool({ type: "inspect" });
    }
  }

  ui.setTowerName(src.reader.tower.towerName);
  // The rule-set badge follows the live mode. setMode is dirty-gated, so this
  // per-pump call only writes the DOM when the mode changes (e.g. an adoptSim
  // swap into a tower founded the other way).
  setMode(ui, mode);

  // lit render, not innerHTML: patches the changed text in place each pump, so
  // the grid's nodes keep their identity (E5-S0 gate) instead of a full reparse.
  // #tower-stats is lit's container exclusively (one container, one renderer).
  render(towerStatsTemplate(stats), ui.el.towerStats);

  renderLog(ui, src);
}

const STRIP_FIELDS = [
  "population",
  "floors",
  "basements",
  "occupiedOffices",
  "offices",
  "soldCondos",
  "condos",
  "occupiedHotel",
  "hotelRooms",
  "dirty",
  "shops",
  "restaurants",
  "transports",
  "vacant",
] as const;

/** The grid's counters from one `statsStrip()` record, read by slot name. */
function readStrip(src: HudSource): TowerStatsSnapshot & { population: number } {
  const rec = src.port.statsStrip();
  const out = {} as Record<(typeof STRIP_FIELDS)[number], number>;
  for (const name of STRIP_FIELDS) out[name] = src.codes.slot(rec, "statsStrip", name);
  return out;
}

/**
 * Paint the active tower's rule-set on the Tower-panel badge. Called from the
 * per-frame {@link update} pump with the live mode, so it is dirty-gated on the
 * badge's own `data-mode` (no extra UI state): it writes the label and class
 * only when the mode actually changes, including after an `adoptSim` swap into a
 * tower founded the other way, and no-ops otherwise. The badge is its own
 * element, kept out of `#tower-stats` (the lit one-renderer container).
 */
export function setMode(ui: UI, mode: GameMode): void {
  const badge = ui.el.modeBadge;
  if (badge.dataset.mode === mode) return;
  badge.dataset.mode = mode;
  const isModern = mode === "modern";
  badge.textContent = `This tower: ${isModern ? "Modern" : "Classic"}`;
  badge.classList.toggle("is-modern", isModern);
  badge.classList.toggle("is-classic", !isModern);
}

function renderLog(ui: UI, src: HudSource): void {
  const logSeq = src.reader.header.logSeq;
  if (logSeq === ui.lastLogSeq) return;
  // The cursor is the engine's monotonic seq, NOT a line count: the engine
  // caps its log, so a count stops changing while lines keep flowing and
  // diffing on it froze this pump (and every toast) after the cap. The
  // engine answers only the lines still in its buffer after the cursor.
  const batch = readLog(src, ui.lastLogSeq);
  ui.lastLogSeq = logSeq;
  if (batch.length === 0) return;
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

/** The log lines after `seq`, oldest first: the port's `(seq, kindCode,
 *  minute)` triples with each line's text. */
function readLog(src: HudSource, seq: number): (Pick<LogEntry, "text" | "kind"> & { seq: number })[] {
  const rec = src.port.logAfter(seq);
  const kinds = logKinds(src.codes);
  const lines: ReturnType<typeof readLog> = [];
  for (let i = 0; i + 2 < rec.length; i += 3) {
    lines.push({ seq: rec[i], text: src.port.logText(rec[i]) ?? "", kind: kinds[rec[i + 1]] ?? "info" });
  }
  return lines;
}

/** One bulletin line. Still never interpolates engine text into innerHTML:
 *  `appendMessageWithIcons` keeps every character of `e.text` as a TEXT NODE and
 *  only swaps a known leading emoji for a trusted, code-built icon element (#721).
 *  The icon is `currentColor`, so it inherits this line's severity color (the
 *  `${e.kind}` class), matching the text. */
function logLine(e: Pick<LogEntry, "text" | "kind">): HTMLDivElement {
  const d = document.createElement("div");
  d.className = `log-line ${e.kind}`;
  appendMessageWithIcons(d, e.text);
  return d;
}

/** Adopt a freshly-swapped tower's log baseline (load / import / new / undo /
 *  redo): take its logSeq so we neither replay its old entries as toasts nor
 *  skip its next one against a stale cursor, and rebuild the (bounded) bulletin. */
export function resetLog(ui: UI, src: HudSource): void {
  const lines = readLog(src, 0);
  ui.lastLogSeq = lines.length ? lines[lines.length - 1].seq : 0;
  ui.el.log.replaceChildren(...lines.slice(-LOG_DOM_CAP).map((e) => logLine(e)));
}

/** A transient toast on the toast rail; self-removing, capped at TOAST_MAX. */
export function toast(ui: UI, text: string, kind: LogEntry["kind"] = "info"): void {
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  appendMessageWithIcons(t, text);
  // The rail is polite (role="status") so routine good/info toasts never
  // interrupt a screen reader mid-sentence, and a catch-up flush of several at
  // once queues instead of barging. A genuine error is the exception: mark it
  // role="alert" (an assertive live region of its own) so it still cuts in.
  if (kind === "bad") t.setAttribute("role", "alert");
  ui.el.toast.appendChild(t);
  // Self-removing: hold, then a short fade. Track the pending timer under the
  // node so an early prune (below) can cancel it; the fade step re-registers the
  // removal timer under the same node so a prune mid-fade still cancels cleanly.
  const hold = window.setTimeout(() => {
    t.style.transition = "opacity .3s";
    t.style.opacity = "0";
    toastTimers.set(
      t,
      window.setTimeout(() => {
        toastTimers.delete(t);
        t.remove();
      }, 300),
    );
  }, 3600);
  toastTimers.set(t, hold);
  // Cap the rail: prune the oldest, canceling its pending timer so it can never
  // fire after the node has left the DOM.
  while (ui.el.toast.children.length > TOAST_MAX) {
    const oldest = ui.el.toast.firstElementChild;
    if (!oldest) break;
    const pending = toastTimers.get(oldest);
    if (pending !== undefined) {
      clearTimeout(pending);
      toastTimers.delete(oldest);
    }
    oldest.remove();
  }
}
