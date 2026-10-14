import { catalogFor } from "../engine/catalog";
import { bindViewWorld } from "../presentation/viewWorld";

// Unit and integration tests draw, place and lay out without a running scene,
// so the view is bound to the Modern catalog's world up front, the same world
// the game binds from the tower's catalog when it builds the scene (#921).
bindViewWorld(catalogFor("modern").world);
