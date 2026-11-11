import { catalogFor } from "./catalogFixture";
import { useFallbackCatalogSource } from "../catalog/towerCatalog";
import { bindViewWorld } from "../presentation/viewWorld";
import { bindViewKinds } from "../presentation/viewKinds";

// Unit and integration tests draw, place and lay out without a running scene,
// so the view is bound to the Modern catalog's world up front, the same world
// the game binds from the tower's catalog when it builds the scene (#921). The
// catalogs are the Rust engine's (src/tests/catalogFixture.ts).
bindViewWorld(catalogFor("modern").world);
bindViewKinds(catalogFor("modern"));

// A tower a test builds by hand has no engine host to set its catalog source,
// so it reads the engine's catalog from the fixture (towerCatalog.ts). One that
// names no mode reads Classic's, the rules a mode-less tower ran on before.
useFallbackCatalogSource((mode) => catalogFor(mode ?? "classic"));
