import { catalogFor } from "../engine/catalog";
import { useFallbackCatalogSource } from "../catalog/towerCatalog";
import { bindViewWorld } from "../presentation/viewWorld";
import { bindViewKinds } from "../presentation/viewKinds";

// Unit and integration tests draw, place and lay out without a running scene,
// so the view is bound to the Modern catalog's world up front, the same world
// the game binds from the tower's catalog when it builds the scene (#921).
bindViewWorld(catalogFor("modern").world);
bindViewKinds(catalogFor("modern"));

// A TypeScript tower a test builds has no engine host to set its catalog
// source, so it reads the TypeScript engine's tables, which the shipped game
// does not carry (towerCatalog.ts).
useFallbackCatalogSource(catalogFor);
