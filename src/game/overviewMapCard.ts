/**
 * A tap on the overview MAP opens the card of what the selected view shows
 * there (`ui/overviewMapPick.ts`): a room's card on Eval, Pricing, Hotel and
 * Occupancy, and on Traffic the card of a shaft serving the tapped floor. The
 * tap has already moved the view there.
 *
 * A room's main gripe is the point of the tap. A phone's room card carries it,
 * so a phone opens the card a tap on the room opens (`selectPicked`). A
 * computer's room card leaves it to the smaller card a hover shows, which the
 * room card would cover, so with Inspect held a computer raises that hover
 * card alone, and a click on the room then opens the room card as usual. A
 * shaft opens its full card everywhere: its cars are what a jam calls for.
 */
import type { FacilityKind } from "@verticopolis/engine/model/types";
import type { MapViewId } from "@verticopolis/components/render/overviewMap/views";
import { trackAppAction } from "../analyticsActions";
import type { MapTap } from "../ui/overviewMapDeps";
import { mapPick, type MapPickRoom, type MapPickShaft, type MapPicked } from "../ui/overviewMapPick";
import { engineTrapped } from "./engineFault";
import { isEngineStopped } from "./interactionState";

export interface MapCardApp {
  readonly reader: {
    readonly rooms: ReadonlyArray<MapPickRoom>;
    readonly tower: { readonly transports: ReadonlyArray<MapPickShaft> };
  };
  readonly tool: { readonly type: string };
  readonly mobileMq: { readonly matches: boolean };
  readonly inspector: { resetLatch(): void; inspectPicked(p: MapPicked): void };
  selectPicked(p: MapPicked): void;
}

/** Open the card for `tap` on `view`. Nothing happens on Edit, on a tap that
 *  lands near no room (or, on Traffic, on a floor no shaft serves), or once
 *  the engine has stopped. */
export function openMapCard(
  app: MapCardApp,
  view: MapViewId,
  tap: MapTap,
  floorsOf: (kind: FacilityKind) => number,
): void {
  if (view === "edit" || engineTrapped() || isEngineStopped()) return;
  const picked = mapPick({
    view,
    layout: tap.layout,
    x: tap.x,
    y: tap.y,
    reach: tap.reach,
    rooms: app.reader.rooms,
    shafts: app.reader.tower.transports,
    floorsOf,
  });
  if (!picked) return;
  // The hover card only with Inspect held: another tool's hover never
  // replaces it, so it would linger.
  if (picked.type === "unit" && app.tool.type === "inspect" && !app.mobileMq.matches) {
    // A tap is fresh intent, as a click on the room is: a card the player
    // closed opens again.
    app.inspector.resetLatch();
    app.inspector.inspectPicked(picked);
  } else app.selectPicked(picked);
  trackAppAction("map_card", view);
}
