import { html, type TemplateResult } from "lit-html";
import type { CatalogRules } from "@verticopolis/components/catalog/catalogTypes";
import type { EnginePort, PortRecord } from "@verticopolis/components/port/enginePort";
import type { VacateReason } from "@verticopolis/components/shared/types";
import {
  accessCopy,
  amenityCopy,
  farWalkCopy,
  gripeCopy,
  lobbyWarningCopy,
  noRateCopy,
  noticeCopy,
  wontLeaseCopy,
  type GripeCopyFacts,
} from "../ui/tenantDiagnosticCopy";
import { gripeTopic, type HelpTopic } from "../ui/helpTopics";
import { helpTopicLink } from "../ui/templates/helpTopicLink";

/**
 * Decode the active engine's diagnostic facts into presentation text.
 * All decisions (including the dominant satisfaction cause) come from
 * EnginePort.unitFacts; this adapter does not inspect or simulate the tower.
 * The strings themselves are shared with the legacy TypeScript inspector.
 */
interface Layout {
  records: { unitFacts: string[] };
  kinds: string[];
  accessLines: string[];
  noRateLines: string[];
  bindings: string[];
  vacateReasons: string[];
}

const bad = "var(--bad)";
const good = "var(--good)";

/** One card line, with a Help link to its page in the manual (#2036) when
 *  the line names a problem the manual answers. */
function line(copy: string, color?: string, topic?: HelpTopic): TemplateResult {
  const help = topic ? helpTopicLink(topic, "inspector") : "";
  return color
    ? html`<div style="color:${color}">${copy}${help}</div>`
    : html`<div>${copy}${help}</div>`;
}

/** Lines from another fact record and where the card puts them: `lines`
 *  after the access and No Rate lines, `trailing` (a venue's business block)
 *  last, below any notice, so a warning reads before the figures. */
export interface SupplementalLines {
  readonly lines: readonly TemplateResult[];
  readonly trailing: readonly TemplateResult[];
}

/** A unit's card lines. `beforeComplaints` reads lines that sit after the
 *  lobby advice and above any gripe or notice (a recycling center's block),
 *  read after the unit's facts so the engine reads keep their order. */
export type PortUnitLines = (id: number, beforeComplaints?: () => readonly TemplateResult[]) => TemplateResult[];

/** A unit's card lines in two halves: `head` runs to the lobby advice and
 *  `tail` holds the gripes, the notice and the business block, so a caller
 *  that keeps them can put lines read later between the two. `lines` is the
 *  two joined, built once and handed out as is, so a cached card costs no
 *  copy; no caller changes it. A record that is short or names another unit
 *  has no lines. */
export interface PortUnitParts {
  readonly head: readonly TemplateResult[];
  readonly tail: readonly TemplateResult[];
  readonly lines: TemplateResult[];
}

/** The card's lines with `between` (lines read after the unit's facts) in
 *  their place, after the lobby advice and above any gripe or notice. */
export function joinParts(parts: PortUnitParts, between?: () => readonly TemplateResult[]): TemplateResult[] {
  return between ? [...parts.head, ...between(), ...parts.tail] : parts.lines;
}

/** The catalog rules the card's copy follows, read when a card renders. */
export type DiagnosticRules = () => Pick<CatalogRules, "quotesLobbyDistance" | "advisesFixes">;

/** A facility's display name by kind key (the catalog's `name`), or
 *  undefined for a kind the catalog does not list. */
export type FacilityName = (kind: string) => string | undefined;

export function createPortUnitDiagnostics(
  port: Pick<EnginePort, "viewLayout" | "unitFacts">,
  rules: DiagnosticRules,
  supplemental?: (id: number) => SupplementalLines,
  facilityName?: FacilityName,
): PortUnitLines {
  const parts = createPortUnitParts(port, rules, supplemental, facilityName);
  return (id, beforeComplaints) => joinParts(parts(id), beforeComplaints);
}

