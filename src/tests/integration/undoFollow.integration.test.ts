import { describe, it, expect } from "vitest";
import { createAppHistory } from "../../game/appHistory";
import { floorsOfPort, newRenderSim } from "../../game/portAccess";
import { outcome } from "@verticopolis/engine/port/portCodes";
import { ViewReader } from "@verticopolis/engine/port/viewReader";
import { engineFromSave, look, must, noEngine, smallTower } from "../portKit/rustEngine";

/**
 * An undo or redo step followed the way the app follows it (#1802), on the Rust engine: the
 * engine keeps its generation, so the reader follows the step from the next frame. The rooms
 * the step left keep their objects (the selection and the render view hold them), a room the
 * step took leaves the view, and a step that puts back only a name raises no tower revision,
 * which the renderer's structural sync keys on, while the name still reaches the room.
 */
describe.skipIf(noEngine)("following an undo or redo step", () => {
  function tower() {
    const enginePort = engineFromSave(smallTower((d) => must(d.build("office", 2, 170), "the office")).saveText());
    const reader = new ViewReader(enginePort, floorsOfPort(enginePort));
    reader.update();
    const renderSim = newRenderSim(enginePort, reader);
    const hist = createAppHistory({
      enginePort,
      ui: { toast: () => {} },
      followSwap: () => reader.update(),
      showSteps: () => {},
    });
    const office = reader.rooms.find((r) => r.kind === "office");
    if (!office) throw new Error("no office in the view");
    return { enginePort, reader, renderSim, hist, office };
  }

  it("keeps the generation and the rooms the step left, and drops the room it took", async () => {
    const { enginePort, reader, renderSim, hist, office } = tower();
    const generation = enginePort.generation();
    hist.capture("Build");
    must(look(enginePort).build("office", 3, 200), "the second office");
    hist.commit();
    reader.update();
    const built = reader.rooms.find((r) => r.kind === "office" && r.floor === 3);
    expect(built).toBeDefined();
    const revision = reader.tower.revision;

    await hist.undo();
    expect(enginePort.generation(), "the same tower").toBe(generation);
    expect(reader.tower.revision, "the structure moved").toBeGreaterThan(revision);
    expect(reader.tower.getUnit(built!.id), "the step took the room").toBeUndefined();
    expect(reader.tower.getUnit(office.id), "the room the step left keeps its object").toBe(office);
    expect(renderSim.tower.getUnit(office.id), "the render view reads the same rooms").toBe(office);
    expect(renderSim.tower.getUnit(built!.id)).toBeUndefined();

    await hist.redo();
    expect(enginePort.generation()).toBe(generation);
    const back = reader.tower.getUnit(built!.id);
    expect(back?.floor, "the redo put the room back").toBe(3);
    expect(renderSim.tower.getUnit(built!.id)).toBe(back);
  });

  it("follows a rename step through the meta read without raising the revision", async () => {
    const { enginePort, reader, hist, office } = tower();
    const name = office.label;
    hist.capture("Rename");
    must(outcome(enginePort, enginePort.labelUnit(office.id, "Penthouse Offices")), "the rename");
    hist.commit();
    reader.update();
    expect(office.label).toBe("Penthouse Offices");
    const revision = reader.tower.revision;

    await hist.undo();
    expect(reader.tower.revision, "a name moves no structure").toBe(revision);
    expect(reader.tower.getUnit(office.id)).toBe(office);
    expect(office.label, "the name came back through the meta read").toBe(name);
    await hist.redo();
    expect(reader.tower.revision).toBe(revision);
    expect(office.label).toBe("Penthouse Offices");
  });
});
