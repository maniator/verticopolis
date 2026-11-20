import type { FrameReader } from "@verticopolis/engine/port/frameReader";
import type { Catalog } from "@verticopolis/engine/catalog/catalogTypes";
import type { GameMode } from "@verticopolis/engine/model/types";
import type { EnginePort } from "@verticopolis/engine/port/enginePort";
import { isOperational, isPresent } from "@verticopolis/engine/model/unitState";
import { VIEW_ZOOM_MAX, VIEW_ZOOM_MIN } from "@verticopolis/engine/model/viewZoom";
import type { RenderCatalog, RenderRules, RenderSim, RenderTower } from "@verticopolis/components/render/renderModel";
import { useTowerSource } from "@verticopolis/components/render/towerSource";

/**
 * The seam between the engine and the components' renderer: the engine's
 * frame reader and catalog, typed as the render model the renderer reads,
 * with no copy, and the engine's rules the renderer asks about units. If the
 * two packages' shapes ever stop lining up, the fix goes here, reviewed with
 * the hot-path record, never as a per-frame copy (Verticopolis/engine#89).
 */

/** The engine's reader, typed as the renderer's input. No copy. */
export const toRenderSim = (reader: FrameReader): RenderSim => reader;

/** The engine's catalog, typed as the renderer's input. No copy. */
export const toRenderCatalog = (catalog: Catalog): RenderCatalog => catalog;

/** The engine's rules for the renderer. Built once. */
export const renderRules: RenderRules = {
  isPresent,
  isOperational,
  viewZoom: { min: VIEW_ZOOM_MIN, max: VIEW_ZOOM_MAX },
};

/** Hand a port's catalogs and the engine's rules to the renderer, before its
 *  tower loads (the engine's `rustBootTower` calls this as `useCatalogs`). */
export function useEngineCatalogs(port: EnginePort, catalogs: Readonly<Record<GameMode, Catalog>>): void {
  useTowerSource(port, { catalog: (mode) => toRenderCatalog(catalogs[mode]), rules: renderRules });
}

// Key checks: a member the renderer reads that the engine drops or renames
// fails to compile here, optional members included, where assignability
// alone could let it through.
type Missing<R, E> = Exclude<keyof R, keyof E>;
type Assert<T extends never> = T;
export type EngineRenderKeyChecks = [
  Assert<Missing<RenderSim, FrameReader>>,
  Assert<Missing<RenderTower, FrameReader["tower"]>>,
  Assert<Missing<RenderCatalog, Catalog>>,
  Assert<Missing<RenderCatalog["facilities"][number], Catalog["facilities"][number]>>,
];