export function createPortUnitParts(
  port: Pick<EnginePort, "viewLayout" | "unitFacts">,
  rules: DiagnosticRules,
  supplemental?: (id: number) => SupplementalLines,
  facilityName?: FacilityName,
): (id: number) => PortUnitParts {
  const layout = JSON.parse(port.viewLayout()) as Layout;
  const slots = new Map(layout.records.unitFacts.map((name, i) => [name, i]));
  const at = (r: PortRecord, name: string): number => r[slots.get(name) ?? -1];
  const named = (values: readonly string[], code: number): string | undefined =>
    Number.isSafeInteger(code) && code >= 0 ? values[code] : undefined;
  const flag = (r: PortRecord, field: string): boolean => at(r, field) === 1;

  /** The engine's roomy elevator for the advice (#2251), named from the
   *  catalog; absent when the engine sent none (every shaft here is full). */
  const roomyShaft = (r: PortRecord, prefix: "gripe" | "leaseGripe"): GripeCopyFacts["roomyShaft"] => {
    const kind = named(layout.kinds, at(r, `${prefix}ShaftKind`));
    if (!kind) return undefined;
    const field = (name: string) => at(r, `${prefix}Shaft${name}`);
    const name = facilityName?.(kind) ?? "elevator";
    return { name, bottom: field("Bottom"), top: field("Top"), cars: field("Cars"), maxCars: field("MaxCars") };
  };

  /** Engine supplies cause and contributing flags, never a TypeScript
   *  recomputation. The words, and the manual page that answers them. */
  const cause = (r: PortRecord, prefix: "gripe" | "leaseGripe", advises: boolean): { copy: string; topic?: HelpTopic } | undefined => {
    if (!flag(r, prefix)) return undefined;
    const reason = named(layout.vacateReasons, at(r, `${prefix}Cause`));
    if (!reason) return undefined;
    const facts: GripeCopyFacts = {
      cause: reason,
      advises,
      binding: named(layout.bindings, at(r, `${prefix}Binding`)),
      elevatorHere: flag(r, `${prefix}ElevatorHere`),
      adjacent: flag(r, `${prefix}Adjacent`),
      club: flag(r, `${prefix}Club`),
      coverage: at(r, `${prefix}Coverage`),
      floorReachable: flag(r, `${prefix}FloorReachable`),
      roomyShaft: roomyShaft(r, prefix),
    };
    const copy = gripeCopy(facts);
    return copy === undefined ? undefined : { copy, topic: gripeTopic(reason, facts.binding) };
  };

  return (id) => {
    const r = port.unitFacts(id);
    if (r.length < layout.records.unitFacts.length || at(r, "id") !== id) return { head: [], tail: [], lines: [] };

    // The catalog's rules, read once per card. Classic names each problem's
    // cause only; Modern adds the fix (#549).
    const modeRules = rules();
    const advises = modeRules.advisesFixes;
    const head: TemplateResult[] = [];
    let out = head;
    const access = accessCopy(named(layout.accessLines, at(r, "access")) ?? "", advises);
    if (access) out.push(access.bad ? line(access.text, bad, "access") : line(access.text, good));
    const rate = noRateCopy(named(layout.noRateLines, at(r, "noRate")) ?? "");
    if (rate) out.push(line(rate));
    const extra = supplemental?.(id);
    if (extra) out.push(...extra.lines);
    if (flag(r, "farWalk")) out.push(line(farWalkCopy(advises), bad, "farWalk"));

    if (flag(r, "lobby")) {
      const sinking = flag(r, "sinking");
      const hasSlot = flag(r, "slot");
      const advice = lobbyWarningCopy({
        sinking,
        advises,
        quotesDistance: modeRules.quotesLobbyDistance,
        distance: at(r, "lobbyDistance"),
        slotFloor: hasSlot ? at(r, "slotFloor") : undefined,
        onSlot: flag(r, "onSlot"),
        needsSupport: flag(r, "needsSupport"),
        clearFirst: flag(r, "clearFirst"),
      });
      out.push(line(advice, sinking || hasSlot ? bad : undefined, "lobby"));
    }
    const tail: TemplateResult[] = [];
    out = tail;

    const main = cause(r, "gripe", advises);
    if (main) out.push(line(`Main gripe: ${main.copy}`, bad, main.topic));

    if (flag(r, "wontLease")) {
      const lease = cause(r, "leaseGripe", advises);
      out.push(line(wontLeaseCopy(lease?.copy, at(r, "carry"), advises), bad, lease?.topic ?? "wontLease"));
    }

    if (flag(r, "notice")) {
      const reason = named(layout.vacateReasons, at(r, "noticeReason")) as VacateReason | undefined;
      if (reason) {
        const lines = noticeCopy({
          reason,
          advises,
          minutesLeft: at(r, "minutesLeft"),
          satisfaction: at(r, "noticeSatisfaction"),
          keepAt: at(r, "keepAt"),
        });
        // The notice's first line carries the link; a relocation is a life
        // event no fix keeps, so it has none.
        const topic = reason === "relocation" ? undefined : "notice";
        lines.forEach((copy, index) => out.push(index === 0 ? line(copy, bad, topic) : line(copy)));
      }
    }
    // The amenity helping the room (#1980), named as the catalog names it.
    const amenity = named(layout.kinds, at(r, "amenity"));
    const lift = at(r, "amenityLift");
    if (amenity && lift > 0) out.push(line(amenityCopy(facilityName?.(amenity) ?? "amenity", lift), good));

    // The business block closes the card, below any notice.
    if (extra) out.push(...extra.trailing);
    return { head, tail, lines: [...head, ...tail] };
  };
}
