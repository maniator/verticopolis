import { html, type TemplateResult } from "lit-html";
import type { EnginePort, PortRecord } from "../simport/enginePort";
import type { VacateReason } from "../engine/types";
import {
  FAR_WALK_COPY,
  accessCopy,
  gripeCopy,
  lobbyWarningCopy,
  noRateCopy,
  noticeCopy,
  wontLeaseCopy,
  type GripeCopyFacts,
} from "../ui/tenantDiagnosticCopy";

/**
 * Decode the active engine's diagnostic facts into presentation text.
 * All decisions (including the dominant satisfaction cause) come from
 * EnginePort.unitFacts; this adapter does not inspect or simulate the tower.
 * The strings themselves are shared with the legacy TypeScript inspector.
 */
interface Layout {
  records: { unitFacts: string[] };
  accessLines: string[];
  noRateLines: string[];
  modes: string[];
  bindings: string[];
  vacateReasons: string[];
}

const bad = "var(--bad)";
const good = "var(--good)";

function line(copy: string, color?: string): TemplateResult {
  return color
    ? html`<div style="color:${color}">${copy}</div>`
    : html`<div>${copy}</div>`;
}

export function createPortUnitDiagnostics(port: Pick<EnginePort, "viewLayout" | "unitFacts">): (id: number) => TemplateResult[] {
  const layout = JSON.parse(port.viewLayout()) as Layout;
  const slots = new Map(layout.records.unitFacts.map((name, i) => [name, i]));
  const at = (r: PortRecord, name: string): number => r[slots.get(name) ?? -1];
  const named = (values: readonly string[], code: number): string | undefined =>
    Number.isSafeInteger(code) && code >= 0 ? values[code] : undefined;
  const flag = (r: PortRecord, field: string): boolean => at(r, field) === 1;

  /** Engine supplies cause and contributing flags, never a TypeScript recomputation. */
  const cause = (r: PortRecord, prefix: "gripe" | "leaseGripe"): string | undefined => {
    if (!flag(r, prefix)) return undefined;
    const reason = named(layout.vacateReasons, at(r, `${prefix}Cause`));
    if (!reason) return undefined;
    const facts: GripeCopyFacts = {
      cause: reason,
      binding: named(layout.bindings, at(r, `${prefix}Binding`)),
      elevatorHere: flag(r, `${prefix}ElevatorHere`),
      adjacent: flag(r, `${prefix}Adjacent`),
      club: flag(r, `${prefix}Club`),
      coverage: at(r, `${prefix}Coverage`),
      floorReachable: flag(r, `${prefix}FloorReachable`),
    };
    return gripeCopy(facts);
  };

  return (id: number): TemplateResult[] => {
    const r = port.unitFacts(id);
    if (r.length < layout.records.unitFacts.length || at(r, "id") !== id) return [];

    const out: TemplateResult[] = [];
    const access = accessCopy(named(layout.accessLines, at(r, "access")) ?? "");
    if (access) out.push(line(access.text, access.bad ? bad : good));
    const rate = noRateCopy(named(layout.noRateLines, at(r, "noRate")) ?? "");
    if (rate) out.push(line(rate));
    if (flag(r, "farWalk")) out.push(line(FAR_WALK_COPY, bad));

    if (flag(r, "lobby")) {
      const sinking = flag(r, "sinking");
      const hasSlot = flag(r, "slot");
      const advice = lobbyWarningCopy({
        sinking,
        mode: named(layout.modes, at(r, "modeCode")) ?? "",
        distance: at(r, "lobbyDistance"),
        slotFloor: hasSlot ? at(r, "slotFloor") : undefined,
        onSlot: flag(r, "onSlot"),
        needsSupport: flag(r, "needsSupport"),
        clearFirst: flag(r, "clearFirst"),
      });
      out.push(line(advice, sinking || hasSlot ? bad : undefined));
    }

    const main = cause(r, "gripe");
    if (main) out.push(line(`Main gripe: ${main}`, bad));

    if (flag(r, "wontLease")) {
      out.push(line(wontLeaseCopy(cause(r, "leaseGripe"), at(r, "carry")), bad));
    }

    if (flag(r, "notice")) {
      const reason = named(layout.vacateReasons, at(r, "noticeReason")) as VacateReason | undefined;
      if (reason) {
        const lines = noticeCopy({
          reason,
          minutesLeft: at(r, "minutesLeft"),
          satisfaction: at(r, "noticeSatisfaction"),
          keepAt: at(r, "keepAt"),
        });
        lines.forEach((copy, index) => out.push(line(copy, index === 0 ? bad : undefined)));
      }
    }
    return out;
  };
}
